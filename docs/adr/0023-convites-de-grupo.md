# 0023. Convites de grupo e vínculo de membro sem conta

- Status: Proposto
- Data: 2026-09-23
- Complementa: [0008](0008-membros-de-grupo.md)

## Contexto

O ADR 0008 prevê que um membro sem conta "pode ser vinculado a um usuário por
convite" e que quem saiu pode voltar, mas não define o convite: quem pode criar,
como é entregue, quanto dura e como evitar que o link errado dê acesso ao grupo.

## Decisão (recomendada)

**Modelo:** `group_invite` (`id`, `group_id`, `created_by_member_id`, `token_hash`
único, `email` opcional, `target_member_id` opcional, `expires_at`, `accepted_at`,
`accepted_by_user_id`, `revoked_at`, `created_at`).

- Na V1, só `OWNER` cria e revoga convites.
- Token de 32 bytes, só o SHA-256 no banco (mesmo padrão de sessão e ADR 0014).
- Validade de 7 dias, uso único, revogável. O link pode ser compartilhado por
  WhatsApp; enviar por e-mail é opcional (ADR 0014).
- `target_member_id` aponta para um membro sem conta: aceitar vincula o usuário a
  essa linha (preserva histórico e saldo). Sem alvo, aceitar cria um membro novo
  ou reativa a linha `LEFT` do usuário (ADR 0008).
- `email` preenchido: só aceita quem tem esse e-mail **confirmado** (ADR 0014).
  Sem e-mail, qualquer usuário logado com o link aceita. A interface deixa claro
  que link sem e-mail equivale a senha.

**Aceite**

- Abrir o link (GET) só mostra nome do grupo e quem convidou, exige login e **não
  altera nada**. Aceitar é `POST /api/invites/accept` com o token.
- Erros: expirado, revogado ou usado → `410 INVITE_INVALID` (mesmo código para
  todos, sem revelar qual); usuário já membro ativo → `409 ALREADY_MEMBER`;
  alvo já vinculado a outro usuário → `409`.
- Rate limit no aceite (ADR 0015); token nunca vai para log.
- Aceite registrado no `audit_log`.

## Consequências

- Vínculo de membro sem conta preserva todo o histórico, como o ADR 0008 exige.
- Grupos podem ser montados sem serviço de e-mail (só link).

## Alternativas consideradas

- **Convite só por e-mail:** depende do serviço de e-mail e não funciona para o
  caso comum de mandar o link no grupo da viagem.
- **Qualquer membro ativo convida:** mais prático; pode ser liberado depois sem mudar o modelo.
- **Link permanente do grupo:** vaza fácil e não dá para saber quem entrou por qual link.
