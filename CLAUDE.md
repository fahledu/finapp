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

## Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Versões fixadas no ADR 0011.** Instale sempre com o major explícito
  (`pnpm add prisma@7`); nunca pré-release nem `latest` às cegas.
- **Runtime:** Node 24 LTS (`.nvmrc`), pnpm 12 via corepack
- **Backend (`apps/api`):** TypeScript 6 (strict), Fastify 5, Zod 4, Prisma 7
  (`@prisma/adapter-pg`), PostgreSQL 18
- **Frontend (`apps/web`):** React 19, Vite 8, TanStack Query 5, React Router 8 (SPA),
  React Hook Form 7 + Zod 4, Tailwind CSS 4 + shadcn/ui, Recharts 3
- **Compartilhado (`packages/shared`):** schemas Zod, tipos e utilitários de dinheiro
  usados por API e web (fonte única de verdade dos contratos)
- **Auth:** sessão guardada no Postgres, token em cookie httpOnly, senha com argon2id via `@node-rs/argon2` (ADR 0007)
- **Jobs:** BullMQ 6 + Redis 8 (atualização de cotações, recorrências)
- **Testes:** Vitest 5, Supertest, Testcontainers (Postgres real), Playwright (e2e),
  fast-check (testes de propriedade para `money.ts` e divisão)
- **Lint:** ESLint 10 + typescript-eslint (flat config)
- **E-mail:** `nodemailer` via SMTP; Mailpit em dev (ADR 0014)
- **Infra local:** Docker Compose (`postgres:18-alpine` + `redis:8-alpine` + Mailpit)
- **Deploy:** uma imagem, processos `web` (API sob `/api` + build do front) e
  `worker` (BullMQ), mesma origem (ADR 0013)

## Estrutura

```
apps/
  api/
    src/
      modules/<modulo>/   # routes.ts, service.ts, repository.ts, schemas.ts, *.test.ts
      common/             # errors, auth, plugins do Fastify
      jobs/
    prisma/schema.prisma
  web/
    src/
      features/<feature>/ # api.ts (fetch + hooks TanStack Query), components/, pages/, hooks/ (só hooks sem dados do servidor)
      components/ui/      # shadcn/ui
      lib/
packages/
  shared/src/             # schemas/, money.ts, types.ts
docs/
  adr/                    # decisões de arquitetura
  plans/                  # planos de feature gerados pelo agente architect
```

Módulos de domínio: `auth`, `accounts`, `transactions`, `categories`, `budgets`,
`investments`, `groups`, `expenses` (divisão), `settlements` (acertos).

## Comandos

```bash
docker compose up -d            # sobe Postgres e Redis
pnpm install
pnpm dev                        # api + web em modo dev
pnpm test                       # todos os testes
pnpm -F api test                # só backend
pnpm -F web test                # só frontend
pnpm e2e                        # Playwright
pnpm lint && pnpm typecheck     # rodar antes de considerar algo pronto
pnpm -F api db:migrate --name <descricao>   # prisma migrate dev
pnpm -F api db:migrate --create-only --name <descricao>   # gera sem aplicar (para adicionar SQL)
pnpm -F api db:generate         # prisma generate
pnpm -F api db:seed
```

Um teste só (Vitest): `pnpm -F api test -- src/modules/expenses/service.test.ts`
ou por nome: `pnpm -F api test -- -t "maior resto"`.

## Regras de domínio (NÃO NEGOCIÁVEIS)

Detalhes e justificativas em `docs/adr/`. Leia o ADR citado antes de mexer na área.
ADRs com status **Proposto** ainda não são regra: o architect os considera no
plano e pede decisão antes de implementar.

1. **Dinheiro nunca é float.** Valores são inteiros em centavos, sempre positivos,
   acompanhados do código de moeda ISO 4217 (`BRL`, `USD`): `BIGINT` no banco,
   `number` inteiro seguro no código e no JSON (`{ amountCents, currency }`).
   Conversão `bigint` ↔ `number` só no repository. Direção (entrada/saída) vem de
   um campo `type`, não do sinal. Porcentagens em pontos-base (`10000` = 100%).
   Teto por operação: `MAX_AMOUNT_CENTS` (R$ 100 milhões), validado na borda.
   Use os helpers de `packages/shared/src/money.ts`. (ADRs 0001 e 0024)
2. **Quantidades e preços unitários de investimento** usam `NUMERIC(20,8)` e
   `Prisma.Decimal`, nunca `number`; no JSON trafegam como string (`"12.5"`,
   até 12 dígitos inteiros e 8 decimais, ADR 0024).
   É a única exceção à regra dos centavos; o valor derivado vira centavos uma vez,
   no fim, com `ROUND_HALF_UP`. (ADR 0001)
