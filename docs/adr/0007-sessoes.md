# 0007. Sessões e proteção CSRF

- Status: Aceito
- Data: 2026-09-23

## Contexto

A stack define "sessão em cookie httpOnly", e o agente `security` exige rotação no
login e invalidação no logout e na troca de senha. Isso só é possível com sessão
guardada no servidor. Faltava decidir onde, e como tratar CSRF.

## Decisão

**Armazenamento:** tabela `session` no **Postgres**. O Redis fica só para o BullMQ.

- Token: 32 bytes aleatórios (`crypto.randomBytes`), base64url, enviado no cookie.
- Banco guarda só o **SHA-256 do token**: um vazamento do banco não gera sessões válidas.
- Colunas: `id`, `user_id`, `token_hash` (único), `created_at`, `last_seen_at`,
  `expires_at`, `user_agent`, `ip`.
- Expiração: 30 dias absolutos; 7 dias sem uso também expira.
  `last_seen_at` atualizado no máximo uma vez por hora (evita escrita a cada requisição).
- Login cria sessão nova (rotação). Logout apaga a sessão atual. Troca de senha e
  exclusão de conta apagam todas as sessões do usuário.

**Cookie:** `httpOnly`, `sameSite=lax`, `path=/`; em produção `secure` e nome
`__Host-sid`, em desenvolvimento `sid`.

**CSRF:** `sameSite=lax` + verificação de origem nas requisições que alteram dados
(`POST`, `PUT`, `PATCH`, `DELETE`): se o header `Origin` estiver presente e for
diferente de `WEB_ORIGIN`, responder `403`. A API aceita só `application/json`
nessas rotas.

**Desenvolvimento:** o Vite faz proxy de `/api` para a API, então web e API ficam
na mesma origem e o cookie funciona sem configurar CORS com credenciais.

**Implementação:** `@fastify/cookie` + código próprio (~100 linhas), por ser
objetivo de estudo. Senhas com argon2id (`@node-rs/argon2` ou `argon2`).

## Consequências

- Uma query por requisição autenticada para validar a sessão (aceitável).
- Job diário apaga sessões expiradas.

## Alternativas consideradas

- **JWT stateless:** não permite revogar sessão sem blocklist, que traz o estado de volta.
- **Sessão no Redis:** mais rápido, mas "apagar todas as sessões do usuário" exige
  índice extra, e o Redis passaria a ser dado crítico.
- **Better Auth / Lucia:** boas opções prontas; ficam como alternativa se o código
  próprio crescer demais.
