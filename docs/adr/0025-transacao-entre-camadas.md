# 0025. Transação atravessando camadas

- Status: Aceito (complementado por [0031](0031-outbox-de-jobs.md))
- Data: 2026-09-24
- Complementa: [0006](0006-idempotencia.md)

## Contexto

A chave de idempotência (ADR 0006), a operação e o `audit_log` (ADR 0005)
precisam estar na mesma `$transaction`. A `$transaction` interativa do Prisma é
baseada em callback: abre quando o callback começa e confirma quando ele termina.
Um hook do Fastify não consegue abrir a transação no `onRequest` e confirmá-la no
`onSend`, então o "plugin/hook do Fastify" do ADR 0006 não pode segurar a
transação em volta do handler.

Faltava decidir como o `tx` chega ao service e ao repository: passado
explicitamente ou por `AsyncLocalStorage`.

## Decisão

**`tx` passado explicitamente.**

**Tipo `Db`**, exportado de `apps/api/src/common/db`: o client de transação do
client **estendido** (com a extensão de soft delete do ADR 0005). Service e
repository nunca veem o client cru. O client estendido normal também satisfaz
`Db`, então leituras simples podem recebê-lo. `Db` não tem `$transaction`.

**Assinaturas**

- Toda função de repository recebe `db: Db` como primeiro parâmetro.
- Services que escrevem recebem `tx: Db` e o repassam. `audit.record(tx, ...)`
  recebe o mesmo `tx`.
- Services não abrem transação nem chamam `$transaction` (o Prisma não suporta
  transação interativa aninhada).

**Quem abre a transação é sempre a borda** (a rota):

- `withIdempotency(request, input, (tx) => service.x(tx, ...))` nas operações
  que criam dinheiro (CLAUDE.md, regra 7), onde `input` é o resultado do schema
  Zod. O hash (ADR 0006) usa o JSON canônico desse `input`; método e path
  concreto vêm do `request`. A função abre a transação, faz o
  `INSERT ... ON CONFLICT` da chave (ADR 0006), executa o callback, grava
  `response_status`/`response_body` e confirma. Sem o header, só abre a transação
  e executa o callback.
- `runInTransaction((tx) => ...)` nas demais escritas.

**Esclarecimento do ADR 0006:** onde ele diz "plugin/hook do Fastify
reutilizável", leia-se "função reutilizável que envolve a operação"
(`withIdempotency`, que pode ser exposta como decorator do Fastify). O espírito se
mantém: nada de reimplementar por rota.

**Lint:** `no-restricted-imports` impede services e repositories de importar o
client global (`prisma`). Só o importam `common/db`, a borda (rotas,
`withIdempotency`, `runInTransaction`) e os jobs. O client sem filtro continua
restrito pelo ADR 0005.

**Exemplo**

```ts
// routes.ts
app.post('/expenses', async (request, reply) => {
  const input = createExpenseSchema.parse(request.body);
  const expense = await withIdempotency(request, input, (tx) =>
    expenseService.create(tx, request.user.id, input),
  );
  return reply.status(201).send(expense);
});

// service.ts
export async function create(tx: Db, userId: string, input: CreateExpenseInput) {
  const expense = await expenseRepository.insert(tx, userId, input);
  await audit.record(tx, { actorUserId: userId, action: 'CREATE', entity: toAuditSnapshot(expense) });
  return expense;
}

// repository.ts
export function insert(db: Db, userId: string, input: CreateExpenseInput) {
  return db.expense.create({ data: { /* ... */ } });
}
```

## Consequências

- Um parâmetro a mais em service e repository. Em troca, o que é atômico fica
  visível na assinatura, e esquecer o `tx` vira erro de tipo, não bug silencioso.
- Como `Db` não expõe `$transaction`, abrir transação aninhada dentro do service
  também vira erro de tipo.
- Testes de service passam um `tx` (ou o client) direto, sem montar contexto.
- Jobs BullMQ seguem a mesma regra: o handler do job é a borda e abre a transação.
- A transação interativa tem timeout padrão de 5 s no Prisma (e 2 s de espera por
  conexão). Dentro dela não se chama serviço externo (e-mail, cotações): enfileira
  job **depois do commit**. Enfileirar dentro do callback enviaria o job mesmo se a
  transação fosse desfeita. Se o processo cair entre o commit e o enfileiramento,
  o job se perde (ex.: e-mail de reset). Aceito na V1; a solução completa (padrão
  outbox: gravar o job numa tabela dentro da transação e um worker publicar) fica
  como questão em aberto em `docs/STATUS.md`.
- Uma requisição concorrente com a mesma chave espera o commit da primeira no
  `INSERT ... ON CONFLICT` (ADR 0006), e essa espera conta no timeout dela.
  Operações lentas podem estourar os 5 s; se acontecer, ajustar `timeout` em
  `withIdempotency`, não por rota.
- `withIdempotency` precisa conhecer o status de sucesso da rota para gravar
  `response_status` (opção da função ou retorno do callback); definir na
  implementação, uma forma só para todas as rotas.

## Alternativas consideradas

- **`AsyncLocalStorage`** (estilo nestjs-cls/transactional): não muda
  assinaturas, mas é invisível. Código fora do contexto usa o client global em
  silêncio, fora da transação. É mais difícil de garantir por lint e de testar, e
  compensa com muitas camadas, não com três. Como o ponto de entrada já recebe o
  `tx` pelo callback, a vantagem principal some.
- **Hook `onRequest`/`onSend` segurando a transação:** impossível com a
  `$transaction` interativa baseada em callback.
- **Transação só no service:** o service teria que conhecer o header
  `Idempotency-Key`, preocupação HTTP, violando as camadas do CLAUDE.md.
