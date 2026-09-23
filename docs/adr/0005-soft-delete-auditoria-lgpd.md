# 0005. Soft delete, auditoria e exclusão de conta (LGPD)

- Status: Aceito
- Data: 2026-09-23

## Contexto

A regra 6 do CLAUDE.md diz que transações, despesas e acertos nunca são apagados.
A LGPD dá ao titular o direito de excluir seus dados. Além disso, despesas de grupo
também pertencem a outras pessoas e não podem sumir quando alguém sai.

O Prisma não filtra `deletedAt` sozinho: cada query esquecida vaza registro apagado.

## Decisão

**Soft delete**

- Transações, despesas, partes de despesa e acertos têm `deletedAt timestamptz NULL`.
- Uma Prisma Client Extension aplica `deletedAt: null` automaticamente em
  `findMany`, `findFirst`, `count`, `aggregate` e `groupBy` desses modelos.
  Leitura de registros apagados (auditoria, exportação) usa o client sem extensão,
  explicitamente.
- `findUnique` não aceita filtro extra: nesses modelos usar `findFirst`.
- Unicidade que deve ignorar registros apagados usa índice parcial
  (`CREATE UNIQUE INDEX ... WHERE deleted_at IS NULL`), escrito em SQL numa
  migration criada com `--create-only`.

**Auditoria**

- Tabela `audit_log`: `id`, `actor_user_id` (nullable), `action`
  (`CREATE`/`UPDATE`/`DELETE`), `entity_type`, `entity_id`, `before jsonb`,
  `after jsonb`, `created_at`.
- Escrita na **mesma `$transaction`** da alteração. Só inserção; a aplicação
  nunca faz update ou delete nela (exceto no expurgo LGPD abaixo).

**Exclusão de conta** (única exceção à regra 6)

1. Usuário pede a exclusão; a tela oferece a exportação antes (JSON com todos os
   seus dados).
2. Conta desativada na hora: login bloqueado, todas as sessões revogadas.
3. Após 30 dias (job BullMQ), expurgo definitivo:
   - **Apagados de verdade:** dados só dele (contas, transações, categorias,
     orçamentos, investimentos, sessões, chaves de idempotência) e as linhas de
     `audit_log` sobre essas entidades.
   - **Mantidos e anonimizados:** despesas, partes e acertos de grupo. O membro vira
     "Usuário removido" (ADR 0008); `user` fica com e-mail
     `deleted+<id>@invalid`, nome apagado, hash de senha nulo.
4. Durante os 30 dias, o usuário pode cancelar fazendo login pelo link enviado.

As FKs continuam `Restrict`; o job apaga na ordem certa dentro de uma transação.

## Consequências

- Os outros membros do grupo continuam com saldos corretos.
- O expurgo é código sensível: exige teste de integração e revisão do `security`.

## Alternativas consideradas

- **Soft delete também na exclusão de conta:** mantém dados pessoais indefinidamente;
  não atende a LGPD.
- **Filtro manual `deletedAt: null` em cada query:** fácil de esquecer.
- **`ON DELETE CASCADE`:** um delete acidental apagaria histórico financeiro.
