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

**Linha de base (2026-09-24).** Antes de existir código, os ADRs foram
consolidados: cada assunto ficou em um arquivo só, sem cadeias de complementos.
Foi uma exceção única; a partir daqui, a imutabilidade acima vale sem exceção.

| # | Título | Status |
|---|---|---|
| [0001](0001-representacao-de-dinheiro.md) | Representação de dinheiro, decimais e porcentagens | Aceito, complementado por 0024 |
| [0002](0002-datas-e-fusos.md) | Datas, instantes e fuso horário | Aceito |
| [0003](0003-moedas.md) | Suporte a moedas na V1 | Aceito |
| [0004](0004-despesas-de-grupo.md) | Despesas de grupo: divisão, pagadores e saldos | Aceito |
| [0005](0005-soft-delete-e-auditoria.md) | Soft delete e auditoria | Aceito |
| [0006](0006-idempotencia.md) | Idempotência de operações financeiras | Aceito |
| [0007](0007-sessoes-e-autenticacao.md) | Sessões, CSRF e proteção de autenticação | Aceito |
| [0008](0008-grupos-membros-e-convites.md) | Grupos: membros e convites | Aceito |
| [0010](0010-exclusao-de-conta-lgpd.md) | Exclusão de conta (LGPD) | Aceito |
| [0011](0011-versoes-da-stack.md) | Versões da stack e política de atualização | Aceito |
| [0013](0013-topologia-de-deploy.md) | Topologia de deploy: mesma origem | Aceito |
| [0014](0014-envio-de-email-e-tokens.md) | Envio de e-mail e tokens de uso único | Aceito |
| [0018](0018-despesas-de-grupo-e-financas-pessoais.md) | Despesas de grupo e finanças pessoais | Aceito |
| [0019](0019-transferencias-entre-contas.md) | Transferências entre contas | Aceito |
| [0020](0020-cartao-de-credito-e-parcelamento.md) | Cartão de crédito e compras parceladas | Aceito |
| [0021](0021-saldo-inicial-e-categorias.md) | Saldo inicial de conta e categorias padrão | Aceito |
| [0024](0024-limites-de-valores.md) | Limites de valores monetários e decimais | Aceito |

**Números aposentados** (incorporados na consolidação; nunca reutilize):
0009 e 0022 → 0004 · 0012 → 0005 · 0016 → 0006 · 0015 → 0007 · 0023 → 0008 ·
0017 → 0010. O próximo ADR novo é o **0025**. O conteúdo antigo está no histórico
do git.

## Decisões ainda sem ADR

Precisam de ADR quando a feature correspondente for planejada. Questões menores
e pontos cegos conhecidos estão em [`docs/STATUS.md`](../STATUS.md).

- **Acertos e simplificação de dívidas (roadmap 8):** acerto parcial ou acima da
  dívida, acerto com membro sem conta, quem registra, desempate determinístico da
  simplificação.
- **Investimentos (roadmap 10):** eventos societários (desdobramento, grupamento,
  bonificação), proventos (dividendos, JCP), método de preço médio e valor
  derivado que arredonda para 0 centavo (ver 0024).
- **Orçamentos (roadmap 9):** moeda do orçamento e se a parte em despesas de grupo
  conta (ver 0018).
- **Recorrências (roadmap 12):** idempotência do job (não gerar a mesma ocorrência
  duas vezes), fuso do agendamento (ADR 0002) e edição de série.
- **Importação de extrato (roadmap 12):** deduplicação por `FITID` (OFX) ou hash
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
