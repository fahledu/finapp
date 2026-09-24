# 0011. Autenticação, sessões, e-mail e tokens

- Status: Aceito
- Data: 2026-09-24

## Contexto

A stack define "sessão em cookie httpOnly" e o agente `security` exige rotação no
login, invalidação no logout e na troca de senha, e rate limit em login, cadastro
e recuperação de senha. Isso exige sessão guardada no servidor. Faltava decidir
onde, como tratar CSRF, onde fica o rate limit e com que limites, como o e-mail é
comparado (`Ana@x.com` e `ana@x.com` virariam duas contas), a política de senha e
os parâmetros do argon2id.

Vários fluxos dependem de e-mail, mas a stack não tem serviço de envio:
recuperação de senha, confirmação e troca de e-mail, cancelamento da exclusão de
conta (ADR [0012](0012-lgpd-exclusao-e-retencao.md)) e convites (ADR
[0006](0006-grupos-membros-e-convites.md)). Todos precisam de um token de uso
único com as mesmas garantias.

Três riscos moldam os limites:

- **Negação de serviço contra usuário legítimo.** Limite de login por requisição
  e por IP atinge muita gente atrás do mesmo IP (CGNAT de operadora móvel,
  universidades, empresas), e login bem-sucedido consumiria cota. "Pedir um novo
  token de reset invalida os anteriores", somado a 3 pedidos/h por e-mail,
  deixaria um atacante invalidar o link que a vítima acabou de receber e esgotar
  a cota dela.
- **Enumeração de contas.** Login, reset e cadastro não podem revelar, pela
  resposta nem pelo tempo, se um e-mail tem conta.
- **Token em claro fora do hash.** Se o token viajasse no payload do outbox (ADR
  [0009](0009-escrita-transacao-idempotencia-e-outbox.md)), ficaria legível na
  tabela, no Redis e em backups tirados nessa janela.

## Decisão

### Sessão

Tabela `session` no **Postgres**.

- Token: 32 bytes aleatórios (`crypto.randomBytes`), base64url, enviado no cookie.
- Banco guarda só o **SHA-256 do token**: um vazamento do banco não gera sessões válidas.
- Colunas: `id`, `user_id`, `token_hash` (único), `created_at`, `last_seen_at`,
  `expires_at`, `user_agent`, `ip`.
- Expiração: 30 dias absolutos; 7 dias sem uso também expira. `last_seen_at`
  atualizado no máximo uma vez por hora (evita escrita a cada requisição).
- Login cria sessão nova (rotação). Logout apaga a sessão atual.
- **Troca de senha** (usuário logado) mantém a sessão atual e apaga as demais.
  **Reset de senha** e exclusão de conta (ADR 0012) apagam todas.
- Job diário apaga sessões expiradas. `ip` e `user_agent` seguem a retenção do
  ADR 0012.
- Implementação com `@fastify/cookie` + código próprio (~100 linhas), por ser
  objetivo de estudo.

**Cookie:** `httpOnly`, `sameSite=lax`, `path=/`; em produção `secure` e nome
`__Host-sid`, em desenvolvimento `sid`.

**CSRF:** `sameSite=lax` + verificação de origem nas requisições que alteram dados
(`POST`, `PUT`, `PATCH`, `DELETE`): se o header `Origin` estiver presente e for
diferente de `WEB_ORIGIN`, responder `403`. A API aceita só `application/json`
nessas rotas. `GET` nunca altera nada. Web e API ficam na mesma origem (proxy do
Vite em dev, ADR [0014](0014-deploy-ambientes-e-observabilidade.md) em produção),
sem CORS.

### E-mail do usuário

- Normalizado no schema Zod de `packages/shared`: `trim()` + minúsculas, validado
  com `z.email()`. Sem remover pontos ou `+tag` (não é regra universal).
- Banco: índice único em `lower(email)` (SQL na migration) como segunda defesa.
- Vale para cadastro, login, reset e troca de e-mail.

### Senha

- Mínimo 10 e máximo 128 caracteres, sem regras de composição (orientação NIST
  800-63B); recusar senha igual ao e-mail.
- argon2id via `@node-rs/argon2` com os parâmetros mínimos da OWASP: `memoryCost`
  19 MiB, `timeCost` 2, `parallelism` 1; rehash no login se os parâmetros mudarem.
