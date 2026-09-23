# 0012. Soft delete em relações, escritas e SQL cru

- Status: Proposto
- Data: 2026-09-23
- Complementa: [0005](0005-soft-delete-auditoria-lgpd.md)

## Contexto

O ADR 0005 confia numa Prisma Client Extension que injeta `deletedAt: null` em
`findMany`, `findFirst`, `count`, `aggregate` e `groupBy`. Ela **não** cobre:

- relações carregadas por `include`/`select` (`expense.findMany({ include: { shares: true } })`
  traz partes apagadas);
- `findFirstOrThrow`, `findUniqueOrThrow`, `update`, `updateMany`, `delete`, `deleteMany`;
- `$queryRaw` e views.

Cada brecha devolve registro apagado ao usuário ou altera um registro que ele
considera excluído. É o caminho mais provável de vazamento no projeto.

## Decisão (recomendada)

1. **Extensão ampliada** nos modelos com `deletedAt`:
   - leituras: também `findFirstOrThrow` e `findUniqueOrThrow` (este último
     reescrito para `findFirstOrThrow`);
   - `update`/`updateMany`: acrescenta `deletedAt: null` ao `where` (editar
     registro apagado → `404`);
   - `delete`/`deleteMany`: **lançam erro**. Exclusão é sempre `update` de
     `deletedAt` + `audit_log`, por uma função `softDelete()` do repository.
2. **Relações:** todo `include`/`select` de relação para modelo com soft delete
   usa `where: { deletedAt: null }`. Constante `notDeleted` exportada de
   `common/db` para padronizar. O reviewer trata `include: { <relação>: true }`
   desses modelos como bloqueante.
3. **SQL cru** sobre essas tabelas sempre inclui `deleted_at IS NULL`; relatórios
   agregados preferem views `active_<tabela>` criadas em migration.
4. **Client sem filtro** (`prismaUnfiltered`) só em `common/db/unfiltered.ts`,
   importável apenas por auditoria, exportação LGPD e expurgo. Regra
   `no-restricted-imports` do ESLint bloqueia o resto.
5. **Teste de regressão** por módulo: criar, apagar e verificar que o registro não
   aparece em nenhuma rota de listagem/detalhe, inclusive aninhado.

## Consequências

- A regra fica mecânica (lint + teste), não depende de lembrar.
- `delete` do Prisma deixa de existir para esses modelos; o expurgo LGPD usa o
  client sem filtro.

## Alternativas consideradas

- **Row Level Security do Postgres filtrando `deleted_at`:** cobre tudo, inclusive
  SQL cru, mas complica o expurgo e as migrations; bom candidato se as regras acima
  falharem na prática.
- **Views para todas as leituras:** Prisma trata views como somente leitura; exige
  modelo duplicado.
- **Mover registros apagados para tabelas de histórico:** quebra FKs e o `audit_log`.
