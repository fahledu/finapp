# 0009. Escrita: transação entre camadas, idempotência e outbox

- Status: Aceito
- Data: 2026-09-24

## Contexto

Toda escrita de negócio precisa ser atômica: a operação, o `audit_log`
([0010](0010-soft-delete-auditoria-e-garantias-no-banco.md)), a chave de
idempotência (regra 7 do CLAUDE.md) e os jobs que ela dispara. Três problemas
aparecem juntos:

- **Transação entre camadas.** A `$transaction` interativa do Prisma é baseada em
  callback: abre quando o callback começa e confirma quando ele termina. Um hook
  do Fastify não consegue abrir a transação no `onRequest` e confirmá-la no
  `onSend`. Faltava decidir como o `tx` chega ao service e ao repository.
- **Idempotência.** Onde guardar a chave, por quanto tempo, como comparar
  requisições (`{"a":1,"b":2}` e `{"b":2,"a":1}` são a mesma?), o que responder na
  repetição e como tratar concorrência. No Postgres, uma violação de unicidade
  **aborta a transação**, então o fluxo ingênuo "insere, pega a violação, lê a
  resposta guardada" não funciona dentro da mesma transação.
- **Jobs.** Enfileirar dentro da transação envia o job mesmo se ela for desfeita;
  enfileirar depois do commit perde o job se o processo cair entre os dois. O
  e-mail de cancelamento de exclusão de conta
  ([0012](0012-lgpd-exclusao-e-retencao.md)) não pode sumir, e e-mail entra já no
  item 1 do roadmap (cadastro com verificação,
  [0011](0011-autenticacao-sessoes-email-e-tokens.md)).

## Decisão

### Transação: `tx` explícito, aberto pela borda

**Tipo `Db`**, exportado de `apps/api/src/common/db`: o client de transação do
client **estendido** (com a extensão de soft delete do ADR 0010). Service e
repository nunca veem o client cru. O client estendido normal também satisfaz
`Db`, então leituras simples podem recebê-lo. `Db` não tem `$transaction`.

**Assinaturas**

- Toda função de repository recebe `db: Db` como primeiro parâmetro.
- Services que escrevem recebem `tx: Db` e o repassam. `audit.record(tx, ...)` e
  `outbox.add(tx, ...)` recebem o mesmo `tx`.
- Services não abrem transação nem chamam `$transaction` (o Prisma não suporta
  transação interativa aninhada).

**Quem abre a transação é sempre a borda:**

- `withIdempotency(request, input, (tx) => service.x(tx, ...))` nas operações
  que criam dinheiro (transação, despesa, acerto). `input` é o corpo já validado
  pelo schema Zod (com o type provider do ADR [0013](0013-convencoes-de-api.md),
  `request.body` já chega validado; não se repete o `.parse()` na rota). A função
  abre a transação, registra a chave, executa o callback, grava a resposta e
  confirma. Sem o header, só abre a transação e executa o callback. É uma função
  reutilizável (pode ser exposta como decorator do Fastify), nunca
  reimplementada por rota.
- `runInTransaction((tx) => ...)` nas demais escritas.
- Handlers de job BullMQ são borda também: abrem a própria transação.

**Lint:** `no-restricted-imports` impede services e repositories de importar o
client global (`prisma`). Só o importam `common/db`, a borda (rotas,
`withIdempotency`, `runInTransaction`) e os jobs. O client sem filtro segue
restrito pelo ADR 0010.

**Nada externo dentro da transação.** A transação interativa tem timeout padrão
de 5 s no Prisma (e 2 s de espera por conexão). Dentro dela não se chama serviço
externo (e-mail, cotações, Redis): o efeito vira linha no outbox (abaixo). Se
operações lentas estourarem o timeout, ajusta-se `timeout` em `withIdempotency`/
`runInTransaction`, não por rota.

**Exemplo**

