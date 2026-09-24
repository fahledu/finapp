# 0027. Soft delete em escritas aninhadas e garantias no banco

- Status: Aceito
- Data: 2026-09-24
- Complementa: [0005](0005-soft-delete-e-auditoria.md)

## Contexto

A extensão Prisma do ADR 0005 só intercepta a operação de topo. Em
`expense.update({ data: { shares: { deleteMany: {} } } })`, o `deleteMany`
aninhado passa direto e apaga as partes de verdade. O mesmo vale para `update`/
`updateMany` aninhados (podem editar registro apagado), `set` e `disconnect`.
`upsert` no topo também não é coberto e pode editar registro apagado.

Tratar tudo na extensão exigiria percorrer a árvore de argumentos de todo
modelo, em toda operação: frágil e fácil de ficar incompleto a cada versão do
Prisma.

O `audit_log` "só inserção" do ADR 0005 também dependia só de disciplina: nada
impedia um `update`, `delete` ou SQL cru de reescrever a trilha de auditoria.

## Decisão

Três camadas, da mais cedo à mais garantida.

**1. Regra de código.** Nos modelos com soft delete (lista do ADR 0005), escrita
aninhada só com `create`/`createMany`. Editar, apagar, `upsert`, `set` e
`disconnect` só na operação de topo, pelo repository do próprio modelo. Ex.:
editar despesa chama `shareRepository.softDeleteByExpense(tx, expenseId)` e cria
as partes novas.

**2. Extensão.** `upsert` nesses modelos lança erro, como `delete`/`deleteMany`
no ADR 0005.

**3. Banco.** Trigger `BEFORE DELETE ... FOR EACH ROW` em cada tabela com soft
delete, que lança exceção, exceto quando a transação fez
`SET LOCAL app.allow_purge = 'on'`.

- Uma função PL/pgSQL compartilhada (ex.: `prevent_hard_delete()`) e um trigger
  por tabela, criados em migration `--create-only` (SQL que o Prisma não gera).
- A função lê a flag com `current_setting('app.allow_purge', true)` (sem erro
  quando a variável não existe).
- Só o expurgo LGPD (ADR 0010) liga a flag, dentro da sua transação e com o client
  sem filtro (`tx.$executeRaw` na mesma transação interativa, portanto na mesma
  conexão).
- Cobre escrita aninhada, SQL cru e qualquer outra brecha.

**`audit_log` só inserção.** Trigger `BEFORE UPDATE OR DELETE ... FOR EACH ROW`
em `audit_log`, com função própria (ex.: `prevent_audit_change()`), que lança
exceção, exceto com a mesma flag `app.allow_purge` ligada. O expurgo LGPD é o
único caminho que a liga: ele apaga linhas de `audit_log` de entidades só da
pessoa e reescreve `display_name` nos snapshots de `group_member` (ADR 0010).
Criado na mesma migration `--create-only` dos demais triggers.

**Avisos cedo**

- O reviewer bloqueia operação aninhada diferente de `create`/`createMany` nesses
  modelos.
- Regra ESLint `no-restricted-syntax` para o mesmo fim, quando for viável
  expressar o padrão.

**Testes de integração**

- `DELETE` físico sem a flag falha; com a flag (caminho do expurgo) funciona.
- `upsert` num modelo com soft delete lança.
- `UPDATE` e `DELETE` em `audit_log` sem a flag falham; com a flag (caminho do
  expurgo) funcionam.
- O teste de regressão do ADR 0005 continua valendo.

## Consequências

- "Nada é apagado de verdade" (CLAUDE.md, regra 6) vira garantia do banco, não só
  do código. O mesmo vale para "auditoria só inserção" (ADR 0005).
- É exceção consciente ao "regra de negócio no service": a regra é não negociável
  e barata de garantir no banco.
- `TRUNCATE`, usado na limpeza entre testes, não dispara trigger de `DELETE` por
  linha; os testes continuam simples. Pelo mesmo motivo, `TRUNCATE` nunca aparece
  em código da aplicação.
- Toda tabela nova com `deleted_at` precisa do trigger na mesma migration
  (agente `database`). A constante de modelos da extensão (ADR 0005) e a lista de
  tabelas com trigger andam juntas; um teste pode conferir que as duas batem,
  consultando `pg_trigger`.
- `SET LOCAL` vale só até o fim da transação, então a flag não vaza para outras
  requisições que reusam a conexão do pool. Usar `SET` (sem `LOCAL`) seria bug.
- Um `ON DELETE CASCADE` que atinja essas tabelas também dispara o trigger; como
  as FKs de dados financeiros são `Restrict` (ADR 0010), isso só reforça a regra.
- O erro do trigger chega à aplicação como erro do Postgres (500): é bug de
  código, não caso de uso, e não precisa de tradução para código de API.

## Alternativas consideradas

- **Tratar escrita aninhada na extensão:** percorre a árvore de argumentos de todo
  modelo; frágil e incompleto a cada mudança do Prisma.
- **Só regra + revisão:** depende de lembrar; não cobre SQL cru.
- **Row Level Security:** mais amplo, complica o expurgo e as migrations; já
  descartado como primeira opção no ADR 0005.
- **Revogar `DELETE` do usuário de banco da aplicação e usar outro usuário no
  expurgo:** garantia equivalente, mas exige dois usuários de banco e duas
  conexões configuradas; mais infraestrutura para o mesmo efeito.
