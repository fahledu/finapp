# 0003. Suporte a moedas na V1

- Status: Proposto
- Data: 2026-09-23

## Contexto

Todo valor já é guardado com código de moeda (ADR 0001), mas não havia regra para
operações com moedas diferentes: despesa em USD num grupo em BRL, dashboard somando
contas em moedas distintas, carteira com ativos no exterior.

## Decisão

Na V1, **nenhuma operação mistura moedas e não há conversão de câmbio**.

- Cada conta tem uma moeda; transações usam a moeda da conta.
- Cada grupo tem uma moeda; despesas e acertos usam a moeda do grupo.
- Ativos têm a moeda em que são cotados; posição e rentabilidade ficam nessa moeda.
- Enviar moeda diferente da esperada retorna `422` com código `CURRENCY_MISMATCH`.
- Totais (dashboard, patrimônio) são **agrupados por moeda** e exibidos
  separadamente. Nunca somar valores de moedas diferentes.
- Helpers de `money.ts` que combinam dois valores lançam erro se as moedas diferirem.

## Consequências

- Simples de implementar e testar; não há fonte de câmbio para manter.
- Viagem ao exterior exige converter manualmente antes de lançar.
- Como a moeda já está em todas as tabelas, suportar câmbio depois é aditivo:
  novo ADR com `original_amount_cents`, `original_currency` e `exchange_rate`
  (`NUMERIC(20,10)`) guardados na operação.

## Alternativas consideradas

- **Câmbio na despesa desde já:** exige decidir fonte da taxa, momento da cotação e
  arredondamento da conversão antes da divisão. Grande demais para a V1.
- **Moeda única (só BRL), sem coluna de moeda:** tornaria a expansão uma migration
  destrutiva.
