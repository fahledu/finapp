# 0012. LGPD: exclusão de conta e retenção

- Status: Aceito
- Data: 2026-09-24

## Contexto

A LGPD dá ao titular o direito de excluir seus dados, mas a regra 6 do CLAUDE.md
diz que dados financeiros nunca são apagados, e despesas de grupo também
pertencem a outras pessoas. Além disso:

- a linha de `user` é referenciada por FKs `Restrict` (autoria, `audit_log`);
  sem motivo escrito, um agente poderia "simplificar" apagando-a;
- `audit_log.before/after` de entidades de grupo pode conter o nome da pessoa;
- sempre existe um `OWNER` por grupo (ADR [0006](0006-grupos-membros-e-convites.md)),
  mas a exclusão de conta não é bloqueada: se o único `OWNER` se excluir, o grupo
  fica sem dono.

O banco também não é o único lugar onde os dados ficam. Backups guardam cópias
completas; a tabela `session` guarda IP e user agent (ADR
[0011](0011-autenticacao-sessoes-email-e-tokens.md)); os logs da API registram IP,
rotas e, se ninguém cuidar, cookies e corpos de requisição. Sem prazo definido,
um restore de backup antigo "ressuscita" uma conta expurgada, e os logs viram um
cadastro paralelo sem prazo de validade, contra o princípio de necessidade da LGPD.

## Decisão

### Fluxo de exclusão

1. Usuário pede a exclusão, informando a senha atual (errada →
   `403 INVALID_CURRENT_PASSWORD`, contada como falha de login, como no ADR
   0011). A tela oferece a exportação antes (JSON com todos os seus dados) e
   lista os grupos afetados e o que vai acontecer com cada um.
2. Na mesma transação do pedido: `user.deletion_requested_at` preenchido, conta
   desativada (login bloqueado), todas as sessões apagadas, posse de grupo
   resolvida (abaixo) e e-mail com token `ACCOUNT_DELETION_CANCEL` enfileirado
   pelo outbox (ADRs 0011 e [0009](0009-escrita-transacao-idempotencia-e-outbox.md)).
   O token permite cancelar durante os 30 dias.
3. Após 30 dias, um job BullMQ agendado (não passa pelo outbox) faz o expurgo
   definitivo, numa transação por conta, apagando na ordem certa (as FKs continuam
   `Restrict`), com o client sem filtro e a flag `app.allow_purge` ligada por
   `SET LOCAL` (ADR [0010](0010-soft-delete-auditoria-e-garantias-no-banco.md)).

O job seleciona as contas por **`deletion_requested_at` vencido**, não por uma
lista enfileirada no pedido, e é idempotente: rodar de novo sobre uma conta já
expurgada não faz nada. Isso é o que torna o restore de backup seguro (abaixo).

**Durante a carência** o único caminho de volta é o link de cancelamento. Pedido
de reset de senha recebe a resposta neutra de sempre (ADR 0011) e não gera token
nem e-mail; login continua bloqueado.

### Posse de grupo

No pedido, não no fim dos 30 dias, para cada grupo em que a pessoa é o único
`OWNER`:

- se houver outro membro `ACTIVE` com conta, ele vira `OWNER`, escolhido por
  `joined_at` mais antigo e, em empate, pelo menor `group_member.id`. A promoção é
  auditada e não é desfeita se a exclusão for cancelada;
- se não houver (só restam membros sem conta), ninguém mais consegue acessar o
  grupo: ele é tratado como dado só da pessoa e apagado no expurgo, com despesas,
  partes, pagamentos e acertos.

**No expurgo a posse é reavaliada:** se durante a carência entrou no grupo um
membro `ACTIVE` com conta, ele é promovido a `OWNER` pela mesma regra (auditada)
e o grupo é mantido em vez de apagado.

### No expurgo

- **Apagados de verdade:** dados só dela (contas, transações, categorias,
  orçamentos, investimentos, sessões, tokens, chaves de idempotência, grupos sem
  outro membro com conta) e as linhas de `audit_log` sobre essas entidades.
- **Mantidos:** despesas, partes, pagamentos e acertos de grupo. Os outros membros
  continuam vendo o saldo pendente e registrando acertos. O membro dela fica
  `display_name = "Usuário removido"`, `user_id = NULL`, `role = MEMBER` e
  **continua `ACTIVE`**, como membro sem conta (ADR 0006); a regra de posse acima
  garante outro `OWNER`. A saída de conta não exige saldo zero: desvincula o
  usuário da linha, não a marca `LEFT`.
- **Convites:** convites pendentes (não aceitos nem revogados) com `email` da
  pessoa são revogados (`revoked_at`) e têm o `email` anulado.
- **`audit_log`:** nos snapshots das linhas de `group_member` dela,
  `display_name` vira "Usuário removido". É a única atualização permitida em
  `audit_log`, e só passa pelo trigger com `app.allow_purge` ligada (ADR 0010).
  Textos livres de despesas (descrição, observação) são dados do grupo e ficam.

### A linha de `user` fica como lápide

Outras tabelas mantidas apontam para ela com FK `Restrict`
(`audit_log.actor_user_id`, `created_by_user_id` de despesas e acertos); anular
essas FKs apagaria a trilha de "quem fez", que os outros membros têm direito de
ver. A lápide não guarda dado pessoal: `email = 'deleted+<id>@invalid'`, `name`,
`pending_email` e `password_hash` nulos, `status = 'DELETED'`, `deleted_at`
preenchido. Nenhuma sessão, nenhum login, nenhum e-mail enviado. Na interface,
qualquer referência a um usuário `DELETED` aparece como "Usuário removido".

