# 0010. Registro de usuário após o expurgo

- Status: Aceito
- Data: 2026-09-23
- Complementa: [0005](0005-soft-delete-auditoria-lgpd.md), [0008](0008-membros-de-grupo.md)

## Contexto

O ADR 0005 mantém a linha de `user` anonimizada após o expurgo; o ADR 0008 zera
`group_member.user_id` na exclusão de conta. Lidos juntos, parecem contraditórios:
se o vínculo com o grupo é desfeito, por que a linha de `user` continua? O motivo
não estava escrito, e um agente poderia "simplificar" apagando a linha.

## Decisão

As duas regras valem, com papéis diferentes:

- **`group_member.user_id = NULL`** (ADR 0008) desfaz o vínculo pessoa ↔ grupo.
  O membro vira "Usuário removido" e o histórico financeiro do grupo continua íntegro.
- **A linha de `user` fica como lápide** (ADR 0005) porque outras tabelas mantidas
  apontam para ela com FK `Restrict`: `audit_log.actor_user_id` das entidades de
  grupo e colunas de autoria (ex.: `created_by_user_id` de despesas e acertos).
  Trocar essas FKs por `NULL` apagaria a trilha de "quem fez", que os outros
  membros ainda têm direito de ver como "Usuário removido".
- A lápide não guarda dado pessoal: `email = 'deleted+<id>@invalid'`, `name` nulo,
  `password_hash` nulo, `status = 'DELETED'`, `deleted_at` preenchido. Nenhuma
  sessão, nenhum login possível.
- Na interface, qualquer referência a um usuário `DELETED` é exibida como
  "Usuário removido".

## Consequências

- Colunas de autoria em tabelas de grupo referenciam `user.id` sem problema, e
  o expurgo não precisa reescrevê-las.
- O e-mail real fica livre para um cadastro novo, que gera outro `user.id`.
- O que ainda pode conter dado pessoal é o conteúdo de `audit_log.before/after`;
  tratado no ADR 0017.

## Alternativas consideradas

- **Apagar a linha de `user` e anular as FKs:** perde a autoria das ações de grupo
  e exige FKs `SET NULL`, contra a regra de `Restrict` em dados financeiros.
- **Autoria por `group_member.id` em vez de `user.id`:** possível, mas o
  `audit_log` é genérico (não só de grupo) e precisa de um ator global.
