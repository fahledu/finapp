# 0014. Envio de e-mail e tokens de uso único

- Status: Proposto
- Data: 2026-09-23

## Contexto

Vários fluxos já decididos ou previstos dependem de e-mail, mas a stack não tem
serviço de envio: recuperação de senha (agente security), link para cancelar a
exclusão de conta (ADR 0005), confirmação de e-mail e convites (ADR 0023). Todos
precisam de um token de uso único com as mesmas garantias.

## Decisão (recomendada)

**Envio**

- Interface `EmailSender` em `apps/api/src/integrations/email/`, implementada com
  `nodemailer` via SMTP. Trocar de provedor é só trocar variáveis de ambiente.
- Desenvolvimento e testes: **Mailpit** no Docker Compose (captura tudo, interface
  web na porta 8025). Nenhum e-mail real sai da máquina.
- Produção: provedor transacional com SMTP (ex.: Resend, Postmark, Amazon SES),
  com SPF, DKIM e DMARC configurados no domínio.
- Envio sempre por **job BullMQ** (retry com backoff), nunca dentro da requisição.
- Templates em português, texto simples + HTML, sem dado financeiro no corpo.

**Tokens** (tabela `user_token`)

- Colunas: `id`, `user_id`, `type` (`EMAIL_VERIFY`, `PASSWORD_RESET`,
  `ACCOUNT_DELETION_CANCEL`), `token_hash` (SHA-256, único), `expires_at`,
  `used_at`, `created_at`.
- 32 bytes de `crypto.randomBytes`, base64url; só o hash vai ao banco (como a sessão).
- Validade: verificação 24 h, reset 1 h, cancelamento de exclusão até o fim dos 30 dias.
- Uso único: consumir marca `used_at` na mesma transação da ação. Pedir um novo
  token invalida os anteriores do mesmo tipo.
- Reset de senha apaga todas as sessões do usuário (ADR 0007).
- Respostas não revelam se o e-mail existe ("se houver conta, enviamos um link").
- O token vai no link como parâmetro; a página faz `POST` com ele (GET nunca altera nada).

**Confirmação de e-mail:** o cadastro envia verificação; o login funciona antes de
confirmar, mas aceitar convite por e-mail exige e-mail confirmado (ADR 0023).

## Consequências

- Recuperação de senha e cancelamento da exclusão passam a ser implementáveis.
- Um serviço a mais no Compose (Mailpit) e secrets de SMTP no deploy.

## Alternativas consideradas

- **SDK específico de um provedor:** acopla o código ao fornecedor.
- **Enviar dentro da requisição:** lento e perde o e-mail se o provedor falhar.
- **JWT como token de reset:** não dá para revogar nem garantir uso único sem tabela.
