# 0010. Soft delete, auditoria e garantias no banco

- Status: Aceito
- Data: 2026-09-24

## Contexto

A regra 6 do CLAUDE.md diz que transações, despesas e acertos nunca são apagados.
Despesas de grupo também pertencem a outras pessoas e não podem sumir quando
alguém sai.

O Prisma não filtra `deletedAt` sozinho: cada query esquecida vaza registro
apagado. Uma Prisma Client Extension resolve as leituras simples, mas **não**
cobre relações carregadas por `include`/`select`, `findFirstOrThrow`/
`findUniqueOrThrow`, escritas nem `$queryRaw`. Ela também só intercepta a
operação de topo: em `expense.update({ data: { shares: { deleteMany: {} } } })`,
o `deleteMany` aninhado passa direto e apaga as partes de verdade; o mesmo vale
para `update`/`updateMany` aninhados, `set`, `disconnect` e `upsert` no topo.
Cada brecha devolve registro apagado ao usuário ou altera um registro que ele
considera excluído; é o caminho mais provável de vazamento no projeto.

A trilha de auditoria precisa ser só inserção, e isso não pode depender só de
disciplina: nada impediria um `update`, `delete` ou SQL cru de reescrevê-la.

A exclusão de conta (LGPD), única exceção à regra 6, está no ADR
[0012](0012-lgpd-exclusao-e-retencao.md).

## Decisão

As garantias vêm em camadas, da mais cedo (código, lint) à mais garantida (banco).

### Modelos com soft delete

Transação, transferência, plano de parcelamento, despesa, parte de despesa,
pagamento de despesa e acerto têm `deletedAt timestamptz NULL`. A lista fica
numa constante única em `common/db`, atualizada junto com o schema.

### Extensão Prisma

Nesses modelos:

- Leituras: aplica `deletedAt: null` em `findMany`, `findFirst`,
  `findFirstOrThrow`, `count`, `aggregate` e `groupBy`. `findUnique` não aceita
  filtro extra: usar `findFirst`; `findUniqueOrThrow` é reescrito para
  `findFirstOrThrow`.
- `update`/`updateMany`: acrescenta `deletedAt: null` ao `where` (editar registro
  apagado → `404`).
- `delete`, `deleteMany` e `upsert`: **lançam erro**. Exclusão é sempre `update`
  de `deletedAt` + `audit_log`, por uma função `softDelete()` do repository.

### Relações e escrita aninhada

- Todo `include`/`select` de relação para esses modelos usa
  `where: { deletedAt: null }`, pela constante `notDeleted` exportada de
  `common/db`.
- Escrita aninhada nesses modelos só com `create`/`createMany`. Editar, apagar,
  `upsert`, `set` e `disconnect` só na operação de topo, pelo repository do
  próprio modelo. Ex.: editar despesa chama
  `shareRepository.softDeleteByExpense(tx, expenseId)` e cria as partes novas.
- O reviewer trata como bloqueante `include: { <relação>: true }` desses modelos
  e operação aninhada diferente de `create`/`createMany`. Regra ESLint
  `no-restricted-syntax` para o mesmo fim, quando for viável expressar o padrão.

### SQL cru, client sem filtro e unicidade

- SQL cru sobre essas tabelas sempre inclui `deleted_at IS NULL`; relatórios
  agregados preferem views `active_<tabela>` criadas em migration.
- O client sem filtro (`prismaUnfiltered`) só existe em
  `common/db/unfiltered.ts`, importável apenas por auditoria, exportação LGPD e
  expurgo. Regra `no-restricted-imports` do ESLint bloqueia o resto.
- Unicidade que deve ignorar registros apagados usa índice parcial
  (`CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL`), em SQL numa migration
  criada com `--create-only`.

### Auditoria

- Tabela `audit_log`: `id`, `actor_user_id` (nullable), `action`
  (`CREATE`/`UPDATE`/`DELETE`), `entity_type`, `entity_id`, `before jsonb`,
  `after jsonb`, `created_at`.
- Escrita por `audit.record(tx, ...)` na **mesma transação** da alteração (ADR
  [0009](0009-escrita-transacao-idempotencia-e-outbox.md)). Só inserção.
- `before/after` guardam só campos de domínio da entidade e referências por id
  (`group_member.id`, `user.id`). Nunca e-mail, hash de senha, token, IP ou user
  agent. Uma função `toAuditSnapshot()` por entidade define os campos. O único
  dado pessoal permitido é `group_member.display_name`.

### Garantias no banco

Criadas numa migration `--create-only` (SQL que o Prisma não gera), pelo agente
`database`.

