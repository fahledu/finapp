# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# FinApp: Finanças pessoais, investimentos e divisão de gastos

> **Status:** o repositório ainda não tem código. Stack, estrutura e comandos abaixo
> são o alvo a construir (ver roadmap em `GUIA.md`). Ao criar o esqueleto, garantir
> que os scripts `pnpm` listados em "Comandos" existam com esses nomes, e remover esta nota.
> **Para retomar o trabalho, leia `docs/STATUS.md`** (fase atual, próximo passo, pendências).

Sistema web para controlar finanças pessoais (contas, transações, orçamentos),
acompanhar investimentos (carteira, cotações, rentabilidade) e dividir gastos
entre pessoas e grupos (estilo Splitwise). Projeto de estudo, mas com padrões
de produção.

## Onde cada informação mora (fonte única)

| Assunto | Fonte | Aqui e nos agentes |
|---|---|---|
| Regras de domínio e arquitetura | `docs/adr/` (índice em `docs/adr/README.md`) | só uma linha + número do ADR |
| Versões de bibliotecas | ADR 0015 | nomes, sem versão |
| Plano de uma feature | `docs/plans/<feature>.md` (architect) | nada |
| Fase atual e pendências | `docs/STATUS.md` | nada |
| Papel e processo de cada agente | `.claude/agents/<agente>.md` | nada |

Nunca copie o detalhe de uma regra para outro arquivo: cite o ADR. Mudou uma regra,
muda o ADR (e a linha do índice abaixo, se o resumo mudou). `node scripts/check-docs.mjs`
confere índice, links e números de ADR citados; um hook o roda ao fim de cada sessão.

## Stack

Versões fixadas no ADR 0015; instale sempre com o major explícito, nunca pré-release.

- **Monorepo:** pnpm workspaces + Turborepo, Node LTS (`.nvmrc`), pnpm via corepack
- **Backend (`apps/api`):** TypeScript strict, Fastify, Zod, Prisma (`@prisma/adapter-pg`), PostgreSQL
- **Frontend (`apps/web`):** React, Vite, TanStack Query, React Router (SPA), React Hook Form + Zod, Tailwind + shadcn/ui, Recharts
- **Compartilhado (`packages/shared`):** schemas Zod, tipos, dinheiro, datas e divisão (fonte única dos contratos)
- **Jobs:** BullMQ + Redis; e-mail com nodemailer (Mailpit em dev)
- **Testes:** Vitest, Supertest, Testcontainers, Playwright, fast-check
- **Infra:** Docker Compose em dev; deploy com uma imagem e processos `web` e `worker` (ADR 0014)

## Estrutura

```
apps/
  api/
    src/
      modules/<modulo>/   # routes.ts, service.ts, repository.ts, schemas.ts, *.test.ts
      common/             # db (Db, withIdempotency, runInTransaction), outbox, errors, auth
      jobs/
    prisma/schema.prisma
  web/
    src/
      features/<feature>/ # api.ts (fetch + hooks TanStack Query), components/, pages/, hooks/
      components/ui/      # shadcn/ui
      lib/
packages/
  shared/src/             # schemas/, money.ts, split.ts, settle.ts, dates.ts, types.ts
docs/
  adr/                    # decisões (fonte única das regras)
  plans/                  # planos de feature (architect)
  STATUS.md               # ponto de retomada
scripts/check-docs.mjs    # consistência da documentação
```

Módulos: `auth`, `accounts`, `transactions`, `categories`, `budgets`,
`investments`, `groups`, `expenses`, `settlements`.

## Comandos

```bash
docker compose up -d            # Postgres, Redis e Mailpit
pnpm install
pnpm dev                        # api + web em modo dev
pnpm test                       # todos os testes
pnpm -F api test                # só backend (um arquivo: pnpm -F api test -- <caminho>; por nome: -- -t "<nome>")
pnpm -F web test                # só frontend
pnpm e2e                        # Playwright
pnpm lint && pnpm typecheck     # rodar antes de considerar algo pronto
pnpm -F api db:migrate --name <descricao>                 # prisma migrate dev
pnpm -F api db:migrate --create-only --name <descricao>   # gera sem aplicar (para acrescentar SQL)
pnpm -F api db:generate
pnpm -F api db:seed
node scripts/check-docs.mjs                  # consistência da documentação
node --test .claude/hooks/hooks.test.mjs     # testes dos hooks dos agentes
```

## Regras não negociáveis (resumo; o detalhe está no ADR)

1. Dinheiro em centavos inteiros positivos + moeda; nunca float; teto `MAX_AMOUNT_CENTS`. (ADR 0001)
2. Quantidades e preços de investimento em `NUMERIC(20,8)`/`Decimal`, string no JSON. (ADR 0001)
3. Datas de competência como `"YYYY-MM-DD"`; instantes em UTC; "hoje" em `America/Sao_Paulo`. (ADR 0002)
4. Só `BRL`, `USD`, `EUR`; uma moeda por operação; totais nunca somam moedas. (ADR 0003)
5. Toda query filtra pelo dono; em grupos, só membro `ACTIVE`; dado alheio → `404`. (ADRs 0013 e 0006)
6. Divisão: soma das partes = total, maior resto com desempate por id, parte nunca zero. (ADR 0007)
7. Relatórios, dashboard e orçamentos leem só a view `reportable_transaction`. (ADR 0008)
8. Escrita: a rota abre a transação e passa `tx`; criação de dinheiro aceita `Idempotency-Key`; job só via outbox. (ADR 0009)
9. Nada financeiro é apagado de verdade: soft delete + `audit_log`, garantidos por trigger. Única exceção: expurgo LGPD. (ADRs 0010 e 0012)
10. Entrada validada por Zod na borda, resposta com schema; erros `{ error: { code, message, details? } }`. (ADR 0013)

Antes de mexer numa área, leia o ADR dela. ADR **Proposto** não é regra.

## Convenções

- TypeScript strict, sem `any` (se inevitável, comentar o porquê).
- Camadas: `routes` (HTTP) → `service` (regra de negócio) → `repository` (Prisma).
- Frontend: dados do servidor via TanStack Query; estado local com `useState`; sem Redux.
- Moeda e datas formatadas com `Intl` em `pt-BR`.
- Código e nomes em inglês; textos da interface em português.
- Commits em Conventional Commits (`feat:`, `fix:`, `chore:`...).

## Fluxo com subagentes

Feature nova: `architect` (plano em `docs/plans/`) → `database` → `backend` →
`frontend` → `qa` → `reviewer` (e `security` se envolver auth, dinheiro ou dados
pessoais) → `docs`. Infra, Docker e CI: `devops`.

Hooks em `.claude/hooks/` garantem as áreas: só o `database` altera
`apps/api/prisma/`, só o `architect` escreve em `docs/adr/`, ninguém altera
`.claude/`, e `reviewer`/`security` só leem. Se um hook bloquear, delegue ao
agente responsável. O hook de caminhos vale para Edit/Write, não para shell:
usar `sed -i`, redirecionamento ou `pnpm db:migrate` para mexer na área de outro
agente é contornar o hook, e é proibido. Arquivos `.env` (exceto `.env.example`)
não são lidos, nem por shell.

## Antes de dizer que terminou

- `pnpm lint`, `pnpm typecheck` e os testes afetados passam
- `node scripts/check-docs.mjs` passa (se mexeu em documentação)
- Nenhum `console.log` esquecido, nenhum segredo no código
- Migrations geradas pelo Prisma, nunca editadas depois de aplicadas
- `docs/STATUS.md` atualizado se um item do roadmap terminou ou uma questão foi resolvida
