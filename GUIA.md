# Guia de estudo: FinApp com Claude Code e subagentes

## 1. O que tem neste pacote

```
<raiz do repositório>/
  CLAUDE.md                 # contexto do projeto, lido automaticamente em toda sessão
  GUIA.md                   # este arquivo
  docs/adr/                 # decisões de arquitetura (dinheiro, datas, moedas, divisão...)
  .claude/agents/
    architect.md            # planeja features (só escreve em docs/)
    database.md             # schema Prisma e migrations
    backend.md              # API Fastify
    frontend.md             # React
    qa.md                   # testes
    reviewer.md             # revisão de código (só leitura)
    security.md             # segurança e LGPD (só leitura)
    devops.md               # Docker, CI/CD, deploy
    docs.md                 # documentação
  .claude/hooks/
    guard-paths.mjs         # impede agentes de editar fora da sua área
    readonly-bash.mjs       # só deixa reviewer e security rodarem comandos de leitura
```

A pasta `.claude` começa com ponto e pode ficar oculta no explorador de arquivos.
Os hooks precisam do Node instalado; sem ele, as restrições não são aplicadas.

## 2. Conceitos rápidos

**CLAUDE.md** é a "memória" do projeto. O Claude Code lê esse arquivo no início de
cada sessão, então tudo que você não quer repetir (stack, comandos, regras) vai
nele. Mantenha-o enxuto e atualizado; regra desatualizada atrapalha mais do que ajuda.

**Subagentes** são assistentes especializados. Cada arquivo em `.claude/agents/` tem:

- `name`: como você chama o agente
- `description`: quando usá-lo. O Claude principal lê isso para decidir delegar
  sozinho, então seja específico
- `tools`: o que ele pode fazer. Se omitir, herda todas. Restringir é bom:
  `reviewer` e `security` não editam nada de propósito
- `hooks`: scripts que rodam antes de cada ferramenta e podem bloqueá-la. Uma
  regra escrita só no prompt é um pedido; um hook é uma garantia. Aqui eles
  impedem, por exemplo, que o `backend` edite `apps/api/prisma/` (área do
  `database`), que um agente edite `.claude/` (e desligue os próprios hooks) e
  que o `reviewer` rode comandos que alteram arquivos. Limite: o hook de caminhos
  vale para Edit/Write, não para comandos de shell
- `model`: `opus` (raciocínio pesado: planejar, revisar), `sonnet` (implementar),
  `haiku` (tarefas simples e rápidas), ou `inherit`
- O corpo do arquivo é o prompt de sistema do agente

Cada subagente roda com contexto próprio e separado, então ele não "polui" a
conversa principal com todos os arquivos que leu; devolve só o resultado.

**Comandos úteis dentro do Claude Code:**

- `/init`: gera um CLAUDE.md analisando o repo (você já tem um, mas vale conhecer)
- `/agents`: lista, cria e edita subagentes pela interface
- `/memory`: abre o CLAUDE.md para editar
- `/clear`: limpa a conversa (use ao trocar de tarefa)
- `Shift+Tab`: alterna modos, incluindo o **plan mode**, em que ele planeja sem editar
- `#` no início da mensagem: adiciona uma regra direto na memória

## 3. Sugestões e decisões de stack

Sua escolha (Node + TypeScript + React + PostgreSQL) é ótima. O que acrescentei e por quê:

| Área | Escolha | Motivo |
|---|---|---|
| Monorepo | pnpm workspaces + Turborepo | API e web compartilham tipos e schemas |
| Framework API | Fastify | Rápido, tipagem boa, mais simples que NestJS para estudar. Se quiser algo mais estruturado (estilo Spring/Angular), troque por NestJS e ajuste backend.md |
| ORM | Prisma | Mais amigável para aprender; migrations automáticas. Alternativa: Drizzle |
| Validação | Zod em `packages/shared` | Um schema valida no backend, no formulário e gera os tipos |
| Dados no front | TanStack Query | Cache, loading e refetch sem reinventar |
| UI | Tailwind + shadcn/ui + Recharts | Componentes prontos e gráficos para investimentos |
| Auth | Sessão em cookie + argon2 | Mais seguro e simples que JWT no localStorage. Alternativa pronta: Better Auth |
| Jobs | BullMQ + Redis | Atualizar cotações e gerar transações recorrentes fora da requisição |
| Testes | Vitest, Testcontainers, Playwright, fast-check | Unitário, integração com banco real, e2e, e testes de propriedade para a divisão |
| Infra | Docker Compose + GitHub Actions | Ambiente reproduzível e CI desde o começo |

**Pontos do domínio que merecem atenção (e já estão no CLAUDE.md):**

- **Nunca use float para dinheiro.** `0.1 + 0.2 = 0.30000000000000004`. Guarde
  centavos como inteiro.
- **Divisão de R$ 100 entre 3:** 33,33 + 33,33 + 33,33 = 99,99. O centavo que falta
  precisa ir para alguém de forma previsível (maior resto).
- **Simplificação de dívidas:** se A deve 10 a B e B deve 10 a C, basta A pagar 10 a C.
  É o recurso mais "mágico" do Splitwise e um ótimo exercício de algoritmo.
