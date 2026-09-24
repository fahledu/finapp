# 0013. Convenções de API

- Status: Aceito
- Data: 2026-09-24

## Contexto

Transações, despesas e acertos crescem sem limite e precisam de paginação,
filtros e ordenação. Sem convenção, cada módulo inventaria a sua, e o frontend
teria um hook de lista diferente por tela.

A validação na borda diz que toda entrada passa por schema Zod de
`packages/shared`, mas é preciso definir como o Zod se liga ao Fastify e o que
acontece com a **saída**: um `select` esquecido no repository pode devolver
`passwordHash`, `tokenHash` ou `deletedAt` ao cliente, e nada impede. O formato
de erro e a escolha de status HTTP também precisam de uma fonte única, para que
todos os módulos respondam igual.

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

- Período: `from` e `to` em `"YYYY-MM-DD"`, com `to` **exclusivo** (ADR
  [0002](0002-datas-e-fusos.md)), ou o atalho `month=YYYY-MM`, que o servidor
  expande para `[primeiro dia do mês, primeiro dia do mês seguinte)`. `month`
  junto com `from`/`to` → `422 VALIDATION_ERROR`.
- Filtros do recurso: `accountId`, `categoryId`, `type` conforme o caso.
- Números na querystring usam `z.coerce` (tudo chega como string).

**Ordenação fixa por recurso** na V1 (ex.: data decrescente, depois id
decrescente). Sem parâmetro `sort`. O índice composto que sustenta a ordem e o
filtro de dono (ex.: `(user_id, date, id)`; em despesas de grupo,
`(group_id, date, id)`) é criado na mesma migration da lista.

**Zod ↔ Fastify via `fastify-type-provider-zod`**

- Cada rota declara `schema: { body, querystring, params, response }` com schemas
  de `packages/shared`. O Fastify valida e tipa o handler; a rota **não** chama
  `.parse()` à mão, e é o valor já validado de `request.body` que segue para o
  service (e para `withIdempotency`, ADR
  [0009](0009-escrita-transacao-idempotencia-e-outbox.md)).
- **Schema de resposta obrigatório em toda rota**, para cada status de sucesso. O
  serializer descarta campos fora do schema: defesa contra vazar `passwordHash`,
  `tokenHash`, `deletedAt` etc. por `select` esquecido. Os schemas de resposta
  não usam `.passthrough()`/`z.looseObject()`.
- OpenAPI gerado por `@fastify/swagger` a partir desses schemas, servido em
  **`/api/docs`** (dentro do prefixo `/api` do ADR
  [0014](0014-deploy-ambientes-e-observabilidade.md), sem colidir com o fallback
  da SPA; o agente `docs` conta com isso).
- A rota de documentação só é registrada quando `API_DOCS_ENABLED=true`.
  Desligada por padrão em produção, para não expor o mapa da API publicamente;
  ligada no `.env` de desenvolvimento. A geração do spec (ex.: exportar o JSON
  no build ou num script) não depende da flag.
- Compatibilidade com Zod 4 conferida na instalação, com versão fixada (ADR
  [0015](0015-versoes-da-stack.md)). Se não houver versão compatível, a
  alternativa é o `z.toJSONSchema()` nativo do Zod 4 alimentando os schemas do
  Fastify, com o mesmo contrato acima.

**Formato de sucesso e caminhos**

- Recurso único sem envelope; listas `{ items, nextCursor }` (ou `{ items }` nas
  pequenas).
- JSON em camelCase.
- Caminhos em inglês, no plural, aninhados quando o recurso pertence a outro
  (`/api/groups/:groupId/expenses`). Tudo sob `/api`, também em desenvolvimento
  (ADR [0014](0014-deploy-ambientes-e-observabilidade.md)).

**Erros**

Formato único, montado por `apps/api/src/common/errors.ts`:

```json
{ "error": { "code": "CURRENCY_MISMATCH", "message": "...", "details": {} } }
```

- `code` é estável, em `UPPER_SNAKE_CASE`, e é o que o frontend e os testes
  comparam; `message` é texto para humanos; `details` é opcional (ex.: os
  problemas de validação do Zod, com caminho do campo).