- Login com e-mail inexistente também roda um `verify` contra hash fictício,
  para o tempo de resposta não revelar se a conta existe. Mensagem única:
  "E-mail ou senha inválidos".

### Cadastro sem revelar e-mail existente

`POST /api/auth/register` responde **sempre igual**, com o mesmo status (`202`) e
a mesma mensagem ("Cadastro recebido. Confira seu e-mail."), exista ou não conta
com aquele e-mail. Erros de validação (`422 VALIDATION_ERROR`) não dependem da
existência da conta e continuam normais.

- E-mail novo: cria o usuário e enfileira o e-mail de verificação (`EMAIL_VERIFY`).
- E-mail já cadastrado: não cria conta nem altera a existente; enfileira para o
  dono um e-mail sem token ("você já tem conta; esqueceu a senha?", com link para
  a página de reset).
- O hash argon2id da senha enviada roda **nos dois casos**, e os dois caminhos
  gravam uma linha no outbox, para o tempo de resposta não diferenciar.
- O cadastro não abre sessão (abrir só no caso novo revelaria a diferença); a
  pessoa faz login em seguida.

### Troca de senha

- Rota autenticada; exige a senha atual e a nova (mesma política acima).
- Senha atual errada → `403 INVALID_CURRENT_PASSWORD`. A falha conta nos mesmos
  contadores de falha do login (IP + e-mail do usuário e IP), para uma sessão
  roubada não servir de força bruta contra a senha.
- Sucesso: grava o novo hash e apaga as outras sessões do usuário; a atual continua.

### Troca de e-mail

- Rota autenticada; exige a senha atual (erro e contagem de falhas como na troca
  de senha). O e-mail novo segue a normalização acima.
