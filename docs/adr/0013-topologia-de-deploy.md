# 0013. Topologia de deploy: mesma origem

- Status: Proposto
- Data: 2026-09-23

## Contexto

O ADR 0007 usa cookie `__Host-sid` com `sameSite=lax` e dispensa CORS porque web
e API ficam na mesma origem. Em desenvolvimento o proxy do Vite garante isso. Em
produção, plataformas como Railway e Render sugerem um serviço por app, cada um
com domínio próprio: o navegador deixa de enviar o cookie e o login quebra. O
BullMQ também precisa de um processo worker, e as migrations precisam rodar antes
da versão nova.

## Decisão (recomendada)

- **Uma imagem, dois processos:**
  - `web`: Fastify servindo a API sob `/api/*` e o build estático do `apps/web`
    (`@fastify/static`, fallback para `index.html` nas rotas da SPA);
  - `worker`: mesma imagem, comando diferente, só consome filas BullMQ.
- **Um domínio** (ex.: `finapp.exemplo.com`); `WEB_ORIGIN` = essa URL.
- **Todas as rotas da API sob `/api`**, também em dev, para o proxy do Vite e a
  produção se comportarem igual.
- **Migrations** (`prisma migrate deploy`) como comando de pré-deploy da
  plataforma; se falharem, a versão nova não sobe.
- **Proxy da plataforma:** `trustProxy` configurado com o número exato de saltos,
  para `request.ip` (rate limit, sessão) ser o IP real e não o do balanceador.
- Postgres e Redis gerenciados pela plataforma; TLS terminado nela; HSTS via helmet.
- Cache: `index.html` sem cache; assets com hash com `Cache-Control: immutable`.

## Consequências

- Cookie, CSRF (`Origin` = `WEB_ORIGIN`) e ausência de CORS funcionam igual em
  dev e produção.
- Deploy do front e da API é sempre conjunto (mesma versão), o que evita contrato
  desencontrado.
- Escalar web e worker de forma independente continua possível (mesma imagem).

## Alternativas consideradas

- **Domínios diferentes + CORS com credenciais + `sameSite=none`:** perde a
  proteção CSRF do `lax`, exige CORS perfeito e cookies de terceiros tendem a ser
  bloqueados pelos navegadores.
- **Subdomínios (`app.` e `api.`):** mesmo site, mas ainda exige CORS com
  credenciais e impede o prefixo `__Host-` compartilhado.
- **CDN para o front + proxy de `/api` no CDN:** válido, mas mais uma peça para
  configurar; fica para quando houver tráfego que justifique.
