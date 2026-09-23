# 0001. Representação de dinheiro, decimais e porcentagens

- Status: Proposto
- Data: 2026-09-23

## Contexto

O CLAUDE.md proíbe float para dinheiro e manda usar centavos inteiros, mas deixava
em aberto: `bigint` ou `number` no código? Como trafegar no JSON (`JSON.stringify`
lança erro com `bigint`)? Como representar `Prisma.Decimal` no frontend, onde ele
não existe? Qual o sinal de uma despesa? Como guardar porcentagens de divisão?

## Decisão

**Valores monetários**

- Banco: `amount_cents BIGINT` + `currency CHAR(3)` (`BigInt` / `@db.Char(3)` no Prisma).
- Código (shared, api, web): `number` inteiro. Todo valor passa por
  `Number.isSafeInteger`. O limite (±9 × 10¹⁵ centavos, ~R$ 90 trilhões) é
  mais que suficiente.
- A conversão `bigint` ↔ `number` acontece **só no repository**. Se um valor do
  banco não for inteiro seguro, lançar erro (nunca truncar).
- JSON: `{ "amountCents": 12345, "currency": "BRL" }`, validado pelo
  `moneySchema` de `packages/shared`.

**Sinal**

- Valores são sempre positivos (`CHECK (amount_cents > 0)`). A direção vem de um
  campo de tipo: transação tem `type` (`INCOME`, `EXPENSE`, `TRANSFER`); despesa de
  grupo é sempre um gasto. Estornos são uma operação própria, fora da V1.
- Saldos calculados (conta, balanço entre membros) podem ser negativos, mas não
  são armazenados como valor de operação.

**Quantidades e preços unitários de investimento** (exceção à regra de centavos)

- Banco: `NUMERIC(20,8)` (`Decimal @db.Decimal(20, 8)`).
- API: `Prisma.Decimal` (decimal.js) em toda conta.
- JSON: **string** decimal com ponto, até 8 casas: `"12.5"`, `"0.00012345"`
  (schema `decimalStringSchema`, regex `^\d+(\.\d{1,8})?$`).
- Web: exibe a string formatada; se precisar calcular, usa `decimal.js`, nunca
  `Number()`.
- Valor financeiro derivado (quantidade × preço) vira centavos **uma única vez**,
  no fim do cálculo, com arredondamento `ROUND_HALF_UP`. Taxas e corretagem são
  valores próprios em centavos, nunca embutidos no preço.

**Porcentagens**

- Pontos-base inteiros: `10000` = 100%, `3333` = 33,33%.

## Consequências

- Zod, Recharts e `Intl.NumberFormat` funcionam direto com `number`.
- Toda leitura/escrita de dinheiro no repository precisa converter; um helper em
  `packages/shared/src/money.ts` (`toCents`, `fromDbCents`) evita repetição.
- Operações que multiplicam valores grandes (ex.: `total × pesos` na divisão) usam
  `bigint` internamente para não estourar o inteiro seguro (ver ADR 0004).

## Alternativas consideradas

- **`bigint` de ponta a ponta:** exige serializador customizado no Fastify, string
  no JSON e conversão no frontend para exibir e plotar. Custo alto sem ganho real
  dado o limite acima.
- **Valor com sinal:** simplifica somas, mas permite erros de sinal silenciosos e
  complica a divisão de despesas (maior resto com negativo).
- **Porcentagem como `number` decimal (33.33):** volta o problema de float.
