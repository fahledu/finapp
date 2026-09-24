# 0032. Retenção de dados pessoais: backups, sessões e logs

- Status: Aceito
- Data: 2026-09-24
- Complementa: [0007](0007-sessoes-e-autenticacao.md), [0010](0010-exclusao-de-conta-lgpd.md)

## Contexto

O ADR 0010 expurga os dados de quem exclui a conta, mas o banco não é o único
lugar onde eles ficam. Backups guardam cópias completas; a tabela `session`
guarda IP e user agent (ADR 0007); os logs da API registram IP, rotas e, se
ninguém cuidar, cookies e corpos de requisição. Sem prazo definido, um restore
de backup antigo "ressuscita" uma conta expurgada, e os logs viram um cadastro
paralelo sem prazo de validade, contra o princípio de necessidade da LGPD.

## Decisão

**Backups**

- Backups automáticos diários da plataforma de Postgres (ADR 0013), com retenção
  de **no máximo 30 dias**, igual ao prazo de carência da exclusão (ADR 0010).
- Garantia: o expurgo acontece no mínimo 30 dias depois do pedido, então todo
  backup que ainda existe quando um expurgo roda foi tirado depois do pedido e já
  contém `deletion_requested_at` na linha de `user`. Se ele for restaurado, o job
  de expurgo (idempotente, seleciona contas pelo prazo vencido) expurga de novo.
- Por isso a retenção **nunca passa de 30 dias sem um ADR novo**, que exigiria um
  registro de expurgos fora do banco para reaplicar depois do restore.
- Runbook de restore (agente `devops`): restaurar, rodar o job de expurgo e só
  então liberar tráfego.

**Sessões**

- `ip` e `user_agent` existem só enquanto a sessão vive (no máximo 30 dias; o job
  diário do ADR 0007 apaga as expiradas).
- Não são copiados para outro lugar; a auditoria não guarda IP (ADR 0005).

**Logs (pino)**

- Retenção de 30 dias na plataforma.
- `redact` de `req.headers.cookie`, `req.headers.authorization` e
  `res.headers["set-cookie"]`.
- Corpo de requisição nunca é logado. E-mail e token nunca aparecem em log; para
  identificar a pessoa, usar `user.id`.
- IP fica no log por segurança (legítimo interesse: investigar abuso e força
  bruta), dentro dos 30 dias.

**Transparência:** os prazos acima aparecem na página de privacidade e na
exportação de dados (ADR 0010).

## Consequências

- Nenhuma cópia de dado pessoal sobrevive mais de ~30 dias ao expurgo, sem
  registro de expurgos fora do banco.
- A margem é justa: se a plataforma contar a retenção de um jeito que deixe um
  backup viver algumas horas além de 30 dias, um backup anterior ao pedido pode
  existir no momento do expurgo. Configurar retenção um pouco menor (ex.: 28 dias)
  quando a plataforma permitir, e conferir como ela conta o prazo.
- O expurgo precisa selecionar por `deletion_requested_at` vencido, não por uma
  lista enfileirada no pedido; a coluna precisa existir na linha de `user` (o ADR
  0010 descreve o fluxo, mas não nomeia a coluna; o agente `database` a cria).
- Restore também desfaz o que aconteceu depois do backup, inclusive um
  cancelamento de exclusão: a conta volta ao estado "exclusão pedida". Como o token
  `ACCOUNT_DELETION_CANCEL` também volta a não usado, o link original funciona de
  novo enquanto estiver no prazo; o runbook deve avisar as contas afetadas.
- Plano de backup menor que 30 dias de retenção limita a janela de recuperação de
  desastre; aceito na V1.
- Teste: um log de requisição autenticada não contém cookie, `set-cookie`, corpo
  nem e-mail.
- Chaves de rate limit no Redis que incluem e-mail (ADR 0007/0033) vivem só pelo
  TTL da janela (no máximo 1 h).

## Alternativas consideradas

- **Backups longos (90 dias ou mais) com lista de expurgos fora do banco:** mais
  recuperação, mas exige manter e reaplicar essa lista a cada restore; mais
  infraestrutura e mais um ponto de falha.
- **Não logar IP:** perde a capacidade de investigar abuso e ataques de força
  bruta.
- **Anonimizar IP no log (truncar ou hash):** efeito prático parecido dentro de
  30 dias, com mais código e menos utilidade na investigação.
