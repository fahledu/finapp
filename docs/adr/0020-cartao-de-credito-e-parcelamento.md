# 0020. Cartão de crédito e compras parceladas

- Status: Proposto
- Data: 2026-09-23

## Contexto

No Brasil, boa parte dos gastos passa pelo cartão de crédito, muitos parcelados
("10x sem juros"). O modelo atual só tem contas genéricas. Sem regra, o cartão vira
uma conta comum, a fatura não existe e o parcelamento é lançado à mão, com erro de
centavos (R$ 100 em 3x).

## Decisão (recomendada)

**Tipo de conta:** `account.kind` (`CHECKING`, `SAVINGS`, `CASH`, `CREDIT_CARD`).
Cartão tem `closing_day` e `due_day` (1 a 31; em meses mais curtos, vale o último dia).

**Compras e fatura**

- Compra no cartão é uma transação `EXPENSE` na conta do cartão, com data de
  competência = data da compra.
- Cada transação do cartão grava `statement_month` (`"YYYY-MM"`), calculado na
  criação a partir da data e do `closing_day` vigente. Fica congelado: mudar o dia
  de fechamento depois não move compras antigas de fatura.
- A fatura é derivada (soma por `statement_month`), não uma tabela.
- Pagar a fatura é uma **transferência** da conta corrente para o cartão (ADR 0019).
- Saldo do cartão negativo = dívida; a interface mostra "fatura atual", "próximas
  faturas" e "limite usado" (limite opcional, `credit_limit_cents`).

**Parcelamento**

- Tabela `installment_plan`: `total_cents`, `currency`, `count` (2 a 48),
  `first_statement_month`, `description`, `category_id`.
- Gera `count` transações com `installment_number` e `installment_plan_id`, uma
  por fatura consecutiva.
- Valores pelo mesmo cálculo do ADR 0004 (pesos iguais); os centavos que sobram
  vão para as **primeiras parcelas** (desempate por `installment_number`
  crescente), como no comércio. Soma das parcelas = total, com teste de propriedade.
- Editar o plano recalcula só as parcelas de faturas ainda não fechadas; excluir o
  plano faz soft delete de todas. Parcelas não são editadas isoladamente.
- Orçamento conta cada parcela no mês da sua fatura.

## Consequências

- Precisa entrar no roadmap antes de "Dashboard" (item 4) para os números fazerem
  sentido para quem usa cartão; ou ser explicitamente adiado.
- Juros de parcelamento e estorno de compra ficam fora (estorno já está fora da V1, ADR 0001).

## Alternativas consideradas

- **Cartão como conta comum:** sem fatura, sem vencimento; o dashboard mostra a
  compra no mês errado para quem controla pela fatura.
- **Tabela `statement` materializada:** mais rígida; só vale se houver fechamento
  manual com ajustes.
- **Centavos extras na última parcela:** também é comum; escolher um e manter.
