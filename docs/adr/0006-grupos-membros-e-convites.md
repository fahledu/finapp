# 0006. Grupos: membros, autorização e convites

- Status: Aceito
- Data: 2026-09-24

## Contexto

A divisão de gastos precisa de regras para: pessoas sem conta no app (comum no
Splitwise), quem pode fazer o quê no grupo, saída de membro com saldo pendente,
acesso ao histórico depois de sair, o que acontece quando um membro exclui a conta
e como alguém entra no grupo (quem convida, como o convite é entregue, quanto dura
e como evitar que o link errado dê acesso ao grupo).

Há ainda um invariante a proteger: sair exige saldo zero, mas editar ou apagar uma
despesa antiga que envolve quem saiu mudaria o saldo de alguém que já não tem
acesso ao grupo para acertá-lo.

## Decisão

**Modelo:** tabela `group_member`: `id`, `group_id`, `user_id` (**nullable**),
`display_name`, `role` (`OWNER`/`MEMBER`), `status` (`ACTIVE`/`LEFT`),
`joined_at`, `left_at`.

- Partes, pagamentos e acertos referenciam **`group_member.id`**, nunca `user.id`.
  É esse id que desempata a divisão e a simplificação de dívidas (ADR
  [0007](0007-despesas-de-grupo-acertos-e-saldos.md)).
- Membro sem conta (`user_id` nulo) é criado só com nome e pode ser vinculado a um
  usuário depois, por convite; o histórico é preservado.

**Autorização**

- Só usuários com membro `ACTIVE` no grupo leem ou alteram qualquer dado do grupo.
  Rotas de grupo usam um guard reutilizável `requireActiveMember(groupId)`.
- Membro sem conta não tem acesso (não há login).
- Qualquer membro ativo cria, edita e exclui (soft delete) despesas e acertos do
  grupo; tudo vai para o `audit_log` (ADR [0010](0010-soft-delete-auditoria-e-garantias-no-banco.md)).
- Só o `OWNER` renomeia o grupo, remove membros, cria ou revoga convites e reativa
  membros sem conta.

**Saída**

- Sair ou ser removido exige **saldo zero** no grupo; senão `409 MEMBER_HAS_BALANCE`.
- Depois de sair (`LEFT`), o usuário perde acesso a todo o grupo, inclusive ao
  histórico. Voltar reativa a mesma linha de `group_member`.
- Sempre existe pelo menos um `OWNER`; o último não sai sem transferir o papel.
- Exceção: exclusão de conta não é bloqueada por saldo (ADR
  [0012](0012-lgpd-exclusao-e-retencao.md)). O membro de quem excluiu a conta
  **não** vira `LEFT`: a linha é desvinculada do usuário (`user_id = NULL`,
  `display_name = "Usuário removido"`) e **continua `ACTIVE`**, como membro sem
  conta, para o grupo conseguir registrar acertos com ele.

**Membro `LEFT` congela o histórico dele**

- Criar, editar ou excluir despesa ou acerto que envolva membro `LEFT` (como
  pagador, participante, origem ou destino) → `409 MEMBER_NOT_ACTIVE`, com
  `details.memberIds`. Vale também para editar uma despesa antiga em que ele
  aparece, mesmo que a mudança não toque a parte dele.
- Para corrigir, o membro volta ao grupo antes (reativa a mesma linha). Assim o
  invariante "quem saiu tem saldo zero" nunca quebra.
- Membro com conta volta só por convite. Membro **sem conta** `LEFT` não tem login
  para aceitar convite: o `OWNER` o reativa com
  `POST /api/groups/:groupId/members/:memberId/reactivate`, registrado no
  `audit_log`.

**Convites:** tabela `group_invite` (`id`, `group_id`, `created_by_member_id`,
`token_hash` único, `email` opcional, `target_member_id` opcional, `expires_at`,
`accepted_at`, `accepted_by_user_id`, `revoked_at`, `created_at`).

- Token de 32 bytes, só o SHA-256 no banco (mesmo padrão da sessão, ADR
  [0011](0011-autenticacao-sessoes-email-e-tokens.md)).
- Validade de 7 dias, uso único, revogável. O link pode ser compartilhado por
  WhatsApp; enviar por e-mail é opcional (ADR 0011).
- `target_member_id` aponta para um membro sem conta: aceitar vincula o usuário a
  essa linha (preserva histórico e saldo). Sem alvo, aceitar cria um membro novo
  ou reativa a linha `LEFT` do usuário.
- `email` preenchido: só aceita quem tem esse e-mail **confirmado** (ADR 0011).
  Sem e-mail, qualquer usuário logado com o link aceita; a interface deixa claro
  que link sem e-mail equivale a senha.
- Abrir o link (GET) só mostra nome do grupo e quem convidou, exige login e **não
  altera nada**. Aceitar é `POST /api/invites/accept` com o token.
- Erros: expirado, revogado ou usado → `410 INVITE_INVALID` (mesmo código para
  todos, sem revelar qual); usuário já membro ativo → `409 ALREADY_MEMBER`;
  alvo já vinculado a outro usuário → `409`.
- Rate limit no aceite (ADR 0011); token nunca vai para log; aceite registrado no
  `audit_log`.

## Consequências

- Grupos podem ser montados sem serviço de e-mail (só link).
- Vincular um membro sem conta preserva todo o histórico.
- O saldo de quem saiu nunca muda sem ele; a soma dos saldos do grupo continua 0.
- Corrigir despesa antiga com ex-membro exige trazê-lo de volta. A reativação
  pelo `OWNER` garante que isso seja possível também com membro sem conta, sem
  deixar a despesa congelada para sempre.
- O "Usuário removido" continua ativo e aparece nas sugestões de acerto e nas
  listas de participantes. A interface pode escondê-lo do seletor de
  participantes de despesas **novas**, mas a API não o bloqueia.
- Ao sair, o usuário perde também o que o dashboard mostrava daquele grupo (ADR
  [0008](0008-relatorios-e-grupos-nas-financas-pessoais.md)).

## Alternativas consideradas

- **Partes referenciando `user.id`:** impede participantes sem conta e quebra
  quando o usuário é anonimizado.
- **Manter acesso de leitura após sair:** mais permissivo, porém mais código de
  autorização e mais superfície para vazamento.
- **Editar despesa com membro que saiu e reabrir o saldo dele:** quebra o
  invariante de saída com saldo zero, e ele não tem acesso para acertar.
- **Marcar como `LEFT` o membro de quem excluiu a conta:** o grupo não
  conseguiria mais acertar com ele.
- **Convite só por e-mail:** depende do serviço de e-mail e não funciona para o
  caso comum de mandar o link no grupo da viagem.
- **Qualquer membro ativo convida:** mais prático; pode ser liberado depois sem mudar o modelo.
- **Link permanente do grupo:** vaza fácil e não dá para saber quem entrou por qual link.