```ts
// routes.ts (type provider: request.body já validado)
app.post('/expenses', { schema: { body: createExpenseSchema } }, async (request, reply) => {
  const expense = await withIdempotency(request, request.body, (tx) =>
    expenseService.create(tx, request.user.id, request.body),
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

### Idempotência

**Armazenamento:** tabela `idempotency_key` no **Postgres** (não Redis), para que
a chave e a operação sejam atômicas na mesma transação. Colunas: `user_id`,
`key`, `method`, `route`, `request_hash`, `response_status`,
`response_body jsonb`, `created_at`. Chave única `(user_id, key)`: a mesma chave
de usuários diferentes não colide. A chave pertence ao usuário da sessão; sem
sessão não há idempotência.

**Header `Idempotency-Key`:** opcional (sem ele, a operação roda normalmente); 1 a
255 caracteres ASCII visíveis; fora disso → `422 VALIDATION_ERROR`. O frontend
gera `crypto.randomUUID()` quando o formulário abre e reenvia o mesmo valor nas
retentativas daquele envio.

**Hash:** SHA-256 de `METHOD + " " + path concreto (com ids, sem querystring) +
"\n" + JSON canônico do input` (o `input` validado pelo Zod, com chaves
ordenadas recursivamente). Método e path vêm do `request`.

**Fluxo**, dentro da transação aberta por `withIdempotency`:

1. `INSERT ... ON CONFLICT (user_id, key) DO NOTHING RETURNING id` (ou
   `createMany({ skipDuplicates: true })` e checar a contagem).
2. Linha criada → executa o callback e grava `response_status`/`response_body`
   na mesma linha antes do commit.
3. Nenhuma linha → a chave existe (uma requisição concorrente espera o commit da
   outra antes de chegar aqui; essa espera conta no timeout dela). Lê a linha e
   decide:
   - mesmo hash → devolve status e corpo guardados com
     `Idempotent-Replayed: true`, mesmo que o recurso tenha sido editado ou
     apagado depois (é a resposta daquela requisição, não o estado atual). O
     callback não roda, então replay não grava auditoria nem outbox de novo;
   - hash diferente (outro corpo, método ou path) →
     `422 IDEMPOTENCY_KEY_REUSED`;
   - expirada (`created_at` + 24 h no passado) → apagada e tratada como nova, na
     mesma transação.
4. Só respostas `2xx` são guardadas. Se a operação falha, a transação é desfeita
   e a chave some junto, então o cliente pode tentar de novo.

**Validade:** 24 horas; job BullMQ diário apaga as expiradas.

`withIdempotency` precisa do status de sucesso da rota para gravar
`response_status` (opção da função ou retorno do callback); uma forma só para
todas as rotas, definida na implementação.

### Outbox de jobs

**Tabela `outbox_job`:** `id` (uuid), `queue`, `name`, `payload jsonb`,
`created_at`, `attempts` (int, padrão 0), `last_error` (texto, nulo). Gravada
**na mesma transação** da operação por `outbox.add(tx, queue, name, payload)`
(em `apps/api/src/common/outbox`). Não tem soft delete nem `audit_log`: é fila
técnica, não dado de negócio.

**Payload só com ids e tipo.** O payload **nunca** leva token em claro nem dado
pessoal (e-mail, nome, IP): só ids (`userId`, `groupId`...) e enums (ex.: tipo de
token). O handler busca o resto no banco no momento da execução. Tokens de uso
único dos e-mails são **gerados pelo handler do job de e-mail** (ADR 0011): ele
abre a própria transação, cria o token (só o hash vai ao banco), confirma e só
então envia o e-mail.

**Publicação imediata (melhor esforço).** Depois do commit, a borda
(`withIdempotency`/`runInTransaction`) chama `outbox.flush()` para as linhas
gravadas naquela transação: enfileira no BullMQ com `jobId = outbox_job.id` (o
BullMQ ignora `jobId` repetido enquanto o job existe) e apaga a linha. Falha no
flush (Redis fora, processo caindo) não afeta a resposta: incrementa `attempts`,
grava `last_error` e deixa a linha para a varredura. A forma de a borda saber
quais linhas a transação gravou (ex.: `outbox.add` devolve o id e a borda coleta
os ids) é uma só, definida na implementação.

**Varredura.** Job repetível no worker, a cada 1 min, enfileira do mesmo jeito as
linhas com `created_at` há mais de 30 s (evita disputar com o flush imediato) e
as apaga. Leitura com `FOR UPDATE SKIP LOCKED`, para mais de uma instância do
worker não pegar a mesma linha.

**Entrega pelo menos uma vez.** Todo handler de job disparado por outbox é
idempotente; e-mail duplicado num caso raro é aceitável. Jobs usam
`removeOnComplete: true` e `removeOnFail` com limite (ex.: `{ count: 100 }` ou
idade de 24 h). A política de retry do BullMQ (backoff) continua valendo depois
que o job chega à fila; o outbox só garante que ele chegue.

**Regra:** job disparado por operação de negócio sempre passa pelo outbox. Código
de requisição (e handlers de job que disparam outro job como efeito de uma
escrita) nunca chama `queue.add` direto. Jobs agendados (expurgo LGPD, limpeza de
sessões e de chaves de idempotência, a própria varredura) não passam pelo outbox.
Lint `no-restricted-imports` restringe o acesso às filas a `common/outbox` e à
configuração dos jobs agendados.

### Testes obrigatórios

- Idempotência (integração): repetição sequencial (replay), mesmas propriedades
  em ordem diferente (replay, não `422`), corpo diferente (`422`), mesma chave em
  outra rota (`422`), chave expirada (reprocessa), duas requisições simultâneas
  (um único registro).
- Outbox: rollback da transação não deixa linha nem job; flush com Redis fora
  mantém a linha e a varredura a publica depois; handler de e-mail chamado duas
  vezes com o mesmo payload não quebra; payloads dos jobs só têm ids e enums.

## Consequências

- Um parâmetro a mais em service e repository. Em troca, o que é atômico fica
  visível na assinatura; esquecer o `tx` ou abrir transação aninhada no service
  vira erro de tipo, não bug silencioso.
- Testes de service passam um `tx` (ou o client) direto, sem montar contexto.
- Nenhum job de negócio se perde por queda entre commit e enfileiramento; o pior
  caso é atraso de até ~1,5 min ou duplicata.
- Duplicata possível além da queda: o flush enfileira, o job completa e é
  removido (`removeOnComplete`), e a varredura, que leu a linha antes de ela ser
  apagada, enfileira de novo com o mesmo `jobId`, agora aceito. Coberto pela
  idempotência dos handlers.
- Nenhum segredo nem dado pessoal passa pelo outbox, pelo Redis ou por backups do
  banco através dele; o token em claro só existe na memória do handler até o
  envio do e-mail. Mesmo assim, payload de job não é logado.
- A criação do token sai da transação da requisição e vai para a do handler. A
  requisição confirma a intenção (ex.: conta desativada + linha no outbox); o
  token nasce segundos depois. Uma retentativa do handler pode criar outro token;
  as regras de validade, invalidação e limite de tokens ativos são aplicadas pelo
  handler e ficam no ADR 0011.
- Mais duas tabelas técnicas (`idempotency_key`, `outbox_job`) na migration do
  item 1 do roadmap (agente `database`) e dois jobs de manutenção no worker
  (limpeza de chaves, varredura do outbox).

## Alternativas consideradas

- **`AsyncLocalStorage`** (estilo nestjs-cls/transactional): não muda
  assinaturas, mas é invisível; código fora do contexto usa o client global em
  silêncio, fora da transação. Mais difícil de garantir por lint e de testar, e
  como a borda já recebe o `tx` pelo callback, a vantagem principal some.
- **Hook `onRequest`/`onSend` segurando a transação:** impossível com a
  `$transaction` interativa baseada em callback.
- **Transação só no service:** o service teria que conhecer o header
  `Idempotency-Key`, preocupação HTTP, violando as camadas do CLAUDE.md.
- **Idempotência no Redis com TTL:** expira sozinho, mas não participa da
  transação do Postgres; uma falha entre os dois deixaria chave sem operação ou o
  contrário.
- **Header obrigatório:** mais seguro, mas atrapalha testes manuais e scripts.
- **Savepoint antes do insert da chave:** funciona, mas o Prisma não expõe
  savepoints de forma simples.
- **Lock consultivo (`pg_advisory_xact_lock`) pela chave:** correto, mas mais
  difícil de entender que o `ON CONFLICT`.
- **Hash do corpo bruto:** frágil a espaços e ordem de chaves.
- **Enfileirar depois do commit, sem outbox (aceitar a perda):** o e-mail de
  cancelamento de exclusão não pode sumir; sem ele, a pessoa perde a conta sem
  conseguir desistir.
- **Enfileirar dentro da transação:** o job sai mesmo se a transação for desfeita
  (e-mail de conta que não existe).
- **Token em claro no payload do outbox:** permitiria criar o token na
  transação da requisição, mas o token ficaria em claro na tabela, no Redis até o
  job completar e em qualquer backup do banco tirado nessa janela; o de
  cancelamento de exclusão vale 30 dias. Quem lê o Redis ou um backup obteria um
  token válido.
- **CDC / logical replication (Debezium etc.):** entrega garantida sem código na
  borda, mas é infraestrutura demais para o projeto.
- **Só o retry do BullMQ:** cobre falha depois que o job está na fila, não o job
  que nunca chegou a ela.
