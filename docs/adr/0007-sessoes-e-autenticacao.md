# 0007. Sessões, CSRF e proteção de autenticação

- Status: Aceito
- Data: 2026-09-23

## Contexto

A stack define "sessão em cookie httpOnly" e o agente `security` exige rotação no
login, invalidação no logout e na troca de senha, e rate limit em login, cadastro
e recuperação de senha. Isso exige sessão guardada no servidor. Faltava decidir
onde, como tratar CSRF, onde fica o rate limit e com que limites, como o e-mail é
comparado (`Ana@x.com` e `ana@x.com` virariam duas contas), a política de senha e
os parâmetros do argon2id.

## Decisão

**Sessão:** tabela `session` no **Postgres**.

- Token: 32 bytes aleatórios (`crypto.randomBytes`), base64url, enviado no cookie.
- Banco guarda só o **SHA-256 do token**: um vazamento do banco não gera sessões válidas.
- Colunas: `id`, `user_id`, `token_hash` (único), `created_at`, `last_seen_at`,
  `expires_at`, `user_agent`, `ip`.
- Expiração: 30 dias absolutos; 7 dias sem uso também expira.
  `last_seen_at` atualizado no máximo uma vez por hora (evita escrita a cada requisição).
- Login cria sessão nova (rotação). Logout apaga a sessão atual. Troca de senha,
  reset de senha e exclusão de conta apagam todas as sessões do usuário.
- Implementação com `@fastify/cookie` + código próprio (~100 linhas), por ser
  objetivo de estudo.

**Cookie:** `httpOnly`, `sameSite=lax`, `path=/`; em produção `secure` e nome
`__Host-sid`, em desenvolvimento `sid`.

**CSRF:** `sameSite=lax` + verificação de origem nas requisições que alteram dados
(`POST`, `PUT`, `PATCH`, `DELETE`): se o header `Origin` estiver presente e for
diferente de `WEB_ORIGIN`, responder `403`. A API aceita só `application/json`
nessas rotas. `GET` nunca altera nada. Web e API ficam na mesma origem (proxy do
Vite em dev, ADR 0013 em produção), sem CORS.

**E-mail**

- Normalizado no schema Zod de `packages/shared`: `trim()` + minúsculas, validado
  com `z.email()`. Sem remover pontos ou `+tag` (não é regra universal).
- Banco: índice único em `lower(email)` (SQL na migration) como segunda defesa.

**Senha**

- Mínimo 10 e máximo 128 caracteres, sem regras de composição (orientação NIST
  800-63B); recusar senha igual ao e-mail.
- argon2id via `@node-rs/argon2` com os parâmetros mínimos da OWASP: `memoryCost`
  19 MiB, `timeCost` 2, `parallelism` 1; rehash no login se os parâmetros mudarem.
- Login com e-mail inexistente também roda um `verify` contra hash fictício,
  para o tempo de resposta não revelar se a conta existe. Mensagem única:
  "E-mail ou senha inválidos".

**Rate limit** (`@fastify/rate-limit` com store no **Redis**)

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

- Uma query por requisição autenticada para validar a sessão (aceitável).
- Job diário apaga sessões expiradas.
- Redis passa a ser necessário também na API (não só no worker); se cair, a API
  falha fechada nas rotas de auth.
- Testes de integração cobrem o `429` e a normalização de e-mail.

## Alternativas consideradas

- **JWT stateless:** não permite revogar sessão sem blocklist, que traz o estado de volta.
- **Sessão no Redis:** mais rápido, mas "apagar todas as sessões do usuário" exige
  índice extra, e o Redis passaria a ser dado crítico.
- **Better Auth / Lucia:** boas opções prontas; ficam como alternativa se o código
  próprio crescer demais.
- **`argon2` (node-gyp):** compila código nativo; no Windows exige ferramentas de build.
- **Rate limit com store em memória:** zera a cada deploy e não funciona com mais
  de uma instância.
- **`citext` na coluna de e-mail:** funciona, mas exige extensão no banco; a
  normalização + índice em `lower()` dá o mesmo resultado.
- **CAPTCHA no cadastro:** fica para quando houver abuso real.
