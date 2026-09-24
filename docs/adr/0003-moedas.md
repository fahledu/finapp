# 0003. Suporte a moedas na V1

- Status: Aceito
- Data: 2026-09-23

## Contexto

Todo valor já é guardado com código de moeda (ADR 0001), mas não havia regra para
operações com moedas diferentes: despesa em USD num grupo em BRL, dashboard somando
contas em moedas distintas, carteira com ativos no exterior.

## Decisão

Na V1, **nenhuma operação mistura moedas e não há conversão de câmbio**.

**Moedas aceitas:** lista fechada `BRL`, `USD`, `EUR`, definida uma única vez em
`packages/shared` (`SUPPORTED_CURRENCIES` + `currencySchema = z.enum(...)`) e usada
por todos os schemas. Código fora da lista → `422 VALIDATION_ERROR`.

- Todas as moedas da lista têm **2 casas decimais** (unidade menor = centavo), o
  que mantém válidos o nome `amountCents` e o parse de `"1.234,56"`.
- Adicionar outra moeda com 2 casas (ex.: `GBP`) é só incluir na lista.
- Moeda com outro número de casas (`JPY` = 0, `BHD` = 3) **não** entra na lista
  sem um ADR novo que trate a unidade menor por moeda.
- No banco, a coluna continua `CHAR(3)` com `CHECK (currency ~ '^[A-Z]{3}$')`,
  sem enum: ampliar a lista não exige migration.

**Regras de uso**

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
  operações antigas não têm conversão, então não há dado a migrar.

**Evolução prevista** (cada etapa com ADR próprio, quando houver necessidade real):

1. **Conversão para exibição** (junto com cotações, roadmap item 11): patrimônio
   consolidado em BRL usando a taxa do dia (ex.: PTAX do Banco Central). Só leitura,
   nada é gravado nas operações.
2. **Conversão gravada na operação:** despesa em moeda diferente da do grupo, com
   `original_amount_cents`, `original_currency` e `exchange_rate` (`NUMERIC(20,10)`)
   guardados. Exige decidir a fonte da taxa, se o usuário pode editá-la e se o
   arredondamento vem antes ou depois da divisão.

Taxas históricas (PTAX) são públicas, então adiar a conversão não perde informação
necessária para cálculos futuros, como custo em BRL para imposto de renda.

## Alternativas consideradas

- **Câmbio na despesa desde já:** exige decidir fonte da taxa, momento da cotação e
  arredondamento da conversão antes da divisão. Grande demais para a V1.
- **Moeda única (só BRL), sem coluna de moeda:** tornaria a expansão uma migration
  destrutiva.
- **Aceitar qualquer código ISO 4217:** moedas com 0 ou 3 casas decimais seriam
  gravadas com escala errada sem nenhum erro.
- **Enum de moeda no banco:** cada moeda nova exigiria migration.
