# 0006. Idempotência de operações financeiras

- Status: Aceito
- Data: 2026-09-23

## Contexto

A regra 7 do CLAUDE.md exige `Idempotency-Key` na criação de transações, despesas
e acertos, mas não dizia onde guardar, por quanto tempo, nem o que responder na
repetição.

## Decisão

**Armazenamento:** tabela `idempotency_key` no **Postgres** (não Redis), para que o
registro da chave e a operação sejam atômicos na mesma `$transaction`.

Colunas: `user_id`, `key`, `method`, `route`, `request_hash` (SHA-256 do corpo
normalizado), `response_status`, `response_body jsonb`, `created_at`.
Chave única `(user_id, key)`: a mesma chave de usuários diferentes não colide.

**Fluxo**

1. Sem header: a operação roda normalmente (o header é opcional na API).
2. Com header, dentro da transação: insere a chave primeiro.
   - Requisição concorrente com a mesma chave espera no índice único; quando a
     primeira confirma, a segunda recebe violação de unicidade e segue para o passo 3.
3. Chave já existente:
   - mesmo `request_hash` → devolve a resposta guardada, mesmo status, com header
     `Idempotent-Replayed: true`;
   - hash diferente → `422 IDEMPOTENCY_KEY_REUSED`.
4. Só respostas `2xx` são guardadas. Se a operação falha, a transação é desfeita e
   a chave some junto, então o cliente pode tentar de novo.

**Validade:** 24 horas; job BullMQ diário apaga as expiradas.

**Frontend:** gera um `crypto.randomUUID()` quando o formulário abre e reenvia o
mesmo valor em retentativas daquele envio.

## Consequências

- Implementado como plugin/hook do Fastify reutilizável, não em cada rota.
- Testes de integração: repetição sequencial, repetição com corpo diferente e
  duas requisições simultâneas com a mesma chave.

## Alternativas consideradas

- **Redis com TTL:** expira sozinho, mas não participa da transação do Postgres;
  uma falha entre os dois deixaria chave sem operação ou o contrário.
- **Header obrigatório:** mais seguro, mas atrapalha testes manuais e scripts.
