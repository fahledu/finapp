# Architecture Decision Records

Decisões estruturais e duradouras do FinApp. **São a fonte única das regras**:
CLAUDE.md, agentes, planos e guias citam o ADR, nunca copiam o detalhe.
Só o agente `architect` escreve aqui (garantido por hook).

Status: **Proposto** (em discussão), **Aceito**, **Substituído por NNNN** ou
**Descartado**. ADR Proposto não é regra: o architect o considera ao planejar e
pede a decisão antes de seguir.

## Como mudar uma regra

- **Antes do primeiro commit de código:** edite o ADR do assunto diretamente. Os
  ADRs são um por assunto; não crie ADR novo só para complementar outro.
- **Depois que houver código:** ADR aceito é imutável. Para trocar uma decisão,
  crie um novo que o **substitua** (o antigo vira "Substituído por NNNN"). Não
  use cadeias de "complementa": se precisar acrescentar, substitua pelo ADR
  inteiro revisado.
- Em qualquer caso: se o resumo da regra no CLAUDE.md mudar, atualize a linha de
  lá; `node scripts/check-docs.mjs` confere índice, links e citações.

Histórico: em 2026-09-24, antes de existir código, os 33 ADRs anteriores foram
consolidados nestes 15, com numeração nova. O conteúdo antigo está no git.

| # | Título | Status |
|---|---|---|
| [0001](0001-dinheiro-decimais-e-limites.md) | Dinheiro, decimais e limites de valores | Aceito |
| [0002](0002-datas-e-fusos.md) | Datas, instantes e fuso horário | Aceito |
| [0003](0003-moedas.md) | Moedas | Aceito |
| [0004](0004-contas-e-transacoes.md) | Contas e transações | Aceito |
| [0005](0005-cartao-e-parcelamento.md) | Cartão de crédito e compras parceladas | Aceito |
| [0006](0006-grupos-membros-e-convites.md) | Grupos: membros, autorização e convites | Aceito |
| [0007](0007-despesas-de-grupo-acertos-e-saldos.md) | Despesas de grupo: divisão, pagadores, acertos e saldos | Aceito |
| [0008](0008-relatorios-e-grupos-nas-financas-pessoais.md) | Relatórios e grupos nas finanças pessoais | Aceito |
| [0009](0009-escrita-transacao-idempotencia-e-outbox.md) | Escrita: transação entre camadas, idempotência e outbox | Aceito |
| [0010](0010-soft-delete-auditoria-e-garantias-no-banco.md) | Soft delete, auditoria e garantias no banco | Aceito |
| [0011](0011-autenticacao-sessoes-email-e-tokens.md) | Autenticação, sessões, e-mail e tokens | Aceito |
| [0012](0012-lgpd-exclusao-e-retencao.md) | LGPD: exclusão de conta e retenção | Aceito |
| [0013](0013-convencoes-de-api.md) | Convenções de API | Aceito |
| [0014](0014-deploy-ambientes-e-observabilidade.md) | Deploy, ambientes e observabilidade | Aceito |
| [0015](0015-versoes-da-stack.md) | Versões da stack e política de atualização | Aceito |

## Decisões ainda sem ADR

Precisam de ADR quando a feature correspondente for planejada:

- **Orçamentos (roadmap 9):** moeda do orçamento e como a parte em grupos entra
  (a view do ADR 0008 já traz "Gastos em grupo").
- **Investimentos (roadmap 10):** eventos societários, proventos, método de preço
  médio e valor derivado que arredonda para 0 centavo (ADR 0001).
- **Recorrências (roadmap 12):** idempotência do job, fuso do agendamento (ADR
  0002) e edição de série.
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
O que foi decidido, de forma verificável. Inclua os testes obrigatórios.

## Consequências
O que fica mais fácil, o que fica mais difícil, o que precisa ser feito.

## Alternativas consideradas
Opção: por que não.
```
