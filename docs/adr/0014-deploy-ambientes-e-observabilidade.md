# 0014. Deploy, ambientes e observabilidade

- Status: Aceito
- Data: 2026-09-24

## Contexto

O ADR [0011](0011-autenticacao-sessoes-email-e-tokens.md) usa cookie `__Host-sid`
com `sameSite=lax` e dispensa CORS porque web e API ficam na mesma origem. Em
desenvolvimento o proxy do Vite garante isso. Em produção, plataformas como
Railway e Render sugerem um serviço por app, cada um com domínio próprio: o
navegador deixa de enviar o cookie e o login quebra. O BullMQ também precisa de
um processo worker, e as migrations precisam rodar antes da versão nova.

Desenvolvimento, testes e CI precisam do mesmo Postgres, Redis e servidor de
e-mail que a produção usa, sem depender de serviços instalados à mão. E, em
produção, algumas falhas são silenciosas: Redis fora faz o outbox acumular
(ADR [0009](0009-escrita-transacao-idempotencia-e-outbox.md)), e um expurgo LGPD
que não roda (ADR [0012](0012-lgpd-exclusao-e-retencao.md)) descumpre prazo legal
sem nenhum erro visível para o usuário.

## Decisão

**Topologia de produção**

- **Uma imagem, dois processos:**
  - `web`: Fastify servindo a API sob `/api/*` e o build estático do `apps/web`
    (`@fastify/static`, fallback para `index.html` nas rotas da SPA);
  - `worker`: mesma imagem, comando diferente, só consome filas BullMQ (inclui a
    varredura do outbox a cada minuto e os jobs agendados).
- **Um domínio** (ex.: `finapp.exemplo.com`); `WEB_ORIGIN` = essa URL.
- **Todas as rotas da API sob `/api`**, também em dev, para o proxy do Vite e a
  produção se comportarem igual.
- **Migrations** (`prisma migrate deploy`) como comando de pré-deploy da
  plataforma; se falharem, a versão nova não sobe.
- **Proxy da plataforma:** `trustProxy` configurado com o número exato de saltos,
  para `request.ip` (rate limit, sessão) ser o IP real e não o do balanceador.
- Postgres e Redis gerenciados pela plataforma; TLS terminado nela; HSTS via helmet.
- Cache: `index.html` sem cache; assets com hash com `Cache-Control: immutable`.
- Backups e retenção de logs seguem o ADR [0012](0012-lgpd-exclusao-e-retencao.md).

**Ambientes de desenvolvimento e teste**

- **Desenvolvimento:** Docker Compose com Postgres (`postgres:18-alpine`), Redis
  (`redis:8-alpine`) e **Mailpit** (captura todo e-mail; interface web na porta
  8025). Imagens com versão fixa, volumes nomeados e healthchecks.
- **Testes de integração:** sobem **Postgres e Redis** reais com Testcontainers,
  inclusive no CI. O workflow **não** declara service container; o runner já tem
  Docker.
- **Limpeza entre testes com `TRUNCATE`.** Os triggers do ADR
  [0010](0010-soft-delete-auditoria-e-garantias-no-banco.md) recusam `DELETE`
  nas tabelas protegidas; `TRUNCATE` não dispara trigger por linha. Fora dos
  testes, `TRUNCATE` nunca aparece.
- **E2E (Playwright):** usa o Mailpit como servidor SMTP e lê os e-mails
  (verificação, reset, convite) pela **API HTTP do Mailpit**, sem raspar a
  interface web. Roda em job separado no CI.
- **CI:** Node da versão do `.nvmrc`; lint → typecheck → testes unitários e de
  integração → build, numa matriz com `TZ=UTC` e `TZ=America/Sao_Paulo`, para
  pegar bugs de fuso (ADR [0002](0002-datas-e-fusos.md)).

**Observabilidade mínima**

- **`GET /api/health`** (liveness): responde `200` sem consultar dependências.
  Serve para a plataforma saber que o processo está de pé.
- **`GET /api/health/ready`** (readiness): verifica Postgres e Redis e informa
  tamanho da fila do outbox e idade da linha mais antiga. Responde `503` se
  Postgres ou Redis falharem. O corpo traz só o estado de cada verificação e os
  números do outbox, sem dado de usuário. Ambas as rotas são públicas (sem
  sessão) e seguem o ADR [0013](0013-convencoes-de-api.md) (schema de resposta).
- **Logs estruturados do pino** em JSON, com `requestId` em toda linha da
  requisição. `redact` e retenção conforme o ADR
  [0012](0012-lgpd-exclusao-e-retencao.md); payload de job nunca é logado.
- **Erros 5xx:** stack e detalhes só no log, junto com o `requestId`; a resposta
  leva mensagem genérica (ADR [0013](0013-convencoes-de-api.md)).
- **Alertas da plataforma** (sobre readiness e logs), para:
  1. readiness falhando;
  2. linha de `outbox_job` com mais de **10 min**;
  3. job com falha definitiva (esgotou as tentativas do BullMQ; o handler de
     falha loga em nível `error` com fila, nome e id do job);
  4. **job de expurgo LGPD atrasado:** conta com `deletion_requested_at` cujo
     prazo de 30 dias venceu há mais de **24 h** sem expurgo.
- **Ferramenta de captura de erros** (ex.: Sentry) é opcional na V1. O mínimo é
  log estruturado + os alertas acima.

## Consequências

- Cookie, CSRF (`Origin` = `WEB_ORIGIN`) e ausência de CORS funcionam igual em
  dev e produção.
- Deploy do front e da API é sempre conjunto (mesma versão), o que evita contrato
  desencontrado.
- Escalar web e worker de forma independente continua possível (mesma imagem).
- A plataforma só manda tráfego para instância pronta; Redis fora tira a
  instância de rotação em vez de aceitar escrita cujo job vai ficar parado.
- O alerta de idade do outbox cobre o worker parado, que a readiness do `web`
  não vê (o `web` segue saudável enquanto o outbox cresce).
- Precisa existir uma forma de medir o atraso do expurgo: consulta periódica (no
  próprio `worker` ou na readiness) que loga a quantidade de contas vencidas, para
  a plataforma alertar.
- Testes de integração ficam mais lentos no primeiro container, mas testam o
  mesmo Postgres 18 e Redis 8 da produção, inclusive triggers e rate limit.
- `.env.example` documenta `WEB_ORIGIN`, `API_DOCS_ENABLED`, SMTP e as URLs de
  Postgres e Redis; secrets de produção ficam na plataforma, nunca no repositório.

## Alternativas consideradas

- **Domínios diferentes + CORS com credenciais + `sameSite=none`:** perde a
  proteção CSRF do `lax`, exige CORS perfeito e cookies de terceiros tendem a ser
  bloqueados pelos navegadores.
- **Subdomínios (`app.` e `api.`):** mesmo site, mas ainda exige CORS com
  credenciais e impede o prefixo `__Host-` compartilhado.
- **CDN para o front + proxy de `/api` no CDN:** válido, mas mais uma peça para
  configurar; fica para quando houver tráfego que justifique.
- **Service container de Postgres no CI:** ambiente diferente do local; com
  Testcontainers o mesmo teste roda igual na máquina e no CI.
- **Sem readiness, só liveness:** o deploy sobe e recebe tráfego com Redis fora.
- **APM completo já na V1:** custo e configuração sem necessidade para o volume
  do projeto; log estruturado + alertas cobrem as falhas que importam.
- **Limpar o banco com `DELETE` entre testes:** barrado pelos triggers de soft
  delete e de `audit_log`.
