# 0011. Versões da stack e política de atualização

- Status: Aceito
- Data: 2026-09-23

## Contexto

O CLAUDE.md pedia "Node 20+", React 18 e PostgreSQL 16. O Node 20 saiu de suporte
em abril de 2026, e o shadcn/ui atual gera código para React 19 e Tailwind 4. Sem
versões fixadas, cada agente segue a documentação de uma versão diferente, e o
scaffold nasce desatualizado.

Consulta ao npm e ao nodejs.org em 2026-09-23 mostrou duas armadilhas:

- A dist-tag `latest` do pacote `prisma` aponta para `8.0.0-rc.15` (release
  candidate). A última estável é a `7.10.0`.
- `typescript@latest` é a `7.0.2` (compilador nativo), mas o `typescript-eslint`
  8.70 aceita `typescript >=4.8.4 <6.1.0`. Usar o TS 7 quebra o lint.

## Decisão

**Versões (major fixado, faixa `^` no `package.json`, exata no lockfile)**

| Área | Pacote | Major |
|---|---|---|
| Runtime | Node.js | **24 LTS** (`.nvmrc` + `engines: ">=24 <25"`) |
| Gerenciador | pnpm via corepack | 12 (`packageManager` no `package.json` raiz) |
| Monorepo | turbo | 2 |
| Linguagem | typescript | **6** (não 7, ver contexto) |
| Lint | eslint + typescript-eslint | 10 + 8 (flat config) |
| API | fastify | 5 |
| Validação | zod | 4 |
| ORM | prisma + @prisma/client + @prisma/adapter-pg | **7** (não 8 rc) |
| Banco | PostgreSQL | **18** (`postgres:18-alpine`) |
| Fila | bullmq + Redis | 6 + Redis 8 (`redis:8-alpine`) |
| Senha | @node-rs/argon2 | 2 (binário pré-compilado, sem build nativo no Windows) |
| Web | react + react-dom | 19 |
| Build web | vite + @vitejs/plugin-react | 8 + 6 |
| Rotas | react-router | 8 |
| Dados | @tanstack/react-query | 5 |
| Formulários | react-hook-form + @hookform/resolvers | 7 + 5 |
| Estilo | tailwindcss + @tailwindcss/vite, shadcn (CLI) | 4, 4 |
| Gráficos | recharts | 3 |
| Testes | vitest, @playwright/test, fast-check, testcontainers, supertest | 5, 1, 4, 12, 7 |
| Decimais | decimal.js | 10 |

**Regras**

- Não instalar pré-release (`rc`, `beta`, `next`) nem confiar em `latest` sem
  conferir: instalar com o major explícito (`pnpm add prisma@7`).
- Mudança de major é decisão consciente: PR próprio, changelog lido, testes
  passando. Se mudar algo desta tabela, atualizar este ADR (ou criar um que o
  substitua) e o CLAUDE.md.
- pnpm bloqueia scripts de instalação de dependências por padrão. Liberar só os
  necessários (ex.: `prisma`, `@prisma/engines`, `esbuild`) com
  `pnpm approve-builds`, que grava a lista no `pnpm-workspace.yaml` versionado.
- Dependabot semanal, agrupando patches e minors; majors em PR separado.
- CI usa a mesma versão de Node do `.nvmrc`.

**Pontos de atenção por versão** (conferir na documentação oficial ao configurar)

- Prisma 7: configuração em `prisma.config.ts` (inclusive o seed), gerador
  `prisma-client` com `output` explícito e driver adapter (`@prisma/adapter-pg`).
- Zod 4: validadores de formato no topo (`z.uuid()`, `z.email()`,
  `z.iso.date()` para `"YYYY-MM-DD"`); mensagens de erro mudaram de API.
- Tailwind 4: configuração em CSS (`@import "tailwindcss"`, `@theme`), plugin do Vite.
- React Router 8: usar como biblioteca de rotas numa SPA; não usar o modo
  framework (SSR/loaders no servidor), porque a API é o Fastify.

## Consequências

- O scaffold começa em versões suportadas; o Node 24 é LTS até abril de 2028.
- PostgreSQL 18 traz `uuidv7()` nativo, útil para ids ordenáveis por tempo.
- Revisar este ADR quando o Node 26 virar LTS (outubro de 2026), quando o
  `typescript-eslint` suportar o TS 7 e quando o Prisma 8 sair estável.

## Alternativas consideradas

- **Sempre `latest`:** traria um Prisma release candidate e um TypeScript que quebra o lint.
- **Manter React 18 / Node 20:** Node 20 sem suporte; shadcn e React Router atuais
  exigem React 19.
- **PostgreSQL 16:** ainda suportado, mas sem motivo para começar um projeto novo
  duas versões atrás.
- **`argon2` (node-gyp):** compila código nativo na instalação; no Windows exige
  ferramentas de build.