- **Múltiplas moedas:** decidido no ADR 0003. BRL, USD e EUR, uma moeda por
  operação e sem câmbio na V1; totais de moedas diferentes nunca são somados.
- **Cotações:** para ativos da B3 existem APIs públicas como a brapi; para cripto,
  CoinGecko. Verifique limites e termos de uso de cada uma.
- **LGPD:** dados financeiros são sensíveis. Planeje exportação e exclusão de conta.
- **Importação de extrato** (CSV/OFX dos bancos) é uma feature que agrega muito.

## 4. Roadmap sugerido (em ordem)

1. Setup do monorepo, Docker, CI, auth (cadastro/login)
2. Contas e categorias
3. Transações (CRUD, filtros por mês e categoria)
4. Dashboard com saldo e gastos por categoria
5. Grupos e membros
6. Despesas divididas (modo igual primeiro, depois os outros)
7. Saldos entre membros, acertos e simplificação de dívidas
8. Orçamentos mensais por categoria
9. Investimentos: ativos, operações de compra/venda, preço médio, posição
10. Cotações automáticas e rentabilidade
11. Recorrências e importação de extrato

Faça um item por vez, com commit ao final de cada um.

## 5. Prompts prontos para usar no Claude Code

### Primeira sessão: criar o projeto

Pré-requisitos: Node 20+ (LTS), pnpm (`corepack enable`) e Docker Desktop.

```
Leia o CLAUDE.md e os ADRs em docs/adr/. Vamos criar o esqueleto do projeto do zero.

Use o agente devops para: estrutura do monorepo com pnpm workspaces e Turborepo,
docker-compose com Postgres 16 e Redis, .env.example e workflow de CI básico
(testes de integração com Testcontainers, matriz de fuso UTC e America/Sao_Paulo).
Os scripts devem ter os nomes da seção "Comandos" do CLAUDE.md.

Depois crie packages/shared com:
- money.ts: SUPPORTED_CURRENCIES, currencySchema e moneySchema (ADRs 0001 e 0003),
  parse de "1.234,56" para centavos, formatação, soma que recusa moedas diferentes
- split.ts: divisão pelo maior resto com desempate por id (ADR 0004)
- dates.ts: localDateSchema e todayInSaoPaulo() (ADR 0002)
- testes com fast-check, incluindo a invariância à ordem dos participantes

Depois use o agente database para criar o schema Prisma inicial com as tabelas
de infraestrutura: user, session (ADR 0007), audit_log (ADR 0005) e
idempotency_key (ADR 0006), a primeira migration e um seed mínimo.

Depois use o agente backend para criar apps/api com Fastify, TypeScript strict,
validação de variáveis de ambiente com Zod, formato de erro padrão
(common/errors.ts), rota GET /health e um teste para ela.

Depois use o agente frontend para criar apps/web com Vite (com proxy de /api
para a API, ADR 0007), React, Tailwind, shadcn/ui, TanStack Query e React Router,
com uma página inicial simples que chama /health.

Ao final, confirme que `pnpm dev`, `pnpm test`, `pnpm lint` e `pnpm typecheck`
funcionam, remova a nota de status do topo do CLAUDE.md e me explique a
estrutura criada como se eu estivesse aprendendo.
```

Cadastro e login ficam para a sessão seguinte, pelo fluxo padrão de feature
(architect → database → backend → frontend → qa → reviewer → security).

### Fluxo padrão de uma feature

```
Quero implementar: despesas divididas em grupos (modo divisão igual).

1. Use o agente architect para criar o plano. Pare e me mostre o plano antes de
   continuar.
```

Depois de ler e aprovar (ou ajustar) o plano:

```
Plano aprovado. Siga as tarefas do plano usando os agentes database, backend e
frontend, nessa ordem. Depois use o qa para testar e o reviewer para revisar.
Corrija os itens bloqueantes do reviewer e me mostre um resumo final.
```

### Chamar um agente específico

```
Use o agente security para auditar o módulo de auth.
```

```
Use o agente reviewer para revisar as mudanças desde o último commit.
```

```
Use o agente docs para explicar, em docs/divisao-de-gastos.md, como o algoritmo
de divisão e de simplificação de dívidas funciona, com exemplos numéricos.
```

### Para aprender (muito útil enquanto estuda)

```
Antes de implementar, me explique as opções e por que você escolheria uma delas.
```

```
Explique o que esse arquivo faz linha a linha: apps/api/src/modules/expenses/service.ts
```

## 6. Dicas de quem está começando

- **Aprove o plano antes do código.** Use o architect ou o plan mode (`Shift+Tab`).
  Corrigir um plano é barato; corrigir código espalhado é caro.
- **Tarefas pequenas.** "Implemente o sistema de investimentos" é grande demais.
  "Implemente o cadastro de ativos" é bom.
- **Commits frequentes.** Se algo der errado, você volta com `git`.
- **Leia o que ele fez.** Você está estudando; peça explicações sempre que não
  entender algo. O agente docs e o reviewer ajudam nisso.
- **Evolua os agentes.** Quando o Claude errar a mesma coisa duas vezes, adicione
  uma regra no CLAUDE.md ou no agente responsável.
- **`/clear` entre tarefas diferentes** para manter o contexto limpo.