- O pedido grava o endereço em `user.pending_email` (substitui um pedido anterior)
  e enfileira dois e-mails: token `EMAIL_CHANGE` para o endereço **novo** e aviso
  sem token para o endereço **atual** ("pediram a troca do e-mail da sua conta; se
  não foi você, troque sua senha").
- Resposta neutra e igual em todos os casos. Se o e-mail novo já pertence a outra
  conta, nenhum token é gerado nem enviado ao endereço novo (o aviso ao atual sai
  do mesmo jeito); a conta não é revelada.
- A troca só acontece na **confirmação** (`POST` com o token): na mesma
  transação, confere de novo a unicidade (se outra conta tomou o endereço nesse
  meio-tempo → `409 EMAIL_TAKEN`; aqui quem pergunta prova controle da caixa),
  grava `email = new_email` do token, limpa `pending_email`, marca o e-mail como
  confirmado e consome o token.
- Sessões são mantidas.

### Rate limit

Store no **Redis**. Estouro → `429 RATE_LIMITED` com `Retry-After`.

| Rota | Conta | Limite | Chave | Onde |
|---|---|---|---|---|
| `POST /api/auth/login` | só falhas | 5/min e 20/h | IP + e-mail normalizado | service de auth |
| `POST /api/auth/login` | só falhas | 100/h | IP | service de auth |
| `POST /api/auth/register` | requisições | 5/h | IP | `@fastify/rate-limit` |
| `POST /api/auth/password-reset` | requisições | 3/h | e-mail normalizado | `@fastify/rate-limit` |
| `POST /api/auth/password-reset` | requisições | 10/h | IP | `@fastify/rate-limit` |
| Demais rotas autenticadas | requisições | 300/min | sessão | `@fastify/rate-limit` |

**Login conta só falhas.**

- Contadores no Redis, incrementados pelo service de auth quando a credencial é
  inválida (o `@fastify/rate-limit` conta requisições, não falhas).
- Consultados **antes** de verificar a senha: com o limite estourado, não se roda
  o argon2.
- Login bem-sucedido zera o contador de IP + e-mail (o de IP não).
- Chaves com e-mail vivem só pelo TTL da janela (no máximo 1 h, ADR 0012).

**Geral**

- Sem bloqueio permanente de conta (seria DoS contra a vítima); o limite por
  IP + e-mail já contém força bruta.
- Depende de `trustProxy` correto (ADR 0014), senão todos compartilham o IP do proxy.
- Se o Redis cair, a API falha fechada nas rotas de auth.

### Envio de e-mail

- Interface `EmailSender` em `apps/api/src/integrations/email/`, implementada com
  `nodemailer` via SMTP. Trocar de provedor é só trocar variáveis de ambiente.
- Desenvolvimento e testes: **Mailpit** no Docker Compose (captura tudo, interface
  web na porta 8025). Nenhum e-mail real sai da máquina.
- Produção: provedor transacional com SMTP (ex.: Resend, Postmark, Amazon SES),
  com SPF, DKIM e DMARC configurados no domínio.
- Envio sempre por **job BullMQ** disparado pelo outbox (ADR 0009), com retry e
  backoff; nunca dentro da requisição.
- Templates em português, texto simples + HTML, sem dado financeiro no corpo.
- Handlers de e-mail não enviam nada a usuário com `status = 'DELETED'` (ADR 0012).

### Tokens de uso único

Tabela `user_token`: `id`, `user_id`, `type`, `token_hash` (SHA-256, único),
`new_email` (só `EMAIL_CHANGE`), `job_id` (id do `outbox_job` que o gerou, único
quando preenchido), `expires_at`, `used_at`, `created_at`.

| Tipo | Validade | Pedido novo |
|---|---|---|
| `EMAIL_VERIFY` | 24 h | invalida os anteriores do tipo |
| `PASSWORD_RESET` | 1 h | **não** invalida; até 3 ativos |
| `EMAIL_CHANGE` | 24 h | invalida os anteriores do tipo |
| `ACCOUNT_DELETION_CANCEL` | até o fim dos 30 dias da exclusão (ADR 0012) | invalida os anteriores do tipo |

**Geração pelo handler do job.** O outbox leva só `userId` e o tipo (ADR 0009).
O handler, na própria transação:

1. trava a linha do `user` (`FOR UPDATE`), para dois handlers do mesmo usuário
   não furarem as regras abaixo;
2. apaga o token **não usado** que o mesmo `job_id` tenha criado numa tentativa
   anterior (retry ou entrega duplicada);
3. aplica a regra do tipo: invalida os anteriores ou verifica o limite de 3
   `PASSWORD_RESET` ativos (sem contar o que acabou de apagar; se já houver 3,
   encerra sem gerar token nem enviar);
4. gera 32 bytes de `crypto.randomBytes` (base64url) e grava só o hash, com esse
   `job_id` e `expires_at` calculado a partir do fato de origem quando houver
   (ex.: `deletion_requested_at` + 30 dias), não da hora do job;
5. confirma e só então envia o e-mail.

Assim uma retentativa nunca deixa dois tokens do mesmo pedido: se um e-mail
duplicado sair, só o link mais novo funciona.

Nenhum token em claro passa por banco, Redis ou backup: ele existe só na memória
do handler até o envio. Token nunca vai para log.

**Uso**

- Uso único: consumir marca `used_at` na mesma transação da ação.
- O token vai no link como parâmetro; a página faz `POST` com ele (GET nunca
  altera nada).
- Respostas de pedido não revelam se o e-mail existe ("se houver conta, enviamos
  um link").

**Reset de senha**

- Pedido novo não invalida os tokens `PASSWORD_RESET` anteriores.
- No máximo 3 tokens `PASSWORD_RESET` ativos (não usados e não expirados) por
  usuário, coerente com 3 pedidos/h por e-mail. O limite é verificado **no
  handler**: se já houver 3, o job termina sem gerar token nem e-mail. A resposta
  ao pedido é sempre a neutra.
- Usar qualquer um deles invalida todos (`used_at` em todos, na mesma transação)
  e apaga todas as sessões do usuário.
- Os e-mails que um atacante dispara chegam à própria vítima, com links válidos;
  não há como bloquear o reset dela.

**Confirmação de e-mail:** o cadastro envia `EMAIL_VERIFY`; o login funciona
antes de confirmar, mas aceitar convite com e-mail exige e-mail confirmado (ADR
0006). Confirmar uma troca de e-mail (`EMAIL_CHANGE`) também marca o endereço
novo como confirmado.

### Testes obrigatórios

- Integração com Redis real (Testcontainers): login bem-sucedido não consome
  cota; 6ª falha em 1 min para o mesmo IP + e-mail → `429` com `Retry-After`;
  limites de cadastro e reset → `429`.
- Normalização de e-mail (`Ana@x.com` e `ana@x.com` são a mesma conta).
- Cadastro com e-mail existente: mesma resposta e status do cadastro novo, nenhuma
  conta criada, e-mail "você já tem conta" no Mailpit.
- Pedido de reset não invalida o link anterior; o 4º pedido com 3 ativos não gera
  token; usar um token invalida os outros e apaga todas as sessões.
- Troca de senha mantém a sessão atual e apaga as demais; senha atual errada →
  `403` e conta como falha.
- Troca de e-mail: nada muda antes da confirmação; confirmação troca o e-mail,
  mantém as sessões; o endereço antigo recebe aviso; e-mail já usado não gera token.
- Handler de e-mail executado duas vezes com o mesmo `job_id`: fica um único
  token válido (o do segundo envio; o link do primeiro falha), e a retentativa de
  um reset não conta contra o limite de 3.

## Consequências

- Uma query por requisição autenticada para validar a sessão (aceitável).
- Redis passa a ser necessário também na API (não só no worker).
- Muitos usuários atrás do mesmo IP logam normalmente; só erro de senha conta.
  O limite por IP (100 falhas/h) segura quem testa muitos e-mails. Como o
  contador é consultado antes do argon2, com esse limite estourado todos os
  logins daquele IP recebem `429`, inclusive os com senha certa, até a janela
  passar. Aceito: é o custo de não rodar o hash sob ataque.
- O rate limit do login é código do service de auth, com teste de integração
  próprio; os demais ficam no plugin.
- O cadastro fica um pouco menos direto: a pessoa não entra logada e, se já tinha
  conta, descobre pelo e-mail. É o preço de não revelar contas.
- A criação do token sai da transação da requisição: a requisição confirma a
  intenção (usuário criado, pedido de reset, exclusão pedida) e o token nasce
  segundos depois, no worker. Worker parado atrasa os e-mails, mas não perde
  nenhum (o outbox garante a entrega).
- Retentativas e entregas duplicadas não consomem as 3 vagas de reset nem deixam
  tokens sobrando, graças ao `job_id`.
- Mailpit é um serviço a mais no Compose; o deploy precisa de secrets de SMTP.

## Alternativas consideradas

- **JWT stateless:** não permite revogar sessão sem blocklist, que traz o estado de volta.
- **Sessão no Redis:** mais rápido, mas "apagar todas as sessões do usuário" exige
  índice extra, e o Redis passaria a ser dado crítico.
- **Better Auth / Lucia:** boas opções prontas; ficam como alternativa se o código
  próprio crescer demais.
- **`argon2` (node-gyp):** compila código nativo; no Windows exige ferramentas de build.
- **Rate limit com store em memória:** zera a cada deploy e não funciona com mais
  de uma instância.
- **Rate limit de login por requisição, só aumentando o de IP:** login
  bem-sucedido continuaria consumindo cota, e um valor alto enfraquece o limite
  contra ataque.
- **Bloqueio de conta após N falhas:** DoS contra a vítima.
- **`citext` na coluna de e-mail:** funciona, mas exige extensão no banco; a
  normalização + índice em `lower()` dá o mesmo resultado.
- **CAPTCHA no cadastro, login e reset:** fica para quando houver abuso real.
- **Cadastro que responde `409` para e-mail existente:** mais simples para o
  usuário, mas enumera contas.
- **Reset em que pedido novo invalida o anterior:** permite o DoS descrito no contexto.
- **Token em claro no payload do outbox:** permitiria criar o token na transação
  da requisição, mas o token ficaria legível na tabela, no Redis e em backups.
- **Troca de e-mail imediata, sem confirmação:** um erro de digitação ou uma
  sessão roubada tiraria a conta do dono.
- **Troca de senha apagando todas as sessões:** desloga o próprio usuário sem ganho;
  as outras sessões, que são o risco, caem do mesmo jeito.
- **SDK específico de um provedor de e-mail:** acopla o código ao fornecedor.
- **Enviar e-mail dentro da requisição:** lento e perde o e-mail se o provedor falhar.
- **JWT como token de reset:** não dá para revogar nem garantir uso único sem tabela.
