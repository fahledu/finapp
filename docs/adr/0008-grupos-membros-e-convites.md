# 0008. Grupos: membros e convites

- Status: Aceito
- Data: 2026-09-23

## Contexto

A divisão de gastos precisava de regras para: pessoas sem conta no app (comum no
Splitwise), saída de membro com saldo pendente, acesso ao histórico depois de sair,
o que acontece quando um membro exclui a conta, e como alguém entra no grupo
(quem convida, como o convite é entregue, quanto dura e como evitar que o link
errado dê acesso ao grupo).

## Decisão

**Modelo:** tabela `group_member`: `id`, `group_id`, `user_id` (**nullable**),
`display_name`, `role` (`OWNER`/`MEMBER`), `status` (`ACTIVE`/`LEFT`),
`joined_at`, `left_at`.

- Partes, pagamentos e acertos referenciam **`group_member.id`**, nunca `user.id`.
  É esse id que desempata a divisão (ADR 0004).
- Membro sem conta (`user_id` nulo) é criado só com nome e pode ser vinculado a um
  usuário depois, por convite; o histórico é preservado.

**Autorização**

- Só usuários com membro `ACTIVE` no grupo leem ou alteram qualquer dado do grupo.
  Rotas de grupo usam um guard reutilizável `requireActiveMember(groupId)`.
- Membro sem conta não tem acesso (não há login).
- Qualquer membro ativo cria, edita e exclui (soft delete) despesas do grupo; tudo
  vai para o `audit_log`.
- Só o `OWNER` renomeia o grupo, remove membros e cria ou revoga convites.

**Saída**

- Sair ou ser removido exige **saldo zero** no grupo; senão `409 MEMBER_HAS_BALANCE`.
- Depois de sair (`LEFT`), o usuário perde acesso a todo o grupo, inclusive ao
  histórico. Voltar reativa a mesma linha de `group_member`.
- Sempre existe pelo menos um `OWNER`; o último não sai sem transferir o papel.
- Exceção: exclusão de conta não é bloqueada por saldo (ADR 0010).

**Convites:** tabela `group_invite` (`id`, `group_id`, `created_by_member_id`,
`token_hash` único, `email` opcional, `target_member_id` opcional, `expires_at`,
`accepted_at`, `accepted_by_user_id`, `revoked_at`, `created_at`).

- Token de 32 bytes, só o SHA-256 no banco (mesmo padrão da sessão, ADR 0007).
- Validade de 7 dias, uso único, revogável. O link pode ser compartilhado por
  WhatsApp; enviar por e-mail é opcional (ADR 0014).
- `target_member_id` aponta para um membro sem conta: aceitar vincula o usuário a
  essa linha (preserva histórico e saldo). Sem alvo, aceitar cria um membro novo
  ou reativa a linha `LEFT` do usuário.
- `email` preenchido: só aceita quem tem esse e-mail **confirmado** (ADR 0014).
  Sem e-mail, qualquer usuário logado com o link aceita; a interface deixa claro
  que link sem e-mail equivale a senha.
- Abrir o link (GET) só mostra nome do grupo e quem convidou, exige login e **não
  altera nada**. Aceitar é `POST /api/invites/accept` com o token.
- Erros: expirado, revogado ou usado → `410 INVITE_INVALID` (mesmo código para
  todos, sem revelar qual); usuário já membro ativo → `409 ALREADY_MEMBER`;
  alvo já vinculado a outro usuário → `409`.
- Rate limit no aceite (ADR 0007); token nunca vai para log; aceite registrado no
  `audit_log`.

## Consequências

- Grupos podem ser montados sem serviço de e-mail (só link).
- Vincular um membro sem conta preserva todo o histórico.

## Alternativas consideradas

- **Partes referenciando `user.id`:** impede participantes sem conta e quebra
  quando o usuário é anonimizado.
- **Manter acesso de leitura após sair:** mais permissivo, porém mais código de
  autorização e mais superfície para vazamento.
- **Convite só por e-mail:** depende do serviço de e-mail e não funciona para o
  caso comum de mandar o link no grupo da viagem.
- **Qualquer membro ativo convida:** mais prático; pode ser liberado depois sem mudar o modelo.
- **Link permanente do grupo:** vaza fácil e não dá para saber quem entrou por qual link.