3. **Divisão de gastos:** a soma das partes deve ser exatamente igual ao total.
   Centavos que sobram vão pelo maior resto; empate decidido pelo id do membro do
   grupo em ordem crescente, então o resultado não depende da ordem de entrada.
   Nenhuma parte pode ser zero: rejeite com `422 SPLIT_SHARE_ZERO`.
   Pagamentos ficam em `expense_payment` (soma = total). Existe teste para isso;
   não quebre. (ADR 0004)
4. **Datas:** instantes em `timestamptz` (UTC), ISO 8601 no JSON. Data de
   competência é `DATE` e trafega como string `"YYYY-MM-DD"`, nunca como `Date`
   fora do repository. "Hoje" é calculado em `America/Sao_Paulo`. (ADR 0002)
5. **Toda query filtra pelo dono.** Nenhum usuário pode ler ou alterar dados de
   outro. Em grupos, verificar se o usuário é membro **ativo**. (ADR 0008)
6. **Nada é apagado de verdade** em transações, transferências, parcelamentos,
   despesas (com partes e pagamentos) e acertos: usar soft delete (`deletedAt`,
   extensão Prisma + `notDeleted` em relações) e registrar em `audit_log` na mesma
   transação. (ADR 0005) Única exceção: o expurgo de exclusão de conta (LGPD),
   que segue o ADR 0010.
7. Operações que criam dinheiro (transação, transferência, parcelamento, despesa,
   acerto) aceitam header `Idempotency-Key` para evitar duplicidade. (ADR 0006)
8. **Moedas aceitas: `BRL`, `USD`, `EUR`** (`SUPPORTED_CURRENCIES` em
   `packages/shared`), todas com 2 casas decimais; nunca aceite código ISO
   arbitrário. **Uma moeda por operação.** Conta, grupo e ativo têm moeda própria; enviar
   outra retorna `422 CURRENCY_MISMATCH`. Totais de moedas diferentes nunca são
   somados. Sem câmbio na V1. (ADR 0003)

## Convenções

- TypeScript strict, sem `any`. Se for inevitável, comentar o porquê.
- Validação na borda: toda entrada da API passa por schema Zod de `packages/shared`.
- Camadas no backend: `routes` (HTTP) → `service` (regra de negócio) → `repository` (Prisma).
  Regra de negócio nunca fica na rota. A rota abre a transação (`withIdempotency`
  ou `runInTransaction`) e passa `tx` explicitamente a service e repository (ADR 0025).
- Erros no formato `{ error: { code, message, details? } }` (ver `apps/api/src/common/errors.ts`).
  Status: entrada inválida (Zod) → `422 VALIDATION_ERROR`; JSON malformado → `400`;
  sem sessão → `401`; recurso inexistente **ou de outro usuário** → `404`; sem
  permissão num recurso visível (ex.: membro não-OWNER) → `403`; conflito de
  estado → `409`; convite inválido → `410`; rate limit → `429`. O handler global converte os erros do Fastify para esse formato.
- Frontend: dados do servidor via TanStack Query; estado local com `useState`. Sem Redux.
- Formatação de moeda e datas sempre com `Intl` em `pt-BR`.
- Commits no padrão Conventional Commits (`feat:`, `fix:`, `chore:`...).
- Código e nomes em inglês; textos da interface em português.

## Fluxo de trabalho com subagentes

Para features novas, seguir esta ordem:

1. `architect` cria o plano em `docs/plans/<feature>.md`
2. `database` faz schema e migrations (se houver)
3. `backend` implementa a API
4. `frontend` implementa a interface
5. `qa` escreve e roda testes
6. `reviewer` revisa o diff; `security` revisa se envolver auth, dinheiro ou dados pessoais
7. `docs` atualiza documentação quando a feature estiver pronta

Infra, Docker e CI ficam com `devops`.

As áreas de cada agente são garantidas por hooks em `.claude/hooks/` (declarados
no frontmatter dos agentes): só o `database` altera `apps/api/prisma/`, o
`architect` só escreve em `docs/`, e `reviewer`/`security` só rodam comandos de
leitura. Se um hook bloquear, não contorne: delegue ao agente responsável.

## Antes de dizer que terminou

- `pnpm lint`, `pnpm typecheck` e os testes afetados passam
- Nenhum `console.log` esquecido, nenhum segredo no código
- Migrations novas foram geradas pelo Prisma, não editadas à mão depois de aplicadas
- `docs/STATUS.md` atualizado se um item do roadmap terminou ou uma questão foi resolvida
