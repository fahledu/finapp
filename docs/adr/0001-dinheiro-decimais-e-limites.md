# 0001. Dinheiro, decimais e limites de valores

- Status: Aceito
- Data: 2026-09-24

## Contexto

Dinheiro não pode ser float, mas "centavos inteiros" deixa perguntas em aberto:
`bigint` ou `number` no código? Como trafegar no JSON (`JSON.stringify` lança
erro com `bigint`)? Como representar `Prisma.Decimal` no frontend, onde ele não
existe? Qual o sinal de uma despesa? Como guardar porcentagens de divisão?

Também faltava limite. Cada operação isolada cabe no inteiro seguro (~9 × 10¹⁵
centavos), mas somas de valores enormes (saldo, relatório) estourariam na
conversão `bigint` → `number` e virariam 500. Decimais com dígitos inteiros
demais seriam recusados pelo `NUMERIC(20,8)`, também como 500. E valor absurdo
quase sempre é erro de digitação (zeros a mais, número de conta colado no campo).

## Decisão

**Valores monetários**

- Banco: `amount_cents BIGINT` + `currency CHAR(3)` (`BigInt` / `@db.Char(3)` no
  Prisma), com `CHECK (amount_cents > 0)`.
- Código (shared, api, web): `number` inteiro. Todo valor passa por
  `Number.isSafeInteger`.
- A conversão `bigint` ↔ `number` acontece **só no repository**. Se um valor do
  banco não for inteiro seguro, lançar erro (nunca truncar). É a última defesa.
- JSON: `{ "amountCents": 12345, "currency": "BRL" }`, validado pelo
  `moneySchema` de `packages/shared`.

**Limite por operação**

- `MAX_AMOUNT_CENTS = 10_000_000_000` (10¹⁰ centavos, R$ 100 milhões), constante
  exportada de `packages/shared/src/money.ts`. Vale para todas as moedas aceitas,
  todas com 2 casas (ADR 0003).
- `moneySchema`: `amountCents` inteiro com `1 ≤ amountCents ≤ MAX_AMOUNT_CENTS`.
  Fora disso → `422 VALIDATION_ERROR`, mensagem "Valor máximo por lançamento:
  R$ 100.000.000,00", formatada com `Intl` em `pt-BR` na moeda da operação.
- O frontend usa a mesma constante no parse de `"1.234,56"` e mostra o erro no
  campo antes de enviar.
- O banco só barra zero e negativo, **sem teto**: subir o limite é mudar a
  constante, sem migration. Com o teto, estourar uma soma exigiria ~900 mil
  lançamentos no valor máximo.

**Sinal**

- Valores de operação são sempre positivos. A direção vem de um campo de tipo:
  transação tem `type` (`INCOME`, `EXPENSE`, `TRANSFER`); despesa de grupo é
  sempre um gasto. Estornos são uma operação própria, fora da V1.
- Saldos calculados (conta, balanço entre membros) podem ser negativos, mas não
  são armazenados como valor de operação.

**Quantidades e preços unitários de investimento** (exceção à regra de centavos)

- Banco: `NUMERIC(20,8)` (`Decimal @db.Decimal(20, 8)`).
- API: `Prisma.Decimal` (decimal.js) em toda conta.
- JSON: **string** decimal com ponto (`"12.5"`, `"0.00012345"`), validada por
  `decimalStringSchema` com regex `^(0|[1-9]\d{0,11})(\.\d{1,8})?$`: até 12
  dígitos inteiros (o que cabe no `NUMERIC(20,8)`), até 8 decimais, sem zeros à
  esquerda.
- Quantidade e preço exigem `> 0` via `.refine` com `decimal.js` (a regex aceita
  `"0"` e `"0.00"`).
- Web: exibe a string formatada; se precisar calcular, usa `decimal.js`, nunca
  `Number()`.
- Valor financeiro derivado (quantidade × preço) vira centavos **uma única vez**,
  no fim do cálculo, com `ROUND_HALF_UP`. Ele também precisa ser
  `≤ MAX_AMOUNT_CENTS`, senão `422 VALIDATION_ERROR`; a verificação é feita em
  `Decimal`, **antes** da conversão para `number` (quantidade × preço pode chegar
  a ~10²⁴).
- Taxas e corretagem são valores próprios em centavos, nunca embutidos no preço.

**Porcentagens**

- Pontos-base inteiros: `10000` = 100%, `3333` = 33,33%.

**Testes obrigatórios**

- `amountCents`: `0` (rejeita), `1` (aceita), `MAX_AMOUNT_CENTS` (aceita),
  `MAX_AMOUNT_CENTS + 1` (rejeita).
- Regex: 12 dígitos inteiros (aceita) e 13 (rejeita); 8 decimais (aceita) e 9
  (rejeita); zeros à esquerda como `"01"` (rejeita); `"0"` passa na regex e é
  rejeitado pelo `.refine` de quantidade e preço.
- Valor derivado acima do teto (rejeita).

## Consequências

- Zod, Recharts e `Intl.NumberFormat` funcionam direto com `number`.
- Toda leitura/escrita de dinheiro no repository precisa converter; helpers em
  `packages/shared/src/money.ts` (`toCents`, `fromDbCents`) evitam repetição.
- Operações que multiplicam valores grandes (ex.: `total × pesos` na divisão) usam
  `bigint` internamente para não estourar o inteiro seguro (ADR 0007).
- Somas e decimais longos não geram 500: o erro vira `422` na borda, com mensagem
  clara, e o frontend avisa antes de enviar.
- Lançamentos acima de R$ 100 milhões não são aceitos. Se surgir caso real, subir
  a constante basta, desde que a margem das somas continue folgada.
- Partes de divisão (ADR 0007) e parcelas (ADR 0005) são menores ou iguais ao
  total, então herdam o teto sem validação extra.
- **Pendência:** mesmo com quantidade e preço `> 0`, o valor derivado pode
  arredondar para **0 centavo** (ex.: `"0.00000001"` × `"1"`). Este ADR não
  decide esse caso; fica para o ADR de investimentos (roadmap 10), que deve dizer
  se rejeita ou aceita posição com valor derivado zero.

## Alternativas consideradas

- **`bigint` de ponta a ponta:** exige serializador customizado no Fastify, string
  no JSON e conversão no frontend para exibir e plotar. Custo alto sem ganho real
  dado o limite acima.
- **Valor com sinal:** simplifica somas, mas permite erros de sinal silenciosos e
  complica a divisão de despesas (maior resto com negativo).
- **Porcentagem como `number` decimal (33.33):** volta o problema de float.
- **Teto de R$ 10 milhões:** pega mais erro de digitação, mas trava registro de
  compra de imóvel caro.
- **Teto de R$ 1 bilhão:** funciona matematicamente, mas aceita erro de digitação
  sem ganho real.
- **Teto também em `CHECK` no banco:** cada ajuste exigiria migration; o papel do
  banco é barrar zero e negativo, não valor grande.
- **Sem teto:** mantém os 500 em somas e em decimais longos.