### Backups

- Backups automáticos diários da plataforma de Postgres (ADR
  [0014](0014-deploy-ambientes-e-observabilidade.md)), com retenção configurada em
  **28 dias** e **nunca acima de 30**, o prazo de carência da exclusão. Conferir
  como a plataforma conta o prazo.
- Garantia: o expurgo acontece no mínimo 30 dias depois do pedido, então todo
  backup que ainda existe quando um expurgo roda foi tirado depois do pedido e já
  contém `deletion_requested_at`. Se ele for restaurado, o job de expurgo expurga
  de novo.
- A retenção **nunca passa de 30 dias sem um ADR novo**, que exigiria um registro
  de expurgos fora do banco para reaplicar depois do restore.
- Runbook de restore (agente `devops`): restaurar, rodar o job de expurgo e só
  então liberar tráfego; avisar as contas cujo cancelamento de exclusão foi
  desfeito pelo restore (ver Consequências).

### Sessões

- `ip` e `user_agent` existem só enquanto a sessão vive (no máximo 30 dias; o job
  diário do ADR 0011 apaga as expiradas).
- Não são copiados para outro lugar; a auditoria não guarda IP (ADR 0010).

### Logs (pino)

- Retenção de 30 dias na plataforma.
- `redact` de `req.headers.cookie`, `req.headers.authorization` e
  `res.headers["set-cookie"]`.
- Corpo de requisição e payload de job nunca são logados. E-mail e token nunca
  aparecem em log; para identificar a pessoa, usar `user.id`.
- IP fica no log por segurança (legítimo interesse: investigar abuso e força
  bruta), dentro dos 30 dias.

### Redis

Chaves de rate limit que incluem e-mail (ADR 0011) vivem só pelo TTL da janela
(no máximo 1 h).

### Transparência

Os prazos acima aparecem na página de privacidade e na exportação de dados.

### Testes obrigatórios

- Expurgo (integração, Postgres real): apaga os dados só dela, mantém despesas e
  acertos de grupo com saldos corretos, deixa o membro `ACTIVE` como "Usuário
  removido" com `role = MEMBER`, reescreve `display_name` nos snapshots do
  `audit_log`, revoga convites pendentes com o e-mail dela e deixa a lápide sem
  dado pessoal. Rodar duas vezes não muda nada.
- Posse: único `OWNER` com outro membro com conta → promoção pelo `joined_at` mais
  antigo; sem outro membro com conta → grupo apagado no expurgo; membro com conta
  que entrou durante a carência → promovido no expurgo, grupo mantido.
- Pedido de exclusão com senha errada → `403 INVALID_CURRENT_PASSWORD`, nada muda.
- Pedido de reset durante a carência → resposta neutra, nenhum token nem e-mail.
- Cancelamento dentro do prazo reativa a conta e mantém a promoção de `OWNER`.
- Log de requisição autenticada não contém cookie, `set-cookie`, corpo nem e-mail.

## Consequências

- Os outros membros do grupo continuam com saldos corretos; nenhum grupo com
  membros com conta fica sem `OWNER`.
- O "Usuário removido" continua ativo e aparece nas sugestões de acerto e nas
  listas de participantes (ADR 0006).
- O e-mail real fica livre para um cadastro novo, que gera outro `user.id`.
- O expurgo é código sensível: exige teste de integração e revisão do `security`.
- Nenhuma cópia de dado pessoal sobrevive mais de ~30 dias ao expurgo, sem
  registro de expurgos fora do banco. A margem é justa: se a plataforma contar a
  retenção de um jeito que deixe um backup viver algumas horas além do limite,
  um backup anterior ao pedido poderia existir no momento do expurgo; por isso os
  28 dias.
- Restore também desfaz o que aconteceu depois do backup, inclusive um
  cancelamento de exclusão: a conta volta ao estado "exclusão pedida". Como o token
  `ACCOUNT_DELETION_CANCEL` também volta a não usado, o link original funciona de
  novo enquanto estiver no prazo; o runbook avisa as contas afetadas.
- Retenção de backup menor que 30 dias limita a janela de recuperação de
  desastre; aceito na V1.
- `deletion_requested_at` é coluna da linha de `user` (agente `database`).

## Alternativas consideradas

- **Soft delete também na exclusão de conta:** mantém dados pessoais
  indefinidamente; não atende a LGPD.
- **Apagar a linha de `user` e anular as FKs:** perde a autoria das ações de grupo
  e exige FKs `SET NULL`, contra a regra de `Restrict` em dados financeiros.
- **Autoria por `group_member.id` em vez de `user.id`:** o `audit_log` é genérico
  (não só de grupo) e precisa de um ator global.
- **Bloquear a exclusão até transferir a posse:** condiciona o direito de
  exclusão a uma tarefa do titular, o que dificulta o exercício previsto na LGPD.
- **Grupo sem dono em modo somente leitura:** ninguém consegue renomear, remover
  membros ou arquivar; vira lixo permanente.
- **Marcar como `LEFT` o membro de quem excluiu a conta:** o grupo não conseguiria
  mais acertar com ele.
- **Backups longos (90 dias ou mais) com lista de expurgos fora do banco:** mais
  recuperação, mas exige manter e reaplicar essa lista a cada restore; mais
  infraestrutura e mais um ponto de falha.
- **Não logar IP:** perde a capacidade de investigar abuso e força bruta.
- **Anonimizar IP no log (truncar ou hash):** efeito prático parecido dentro de
  30 dias, com mais código e menos utilidade na investigação.
