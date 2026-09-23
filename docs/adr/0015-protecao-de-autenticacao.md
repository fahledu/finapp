# 0015. Proteção de autenticação: e-mail, senha e rate limit

- Status: Proposto
- Data: 2026-09-23
- Complementa: [0007](0007-sessoes.md)

## Contexto

O agente security exige rate limit em login, cadastro e recuperação de senha, mas
nenhum ADR diz onde ele fica nem os limites. Também não está definido como o
e-mail é comparado (`Ana@x.com` e `ana@x.com` virariam duas contas), a política
de senha e os parâmetros do argon2id.

## Decisão (recomendada)

**E-mail**

- Normalizado no schema Zod de `packages/shared`: `trim()` + minúsculas, validado
  com `z.email()`. Sem remover pontos ou `+tag` (não é regra universal).
- Banco: índice único em `lower(email)` (SQL na migration) como segunda defesa.

**Senha**

- Mínimo 10 e máximo 128 caracteres, sem regras de composição (orientação NIST
  800-63B); recusar senha igual ao e-mail.
- argon2id com os parâmetros mínimos da OWASP: `memoryCost` 19 MiB,
  `timeCost` 2, `parallelism` 1; rehash no login se os parâmetros mudarem.
- Login com e-mail inexistente também roda um `verify` contra hash fictício,
  para o tempo de resposta não revelar se a conta existe. Mensagem única:
  "E-mail ou senha inválidos".

**Rate limit** (`@fastify/rate-limit` com store no **Redis**, que já existe)

| Rota | Limite | Chave |
|---|---|---|
| `POST /api/auth/login` | 5/min e 20/h | IP + e-mail normalizado |
| `POST /api/auth/login` | 50/h | IP |
| `POST /api/auth/register` | 5/h | IP |
| `POST /api/auth/password-reset` | 3/h | e-mail; 10/h por IP |
| Demais rotas autenticadas | 300/min | sessão |

- Estouro → `429 RATE_LIMITED` com `Retry-After`.
- Sem bloqueio permanente de conta (seria DoS contra a vítima); o limite por
  e-mail já contém força bruta.
- Depende de `trustProxy` correto (ADR 0013), senão todos compartilham o IP do proxy.

## Consequências

- Redis passa a ser necessário também na API (não só no worker); se cair, a API
  deve falhar fechada nas rotas de auth.
- Testes de integração cobrem o `429` e a normalização de e-mail.

## Alternativas consideradas

- **Store em memória:** zera a cada deploy e não funciona com mais de uma instância.
- **`citext` na coluna de e-mail:** funciona, mas exige extensão no banco; a
  normalização + índice em `lower()` dá o mesmo resultado.
- **CAPTCHA no cadastro:** fica para quando houver abuso real.
