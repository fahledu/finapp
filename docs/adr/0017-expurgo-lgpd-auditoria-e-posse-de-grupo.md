# 0017. Expurgo LGPD: dados pessoais na auditoria e posse de grupo

- Status: Proposto
- Data: 2026-09-23
- Complementa: [0005](0005-soft-delete-auditoria-lgpd.md), [0008](0008-membros-de-grupo.md), [0010](0010-registro-de-usuario-apos-expurgo.md)

## Contexto

Duas lacunas no expurgo de conta:

1. `audit_log.before/after` guarda snapshots em JSON. Linhas sobre entidades de
   grupo (mantidas após o expurgo) podem conter o nome ou e-mail da pessoa
   excluída, por exemplo na auditoria da própria linha de `group_member`.
2. O ADR 0008 exige sempre um `OWNER`, mas a exclusão de conta não é bloqueada.
   Se o único `OWNER` se excluir, o grupo fica sem dono.

## Decisão (recomendada)

**Snapshots de auditoria**

- `before/after` guardam só campos de domínio da entidade e referências por id
  (`group_member.id`, `user.id`). Nunca e-mail, hash de senha, token, IP ou
  user agent. Uma função `toAuditSnapshot()` por entidade define os campos.
- O único dado pessoal permitido é `group_member.display_name`. No expurgo, os
  snapshots das linhas de `group_member` da pessoa têm `display_name` trocado
  por "Usuário removido" (a única atualização permitida em `audit_log`, na mesma
  transação do expurgo).
- Textos livres de despesas (descrição, observação) são dados do grupo e ficam.

**Posse de grupo**

- Ao **pedir** a exclusão (não no fim dos 30 dias), para cada grupo em que a
  pessoa é o único `OWNER`:
  - se houver outro membro `ACTIVE` com conta: ele vira `OWNER`, escolhido por
    `joined_at` mais antigo e, em empate, pelo menor `group_member.id`. A
    promoção é auditada e não é desfeita se a exclusão for cancelada;
  - se não houver (só restam membros sem conta): ninguém mais consegue acessar o
    grupo, e ele é tratado como dado só da pessoa. É apagado de verdade no
    expurgo, junto com despesas, partes e acertos.
- A tela de exclusão lista antes esses grupos e o que vai acontecer com cada um.

## Consequências

- O expurgo passa a ter uma etapa de reescrita controlada de `audit_log`, coberta
  por teste de integração e revisão do agente security.
- Nenhum grupo com membros com conta fica sem `OWNER`.

## Alternativas consideradas

- **Bloquear a exclusão até transferir a posse:** condiciona o direito de
  exclusão a uma tarefa do titular, o que dificulta o exercício previsto na LGPD.
- **Grupo sem dono em modo somente leitura:** ninguém consegue renomear, remover
  membros ou arquivar; vira lixo permanente.
- **Não guardar snapshots, só ids:** perde a utilidade da auditoria para
  investigar alterações de valores.
