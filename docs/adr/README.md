# Architecture Decision Records

Decisões estruturais e duradouras do FinApp. Cada ADR tem status:
**Proposto** (em discussão), **Aceito**, **Substituído por NNNN** ou **Descartado**.

Nunca edite a decisão de um ADR aceito. Para trocá-la, crie um novo que o
**substitua**. Para acrescentar regra sem contradizer a original, crie um que o
**complemente**; o ADR original ganha só a nota "complementado por NNNN" na
linha de status.

**ADR Proposto não é regra.** Agentes não o implementam por conta própria; o
architect o considera ao planejar a feature relacionada e pede a decisão (aceitar,
ajustar ou descartar) antes de seguir.

| # | Título | Status |
|---|---|---|
| [0001](0001-representacao-de-dinheiro.md) | Representação de dinheiro, decimais e porcentagens | Aceito |
| [0002](0002-datas-e-fusos.md) | Datas, instantes e fuso horário | Aceito |
| [0003](0003-moedas.md) | Suporte a moedas na V1 | Aceito |
| [0004](0004-algoritmo-de-divisao.md) | Algoritmo de divisão de gastos | Aceito, complementado por 0009 |
| [0005](0005-soft-delete-auditoria-lgpd.md) | Soft delete, auditoria e exclusão de conta (LGPD) | Aceito, complementado por 0010 |
| [0006](0006-idempotencia.md) | Idempotência de operações financeiras | Aceito |
| [0007](0007-sessoes.md) | Sessões e proteção CSRF | Aceito |
| [0008](0008-membros-de-grupo.md) | Membros de grupo e participantes sem conta | Aceito, complementado por 0010 |
| [0009](0009-partes-de-divisao-positivas.md) | Partes de divisão sempre positivas | Aceito |
| [0010](0010-registro-de-usuario-apos-expurgo.md) | Registro de usuário após o expurgo | Aceito |
| [0011](0011-versoes-da-stack.md) | Versões da stack e política de atualização | Aceito |
| [0012](0012-soft-delete-em-relacoes-e-escritas.md) | Soft delete em relações, escritas e SQL cru | Proposto |
| [0013](0013-topologia-de-deploy.md) | Topologia de deploy: mesma origem | Proposto |
| [0014](0014-envio-de-email-e-tokens.md) | Envio de e-mail e tokens de uso único | Proposto |
| [0015](0015-protecao-de-autenticacao.md) | Proteção de autenticação: e-mail, senha e rate limit | Proposto |
| [0016](0016-idempotencia-detalhes.md) | Idempotência: comparação, concorrência e expiração | Proposto |
| [0017](0017-expurgo-lgpd-auditoria-e-posse-de-grupo.md) | Expurgo LGPD: dados pessoais na auditoria e posse de grupo | Proposto |
| [0018](0018-despesas-de-grupo-e-financas-pessoais.md) | Despesas de grupo e finanças pessoais | Proposto |
| [0019](0019-transferencias-entre-contas.md) | Transferências entre contas | Proposto |
| [0020](0020-cartao-de-credito-e-parcelamento.md) | Cartão de crédito e compras parceladas | Proposto |
| [0021](0021-saldo-inicial-e-categorias.md) | Saldo inicial de conta e categorias padrão | Proposto |
| [0022](0022-multiplos-pagadores.md) | Despesa com mais de um pagador | Proposto |
| [0023](0023-convites-de-grupo.md) | Convites de grupo e vínculo de membro sem conta | Proposto |

## Decisões ainda sem ADR

Precisam de ADR quando a feature correspondente for planejada:

- **Investimentos (roadmap 9):** eventos societários (desdobramento, grupamento,
  bonificação), proventos (dividendos, JCP) e método de preço médio.
- **Orçamentos (roadmap 8):** moeda do orçamento e se a parte em despesas de grupo
  conta (ver 0018).
- **Recorrências (roadmap 11):** idempotência do job (não gerar a mesma ocorrência
  duas vezes), fuso do agendamento (ADR 0002) e edição de série.
- **Importação de extrato (roadmap 11):** deduplicação por `FITID` (OFX) ou hash
  de linha (CSV), limites de arquivo e revisão antes de gravar.
- **Câmbio:** as duas etapas previstas no ADR 0003.

## Modelo

```markdown
# NNNN. Título

- Status: Proposto
- Data: AAAA-MM-DD

## Contexto
Qual problema, quais forças em jogo.

## Decisão
O que foi decidido, de forma verificável.

## Consequências
O que fica mais fácil, o que fica mais difícil, o que precisa ser feito.

## Alternativas consideradas
Opção: por que não.
```