- **Sem `DELETE` físico:** uma função PL/pgSQL compartilhada (ex.:
  `prevent_hard_delete()`) e um trigger `BEFORE DELETE ... FOR EACH ROW` por
  tabela com soft delete, que lança exceção, exceto quando a transação fez
  `SET LOCAL app.allow_purge = 'on'`. Cobre escrita aninhada, SQL cru e qualquer
  outra brecha.
- **`audit_log` só inserção:** trigger `BEFORE UPDATE OR DELETE ... FOR EACH ROW`
  com função própria (ex.: `prevent_audit_change()`), com a mesma exceção.
- As funções leem a flag com `current_setting('app.allow_purge', true)` (sem erro
  quando a variável não existe).
- Sempre `SET LOCAL`, nunca `SET`: a flag vale só até o fim da transação e não
  vaza para outras requisições que reusam a conexão do pool.
- Toda tabela nova com `deleted_at` ganha o trigger na mesma migration. A
  constante de modelos da extensão e a lista de tabelas com trigger andam juntas.

**Quem liga a flag.** `SET LOCAL app.allow_purge` só pode aparecer no módulo do
expurgo LGPD (ADR 0012), que o executa com `tx.$executeRaw` na mesma transação
interativa (portanto na mesma conexão) e com o client sem filtro. É o único
caminho que apaga linhas dessas tabelas e que altera `audit_log` (apaga linhas de
entidades só da pessoa e reescreve `display_name` nos snapshots de
`group_member`, conforme o ADR 0012). Regra ESLint `no-restricted-syntax` sobre
literais e template strings contendo `allow_purge` fora desse módulo; o reviewer
trata qualquer ocorrência fora dele como bloqueante. Testes que precisam do
caminho com a flag chamam a função exportada pelo módulo do expurgo, sem repetir
o literal.

**Limpeza de dados em testes e no seed:** `TRUNCATE` ou `prisma migrate reset`,
nunca `DELETE` (os triggers recusam; `TRUNCATE` não dispara trigger de `DELETE`
por linha). `TRUNCATE` nunca aparece em código da aplicação (rotas, services,
repositories, jobs).

### Testes obrigatórios

- Regressão por módulo: criar, apagar e verificar que o registro não aparece em
  nenhuma rota de listagem/detalhe, inclusive aninhado.
- `upsert`, `delete` e `deleteMany` num modelo com soft delete lançam.
- `DELETE` físico sem a flag falha; pelo caminho do expurgo, funciona.
- `UPDATE` e `DELETE` em `audit_log` sem a flag falham; pelo caminho do expurgo,
  funcionam.
- A lista de modelos da extensão bate com as tabelas que têm o trigger
  (consulta a `pg_trigger`).

## Consequências

- "Nada é apagado de verdade" (regra 6) e "auditoria só inserção" viram garantia
  do banco, não só do código; o lint e o reviewer avisam antes.
- É exceção consciente ao "regra de negócio no service": a regra é não negociável
  e barata de garantir no banco.
- `delete` do Prisma deixa de existir para esses modelos; o expurgo LGPD usa o
  client sem filtro com a flag ligada.
- Os outros membros do grupo continuam com histórico e saldos corretos.
- Um `ON DELETE CASCADE` que atinja essas tabelas também dispara o trigger; como
  as FKs de dados financeiros são `Restrict` (ADR 0012), isso só reforça a regra.
- O erro do trigger chega à aplicação como erro do Postgres (500): é bug de
  código, não caso de uso, e não precisa de código de API próprio.
- Seed e fixtures não podem "limpar" tabelas com `DELETE`; quem escreve testes
  usa `TRUNCATE` (ou reset) entre casos.

## Alternativas consideradas

- **Filtro manual `deletedAt: null` em cada query:** fácil de esquecer.
- **Tratar escrita aninhada na extensão:** percorre a árvore de argumentos de todo
  modelo em toda operação; frágil e incompleto a cada versão do Prisma.
- **Só regra de código + revisão:** depende de lembrar; não cobre SQL cru.
- **`ON DELETE CASCADE`:** um delete acidental apagaria histórico financeiro.
- **Row Level Security do Postgres filtrando `deleted_at`:** cobre tudo, inclusive
  SQL cru, mas complica o expurgo e as migrations; candidato se as regras acima
  falharem na prática.
- **Revogar `DELETE` do usuário de banco da aplicação e usar outro usuário no
  expurgo:** garantia equivalente, mas exige dois usuários de banco e duas
  conexões configuradas.
- **Views para todas as leituras:** Prisma trata views como somente leitura; exige
  modelo duplicado.
- **Mover registros apagados para tabelas de histórico:** quebra FKs e o
  `audit_log`.
- **Não guardar snapshots na auditoria, só ids:** perde a utilidade para
  investigar alterações de valores.
- **Liberar `allow_purge` para testes e seed:** espalha o literal pelo código e
  enfraquece a revisão; `TRUNCATE` já resolve a limpeza.
