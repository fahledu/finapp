# 0016. Idempotência: comparação, concorrência e expiração

- Status: Proposto
- Data: 2026-09-23
- Complementa: [0006](0006-idempotencia.md)

## Contexto

O ADR 0006 deixou três lacunas:

1. "Corpo normalizado" não está definido: `{"a":1,"b":2}` e `{"b":2,"a":1}` dariam
   hashes diferentes e um `422` indevido.
2. `method` e `route` são guardados, mas não entram na comparação: a mesma chave
   reutilizada em outra rota com corpo parecido poderia devolver a resposta errada.
3. No Postgres, a violação de unicidade **aborta a transação**; o fluxo "insere,
   pega violação, lê a resposta guardada" não funciona dentro da mesma transação.
   Também não diz o que fazer com chave expirada que o job ainda não apagou.

## Decisão (recomendada)

- **Formato da chave:** 1 a 255 caracteres ASCII visíveis; o frontend usa UUID.
  Fora disso → `422 VALIDATION_ERROR`.
- **Hash:** SHA-256 de `METHOD + " " + path concreto (com ids, sem querystring) +
  "\n" + JSON canônico do corpo já validado pelo Zod` (chaves ordenadas
  recursivamente). Método ou path diferentes com a mesma chave → `422 IDEMPOTENCY_KEY_REUSED`.
- **Registro sem abortar a transação:**
  `INSERT ... ON CONFLICT (user_id, key) DO NOTHING RETURNING id`
  (ou `createMany({ skipDuplicates: true })` e checar a contagem).
  - Linha criada → executa a operação e grava `response_status`/`response_body`
    na mesma linha antes do commit.
  - Nenhuma linha → a chave existe (uma requisição concorrente espera o commit da
    outra antes de chegar aqui). Lê a linha e decide: replay, `422`, ou expirada.
- **Chave expirada** (`created_at` + 24 h no passado) encontrada antes do job:
  apagada e tratada como nova, na mesma transação.
- **Replay** devolve status e corpo guardados com `Idempotent-Replayed: true`,
  mesmo que o recurso tenha sido editado ou apagado depois (é a resposta daquela
  requisição, não o estado atual).
- A chave pertence ao usuário da sessão; sem sessão não há idempotência.

## Consequências

- O plugin do ADR 0006 fica implementável sem truques de savepoint.
- Testes: mesmas propriedades em ordem diferente (replay, não `422`), mesma chave
  em outra rota (`422`), chave expirada (reprocessa), duas requisições simultâneas
  (um único registro).

## Alternativas consideradas

- **Savepoint antes do insert:** funciona, mas o Prisma não expõe savepoints de
  forma simples.
- **Hash do corpo bruto:** frágil a espaços e ordem de chaves.
- **Lock consultivo (`pg_advisory_xact_lock`) pela chave:** correto, mas mais
  difícil de entender que o `ON CONFLICT`.