- O error handler global converte para esse formato os erros do Fastify
  (validação do type provider, JSON malformado, rate limit) e os erros de domínio
  lançados pelos services.
- Erro inesperado → `500 INTERNAL_ERROR`, com mensagem genérica; stack e
  detalhes só no log, nunca na resposta (ADR
  [0014](0014-deploy-ambientes-e-observabilidade.md)).

| Status | Quando | `code` |
|---|---|---|
| `400` | JSON malformado (corpo que não é JSON válido) | |
| `401` | Sem sessão ou sessão inválida/expirada | `UNAUTHENTICATED` |
| `403` | Sem permissão num recurso **visível** (ex.: membro não-`OWNER`) | `FORBIDDEN` |
| `403` | `Origin` diferente de `WEB_ORIGIN` numa mutação (CSRF, ADR [0011](0011-autenticacao-sessoes-email-e-tokens.md)) | `ORIGIN_MISMATCH` |
| `404` | Recurso inexistente **ou de outro usuário** (não revela que existe) | `NOT_FOUND` |
| `409` | Conflito com o estado atual do recurso | código específico da regra, ex.: `MEMBER_HAS_BALANCE`, `ALREADY_MEMBER`, `ACCOUNT_ARCHIVED`, `CURRENCY_LOCKED` |
| `410` | Recurso que existiu e deixou de valer | `INVITE_INVALID` (ADR [0006](0006-grupos-membros-e-convites.md)) |
| `415` | Mutação (`POST`, `PUT`, `PATCH`, `DELETE`) com corpo que não é `application/json` | `UNSUPPORTED_MEDIA_TYPE` |
| `422` | Entrada inválida pelo schema Zod | `VALIDATION_ERROR` |
| `422` | Entrada bem formada que viola regra de domínio | código específico, ex.: `CURRENCY_MISMATCH`, `SPLIT_SHARE_ZERO`, `IDEMPOTENCY_KEY_REUSED` |
| `429` | Limite de requisições ou de falhas estourado, com header `Retry-After` | `RATE_LIMITED` (ADR [0011](0011-autenticacao-sessoes-email-e-tokens.md)) |
| `500` | Erro inesperado | `INTERNAL_ERROR` |

Os códigos específicos de `409` e `422` ficam no ADR da área; esta tabela define
qual status cada tipo de erro usa e os códigos genéricos.

**Autorização**

- **Toda query filtra pelo dono:** `user_id` do usuário da sessão nos dados
  pessoais; em grupos, exige que o usuário seja membro `ACTIVE` do grupo (ADR
  [0006](0006-grupos-membros-e-convites.md)). O filtro fica no repository (na
  própria query, não num `if` depois de buscar) ou num guard reutilizável; nunca
  depende de a rota lembrar.
- Recurso inexistente **ou de outro usuário** → `404 NOT_FOUND`, com a mesma
  resposta nos dois casos, para não revelar que o id existe.
- Recurso visível, mas sem permissão para a ação (ex.: membro não-`OWNER` tentando
  ação de `OWNER`) → `403 FORBIDDEN`.
- **Teste de integração obrigatório em cada módulo:** o usuário A não lê, não
  lista, não altera e não apaga dado do usuário B (nem de grupo do qual não é
  membro ativo), e recebe `404`.

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
- O frontend trata erro por `code`, não por `message` nem só por status.
- Testes de rota verificam o formato de erro de cada status usado, inclusive
  `400` com JSON malformado, `415` com corpo que não é JSON e `422` com o
  `details` do Zod.
- O handler global precisa converter o `415` nativo do Fastify para
  `UNSUPPORTED_MEDIA_TYPE` no formato de erro acima.
- `fastify-type-provider-zod` e `@fastify/swagger` entram com major conferido na
  instalação e fixado no lockfile (ADR [0015](0015-versoes-da-stack.md)).

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
- **`400` para entrada inválida:** mistura "não consegui ler o corpo" com "li e
  o conteúdo não vale"; `422` separa os dois casos.
- **`403` para recurso de outro usuário:** confirma que o id existe; `404` não
  revela nada.
