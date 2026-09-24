# 0005. Soft delete e auditoria

- Status: Aceito (complementado por [0027](0027-soft-delete-no-banco.md))
- Data: 2026-09-23

## Contexto

A regra 6 do CLAUDE.md diz que transações, despesas e acertos nunca são apagados.
Despesas de grupo também pertencem a outras pessoas e não podem sumir quando
alguém sai.

O Prisma não filtra `deletedAt` sozinho: cada query esquecida vaza registro
apagado. Uma Prisma Client Extension resolve as leituras simples, mas **não** cobre
relações carregadas por `include`/`select`, `findFirstOrThrow`/`findUniqueOrThrow`,
escritas (`update`, `delete`...) nem `$queryRaw`. Cada brecha devolve registro
apagado ao usuário ou altera um registro que ele considera excluído; é o caminho
mais provável de vazamento no projeto.

A exclusão de conta (LGPD), única exceção à regra 6, está no ADR 0010.

## Decisão

**Modelos com soft delete:** transações, transferências, planos de parcelamento,
despesas, partes e pagamentos de despesa, e acertos têm `deletedAt timestamptz NULL`.
A lista de modelos da extensão fica numa constante única, atualizada junto com o schema.

**Extensão Prisma** nesses modelos

- Leituras: aplica `deletedAt: null` em `findMany`, `findFirst`,
  `findFirstOrThrow`, `count`, `aggregate` e `groupBy`. `findUnique` não aceita
  filtro extra: usar `findFirst`; `findUniqueOrThrow` é reescrito para `findFirstOrThrow`.
- `update`/`updateMany`: acrescenta `deletedAt: null` ao `where` (editar registro
  apagado → `404`).
- `delete`/`deleteMany`: **lançam erro**. Exclusão é sempre `update` de
  `deletedAt` + `audit_log`, por uma função `softDelete()` do repository.

**Relações:** todo `include`/`select` de relação para modelo com soft delete usa
`where: { deletedAt: null }`, pela constante `notDeleted` exportada de
`common/db`. O reviewer trata `include: { <relação>: true }` desses modelos como
bloqueante.

**SQL cru** sobre essas tabelas sempre inclui `deleted_at IS NULL`; relatórios
agregados preferem views `active_<tabela>` criadas em migration.

**Client sem filtro** (`prismaUnfiltered`) só em `common/db/unfiltered.ts`,
importável apenas por auditoria, exportação LGPD e expurgo. Regra
`no-restricted-imports` do ESLint bloqueia o resto.

**Unicidade** que deve ignorar registros apagados usa índice parcial
(`CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL`), escrito em SQL numa
migration criada com `--create-only`.

**Auditoria**

- Tabela `audit_log`: `id`, `actor_user_id` (nullable), `action`
  (`CREATE`/`UPDATE`/`DELETE`), `entity_type`, `entity_id`, `before jsonb`,
  `after jsonb`, `created_at`.
- Escrita na **mesma `$transaction`** da alteração. Só inserção; a aplicação
  nunca faz update ou delete nela, exceto no expurgo LGPD (ADR 0010).
- `before/after` guardam só campos de domínio da entidade e referências por id
  (`group_member.id`, `user.id`). Nunca e-mail, hash de senha, token, IP ou user
  agent. Uma função `toAuditSnapshot()` por entidade define os campos. O único
  dado pessoal permitido é `group_member.display_name`.

**Teste de regressão** por módulo: criar, apagar e verificar que o registro não
aparece em nenhuma rota de listagem/detalhe, inclusive aninhado.

## Consequências

- A regra fica mecânica (lint + teste), não depende de lembrar.
- `delete` do Prisma deixa de existir para esses modelos; o expurgo LGPD usa o
  client sem filtro.
- Os outros membros do grupo continuam com histórico e saldos corretos.

## Alternativas consideradas

- **Filtro manual `deletedAt: null` em cada query:** fácil de esquecer.
- **`ON DELETE CASCADE`:** um delete acidental apagaria histórico financeiro.
- **Row Level Security do Postgres filtrando `deleted_at`:** cobre tudo, inclusive
  SQL cru, mas complica o expurgo e as migrations; bom candidato se as regras acima
  falharem na prática.
- **Views para todas as leituras:** Prisma trata views como somente leitura; exige
  modelo duplicado.
- **Mover registros apagados para tabelas de histórico:** quebra FKs e o `audit_log`.
- **Não guardar snapshots na auditoria, só ids:** perde a utilidade para investigar
  alterações de valores.
