# 0010. Exclusão de conta (LGPD)

- Status: Aceito (complementado por [0030](0030-acertos-simplificacao-e-membros-inativos.md) e [0032](0032-retencao-de-dados-pessoais.md))
- Data: 2026-09-23

## Contexto

A LGPD dá ao titular o direito de excluir seus dados, mas a regra 6 do CLAUDE.md
diz que dados financeiros nunca são apagados, e despesas de grupo também
pertencem a outras pessoas. Além disso:

- a linha de `user` é referenciada por FKs `Restrict` (autoria, `audit_log`);
  sem motivo escrito, um agente poderia "simplificar" apagando-a;
- `audit_log.before/after` de entidades de grupo pode conter o nome da pessoa;
- o ADR 0008 exige sempre um `OWNER`, mas a exclusão de conta não é bloqueada:
  se o único `OWNER` se excluir, o grupo fica sem dono.

## Decisão

**Fluxo**

1. Usuário pede a exclusão. A tela oferece a exportação antes (JSON com todos os
   seus dados) e lista os grupos afetados e o que vai acontecer com cada um.
2. Conta desativada na hora: login bloqueado, todas as sessões revogadas. Um
   e-mail com token `ACCOUNT_DELETION_CANCEL` (ADR 0014) permite cancelar
   durante os 30 dias.
3. Após 30 dias, um job BullMQ faz o expurgo definitivo, numa transação, apagando
   na ordem certa (as FKs continuam `Restrict`), com o client sem filtro (ADR 0005).

**Posse de grupo** (no pedido, não no fim dos 30 dias), para cada grupo em que a
pessoa é o único `OWNER`:

- se houver outro membro `ACTIVE` com conta, ele vira `OWNER`, escolhido por
  `joined_at` mais antigo e, em empate, pelo menor `group_member.id`. A promoção é
  auditada e não é desfeita se a exclusão for cancelada;
- se não houver (só restam membros sem conta), ninguém mais consegue acessar o
  grupo: ele é tratado como dado só da pessoa e apagado no expurgo, com despesas,
  partes, pagamentos e acertos.

**No expurgo**

- **Apagados de verdade:** dados só dela (contas, transações, categorias,
  orçamentos, investimentos, sessões, tokens, chaves de idempotência, grupos sem
  outro membro com conta) e as linhas de `audit_log` sobre essas entidades.
- **Mantidos:** despesas, partes, pagamentos e acertos de grupo. Os outros membros
  continuam vendo o saldo pendente. O membro dela fica
  `display_name = "Usuário removido"`, `user_id = NULL` (a saída não exige saldo zero).
- **`audit_log`:** nos snapshots das linhas de `group_member` dela,
  `display_name` vira "Usuário removido". É a única atualização permitida em
  `audit_log`. Textos livres de despesas (descrição, observação) são dados do
  grupo e ficam.

**A linha de `user` fica como lápide.** Outras tabelas mantidas apontam para ela
com FK `Restrict` (`audit_log.actor_user_id`, `created_by_user_id` de despesas e
acertos); anular essas FKs apagaria a trilha de "quem fez", que os outros membros
têm direito de ver. A lápide não guarda dado pessoal: `email =
'deleted+<id>@invalid'`, `name` nulo, `password_hash` nulo, `status = 'DELETED'`,
`deleted_at` preenchido. Nenhuma sessão, nenhum login. Na interface, qualquer
referência a um usuário `DELETED` aparece como "Usuário removido".

## Consequências

- Os outros membros do grupo continuam com saldos corretos; nenhum grupo com
  membros com conta fica sem `OWNER`.
- O e-mail real fica livre para um cadastro novo, que gera outro `user.id`.
- O expurgo é código sensível: exige teste de integração e revisão do `security`.

## Alternativas consideradas

- **Soft delete também na exclusão de conta:** mantém dados pessoais indefinidamente;
  não atende a LGPD.
- **Apagar a linha de `user` e anular as FKs:** perde a autoria das ações de grupo
  e exige FKs `SET NULL`, contra a regra de `Restrict` em dados financeiros.
- **Autoria por `group_member.id` em vez de `user.id`:** o `audit_log` é genérico
  (não só de grupo) e precisa de um ator global.
- **Bloquear a exclusão até transferir a posse:** condiciona o direito de
  exclusão a uma tarefa do titular, o que dificulta o exercício previsto na LGPD.
- **Grupo sem dono em modo somente leitura:** ninguém consegue renomear, remover
  membros ou arquivar; vira lixo permanente.
