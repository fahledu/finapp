# 0026. Convenções de API

- Status: Aceito
- Data: 2026-09-24

## Contexto

Transações, despesas e acertos crescem sem limite e precisam de paginação,
filtros e ordenação. Sem convenção, cada módulo inventaria a sua, e o frontend
teria um hook de lista diferente por tela.

A validação na borda (CLAUDE.md) diz que toda entrada passa por schema Zod de
`packages/shared`, mas não diz como o Zod se liga ao Fastify, nem o que acontece
com a **saída**. Um `select` esquecido no repository pode devolver
`passwordHash`, `tokenHash` ou `deletedAt` ao cliente, e nada impede.

## Decisão

**Paginação por cursor (keyset)** nas listas que crescem: transações, despesas,
acertos e futuras listas do mesmo tipo.

- Querystring: `cursor` (opcional) e `limit` (padrão 50, máximo 100; fora de
  `1..100` → `422 VALIDATION_ERROR`).
- Resposta: `{ items, nextCursor }`; `nextCursor: null` na última página. Sem
  total de itens.
- Cursor opaco em base64url que codifica a chave de ordenação do último item, ex.:
  `(date, id)`; o `id` desempata itens do mesmo dia. O servidor decodifica e valida
  com schema Zod; cursor inválido ou adulterado → `422 VALIDATION_ERROR`.
- A query busca `limit + 1` linhas para saber se há próxima página.
- Frontend: `useInfiniteQuery` do TanStack Query, com
  `getNextPageParam: (last) => last.nextCursor ?? undefined`.

**Listas pequenas** (contas, categorias, grupos, membros): sem paginação;
devolvem `{ items }`, com limite de segurança fixo no servidor (constante por
recurso).

**Filtros** na querystring, validados por schema Zod de `packages/shared`:

- Período: `from` e `to` em `"YYYY-MM-DD"`, com `to` **exclusivo** (ADR 0002), ou
  o atalho `month=YYYY-MM`, que o servidor expande para `[primeiro dia do mês,
  primeiro dia do mês seguinte)`. `month` junto com `from`/`to` → `422`.
- Filtros do recurso: `accountId`, `categoryId`, `type` conforme o caso.
- Números na querystring usam `z.coerce` (tudo chega como string).

**Ordenação fixa por recurso** na V1 (ex.: data decrescente, depois id
decrescente). Sem parâmetro `sort`. O índice composto que sustenta a ordem e o
filtro de dono (ex.: `(user_id, date, id)`; em despesas de grupo,
`(group_id, date, id)`) é criado na mesma migration da lista.

**Zod ↔ Fastify via `fastify-type-provider-zod`**

- Cada rota declara `schema: { body, querystring, params, response }` com schemas
  de `packages/shared`. O Fastify valida e tipa o handler; a rota **não** chama
  `.parse()` à mão.
- **Schema de resposta obrigatório em toda rota**, para cada status de sucesso. O
  serializer descarta campos fora do schema: defesa contra vazar `passwordHash`,
  `tokenHash`, `deletedAt` etc. por `select` esquecido. Os schemas de resposta
  não usam `.passthrough()`/`z.looseObject()`.
- O error handler global converte o erro de validação em `422 VALIDATION_ERROR`
  (CLAUDE.md).
- OpenAPI gerado por `@fastify/swagger` a partir desses schemas, servido em
  **`/api/docs`** (dentro do prefixo `/api` do ADR 0013, sem colidir com o
  fallback da SPA; o agente `docs` conta com isso).
- A rota de documentação só é registrada quando `API_DOCS_ENABLED=true`.
  Desligada por padrão em produção, para não expor o mapa da API publicamente;
  ligada no `.env` de desenvolvimento. A geração do spec (ex.: exportar o JSON
  no build ou num script) não depende da flag.
- Compatibilidade com Zod 4 conferida na instalação, com versão fixada (ADR 0011).
  Se não houver versão compatível, a alternativa é o `z.toJSONSchema()` nativo do
  Zod 4 alimentando os schemas do Fastify, com o mesmo contrato acima.

**Formato**

- Recurso único sem envelope; listas `{ items, nextCursor }` (ou `{ items }` nas
  pequenas).
- JSON em camelCase.
- Caminhos em inglês, no plural, aninhados quando o recurso pertence a outro
  (`/api/groups/:groupId/expenses`). Tudo sob `/api` (ADR 0013).

## Consequências

- Uma forma só de listar: um helper de cursor (codificar/decodificar) em
  `packages/shared` ou `common/`, e um hook de lista infinita no frontend.
- Inserções durante a rolagem não repetem nem pulam itens, e o custo por página
  não cresce com a profundidade.
- Sem total, a interface não mostra "página 3 de 12" nem "342 transações";
  quando precisar de totais (ex.: soma do mês), é endpoint de resumo próprio.
- Nova ordem de listagem exige ADR ou plano, com índice próprio.
- Resposta que não bate com o schema (ex.: `bigint` onde se espera `number`) vira
  erro 500 na serialização, não dado errado no cliente. Os testes de rota pegam isso.
- **Leitura do exemplo do ADR 0025:** com o type provider, `request.body` já
  chega validado e tipado, e é esse valor que vai como `input` para
  `withIdempotency`. O `createExpenseSchema.parse(request.body)` do exemplo do
  0025 é ilustrativo; não se repete a validação na rota.
- `fastify-type-provider-zod` e `@fastify/swagger` não estão na tabela do ADR
  0011; entram com major explícito e versão travada no lockfile, seguindo as
  regras daquele ADR.

## Alternativas consideradas

- **Offset/page:** itens repetem ou somem quando há inserção durante a rolagem, e
  cada página fica mais lenta que a anterior.
- **Total de itens na resposta:** um `COUNT` por página, caro em listas grandes.
- **`sort` livre:** quebra o cursor (que codifica a chave de ordenação) e exige
  um índice por ordem possível.
- **Validar à mão com `.parse()` sem type provider:** sem schema de resposta, sem
  OpenAPI e com tipos do handler divergindo do schema.
- **Envelope `{ data }` em tudo:** ruído sem ganho; o status HTTP e o formato de
  erro já distinguem sucesso de falha.
