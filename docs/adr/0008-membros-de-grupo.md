# 0008. Membros de grupo e participantes sem conta

- Status: Proposto
- Data: 2026-09-23

## Contexto

A divisão de gastos precisava de regras para: pessoas sem conta no app (comum no
Splitwise), saída de membro com saldo pendente, acesso ao histórico depois de sair
e o que acontece quando um membro exclui a conta (ADR 0005).

## Decisão

**Modelo:** tabela `group_member`: `id`, `group_id`, `user_id` (**nullable**),
`display_name`, `role` (`OWNER`/`MEMBER`), `status` (`ACTIVE`/`LEFT`),
`joined_at`, `left_at`.

- Partes de despesa e acertos referenciam **`group_member.id`**, nunca `user.id`.
  É esse id que desempata a divisão (ADR 0004).
- Membro sem conta (`user_id` nulo) é criado só com nome. Mais tarde pode ser
  vinculado a um usuário por convite; o histórico é preservado.

**Autorização**

- Só usuários com membro `ACTIVE` no grupo leem ou alteram qualquer dado do grupo.
- Membro sem conta não tem acesso (não há login).
- Qualquer membro ativo cria, edita e exclui (soft delete) despesas do grupo; tudo
  vai para o `audit_log`.
- Só o `OWNER` renomeia o grupo e remove membros.

**Saída**

- Sair ou ser removido exige **saldo zero** no grupo; senão `409 MEMBER_HAS_BALANCE`.
- Depois de sair (`LEFT`), o usuário perde acesso a todo o grupo, inclusive ao
  histórico. Voltar reativa a mesma linha de `group_member`.
- Exceção: exclusão de conta não é bloqueada por saldo. O membro fica
  `display_name = "Usuário removido"`, `user_id = NULL`, e os outros continuam
  vendo o saldo pendente.

## Consequências

- Rotas de grupo usam um guard reutilizável `requireActiveMember(groupId)`.
- Sempre existe pelo menos um `OWNER`; o último não sai sem transferir o papel.

## Alternativas consideradas

- **Partes referenciando `user.id`:** impede participantes sem conta e quebra
  quando o usuário é anonimizado.
- **Manter acesso de leitura após sair:** mais permissivo, porém mais código de
  autorização e mais superfície para vazamento.
