# 0006. Idempotência de operações financeiras

- Status: Aceito
- Data: 2026-09-23

## Contexto

A regra 7 do CLAUDE.md exige `Idempotency-Key` nas operações que criam dinheiro.
Faltava decidir onde guardar a chave, por quanto tempo, como comparar requisições
("corpo normalizado": `{"a":1,"b":2}` e `{"b":2,"a":1}` são a mesma?), o que
responder na repetição e como tratar concorrência. No Postgres, uma violação de
unicidade **aborta a transação**, então o fluxo ingênuo "insere, pega a violação,
lê a resposta guardada" não funciona dentro da mesma transação.

## Decisão

**Armazenamento:** tabela `idempotency_key` no **Postgres** (não Redis), para que o
registro da chave e a operação sejam atômicos na mesma `$transaction`.

Colunas: `user_id`, `key`, `method`, `route`, `request_hash`, `response_status`,
`response_body jsonb`, `created_at`. Chave única `(user_id, key)`: a mesma chave
de usuários diferentes não colide. A chave pertence ao usuário da sessão; sem
sessão não há idempotência.

**Formato da chave:** 1 a 255 caracteres ASCII visíveis; o frontend usa UUID.
Fora disso → `422 VALIDATION_ERROR`. O header é opcional: sem ele, a operação
roda normalmente.

**Hash:** SHA-256 de `METHOD + " " + path concreto (com ids, sem querystring) +
"\n" + JSON canônico do corpo já validado pelo Zod` (chaves ordenadas
recursivamente).

**Fluxo**, dentro da transação da operação:

1. `INSERT ... ON CONFLICT (user_id, key) DO NOTHING RETURNING id`
   (ou `createMany({ skipDuplicates: true })` e checar a contagem).
2. Linha criada → executa a operação e grava `response_status`/`response_body`
   na mesma linha antes do commit.
3. Nenhuma linha → a chave existe (uma requisição concorrente espera o commit da
   outra antes de chegar aqui). Lê a linha e decide:
   - mesmo hash → devolve status e corpo guardados com `Idempotent-Replayed: true`,
     mesmo que o recurso tenha sido editado ou apagado depois (é a resposta
     daquela requisição, não o estado atual);
   - hash diferente (outro corpo, método ou path) → `422 IDEMPOTENCY_KEY_REUSED`;
   - expirada (`created_at` + 24 h no passado) → apagada e tratada como nova, na
     mesma transação.
4. Só respostas `2xx` são guardadas. Se a operação falha, a transação é desfeita e
   a chave some junto, então o cliente pode tentar de novo.

**Validade:** 24 horas; job BullMQ diário apaga as expiradas.

**Frontend:** gera um `crypto.randomUUID()` quando o formulário abre e reenvia o
mesmo valor em retentativas daquele envio.

## Consequências

- Implementado como plugin/hook do Fastify reutilizável, não em cada rota, sem
  truques de savepoint.
- Testes de integração: repetição sequencial (replay), mesmas propriedades em
  ordem diferente (replay, não `422`), corpo diferente (`422`), mesma chave em
  outra rota (`422`), chave expirada (reprocessa) e duas requisições simultâneas
  (um único registro).

## Alternativas consideradas

- **Redis com TTL:** expira sozinho, mas não participa da transação do Postgres;
  uma falha entre os dois deixaria chave sem operação ou o contrário.
- **Header obrigatório:** mais seguro, mas atrapalha testes manuais e scripts.
- **Savepoint antes do insert:** funciona, mas o Prisma não expõe savepoints de
  forma simples.
- **Hash do corpo bruto:** frágil a espaços e ordem de chaves.
- **Lock consultivo (`pg_advisory_xact_lock`) pela chave:** correto, mas mais
  difícil de entender que o `ON CONFLICT`.
