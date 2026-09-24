# 0031. Outbox de jobs

- Status: Aceito
- Data: 2026-09-24
- Complementa: [0014](0014-envio-de-email-e-tokens.md), [0025](0025-transacao-entre-camadas.md)

## Contexto

O ADR 0025 manda enfileirar o job BullMQ **depois do commit**, para não enviar
job de transação desfeita. Se o processo cair entre o commit e o enfileiramento,
o job se perde: o usuário fica sem o e-mail de verificação, de reset de senha ou,
pior, de cancelamento de exclusão de conta (ADR 0010), que não pode sumir.

E-mail entra já no item 1 do roadmap (cadastro com verificação, ADR 0014), então
a solução precisa existir antes do primeiro job disparado por operação de negócio.

## Decisão

**Tabela `outbox_job`**: `id` (uuid), `queue`, `name`, `payload jsonb`,
`created_at`, `attempts` (int, padrão 0), `last_error` (texto, nulo).

- Gravada **na mesma transação** da operação, por
  `outbox.add(tx, queue, name, payload)` (em `apps/api/src/common/outbox`),
  seguindo a assinatura com `tx` explícito do ADR 0025.
- Não tem soft delete nem `audit_log`: é fila técnica, não dado de negócio.

**Publicação imediata (melhor esforço).** Depois do commit, a borda
(`withIdempotency`/`runInTransaction`) chama `outbox.flush()` para as linhas
gravadas naquela transação: enfileira no BullMQ com `jobId = outbox_job.id` (o
BullMQ ignora `jobId` repetido enquanto o job existe) e apaga a linha. Falha no
flush (Redis fora, processo caindo) não afeta a resposta: incrementa `attempts`,
grava `last_error` e deixa a linha para a varredura.

**Varredura.** Um job repetível no `worker`, a cada 1 min, enfileira do mesmo
jeito as linhas com `created_at` há mais de 30 s (evita disputar com o flush
imediato) e as apaga. Leitura com `FOR UPDATE SKIP LOCKED`, para mais de uma
instância do worker não pegar a mesma linha.

**Entrega pelo menos uma vez.** Todo handler de job disparado por outbox é
idempotente. E-mail duplicado num caso raro de queda é aceitável.

**Regra:** job disparado por operação de negócio sempre passa pelo outbox;
código de requisição (e handlers de job que disparam outro job como efeito de
uma escrita) nunca chama `queue.add` direto. Jobs agendados (expurgo LGPD,
limpeza de sessões, a própria varredura) não passam pelo outbox. Lint
`no-restricted-imports` restringe o acesso às filas a `common/outbox` e à
configuração dos jobs agendados.

**Payload mínimo.** Ids (`userId`, `tokenId`...) em vez de dados pessoais; o
handler busca o e-mail atual no banco. A exceção é o **token em claro** dos
e-mails (ADR 0014), que precisa ir no payload para montar o link, já que o banco
só guarda o hash. Mitigação: a linha do outbox é apagada assim que enfileirada;
o job usa `removeOnComplete: true` e `removeOnFail` com limite (ex.:
`{ count: 100 }` ou idade de 24 h); os tokens têm validade curta (ADR 0014).

## Consequências

- Nenhum job de negócio se perde por queda entre commit e enfileiramento; o pior
  caso é atraso de até ~1,5 min ou duplicata.
- **Risco aceito:** o token em claro existe fora do hash por alguns segundos na
  tabela e, no Redis, até o job completar (ou até o limite do `removeOnFail`).
  Quem lê o Redis ou um backup do banco tirado nessa janela obtém um token
  válido. Não logar payload de job; o Redis não pode ficar exposto. Se o risco
  crescer, a alternativa é o handler gerar o token (o outbox leva só o `userId`
  e o tipo), ao custo de mover a criação do token para fora da transação.
- Duplicata possível além da queda: o flush enfileira, o job completa e é
  removido (`removeOnComplete`), e a varredura, que leu a linha antes de ela ser
  apagada, enfileira de novo com o mesmo `jobId`, agora aceito. Coberto pela
  idempotência dos handlers.
- A borda precisa saber quais linhas a transação gravou (ex.: `outbox.add`
  devolve o id e a borda coleta os ids do callback); definir na implementação,
  uma forma só.
- Resposta repetida por `withIdempotency` (ADR 0006) não chama `outbox.add` de
  novo, então replay não duplica job.
- A política de retry do BullMQ (backoff) continua valendo depois que o job chega
  à fila; o outbox só garante que ele chegue.
- Testes: rollback da transação não deixa linha nem job; flush com Redis fora
  mantém a linha e a varredura a publica depois; handler de e-mail chamado duas
  vezes com o mesmo payload não quebra.
- Mais uma tabela na migration do item 1 do roadmap (agente `database`) e um job
  repetível no worker.

## Alternativas consideradas

- **Aceitar a perda (como no ADR 0025):** o e-mail de cancelamento de exclusão
  não pode sumir; sem ele, a pessoa perde a conta sem conseguir desistir.
- **Enfileirar dentro da transação:** o job sai mesmo se a transação for
  desfeita (e-mail de conta que não existe).
- **CDC / logical replication (Debezium etc.):** entrega garantida sem código na
  borda, mas é infraestrutura demais para o projeto.
- **Só o retry do BullMQ:** cobre falha depois que o job está na fila, não o job
  que nunca chegou a ela.
