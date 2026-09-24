# 0024. Limites de valores monetários e decimais

- Status: Aceito
- Data: 2026-09-24
- Complementa: [0001](0001-representacao-de-dinheiro.md)

## Contexto

O ADR 0001 limita `amountCents` só pelo inteiro seguro (~9 × 10¹⁵ centavos).
Cada operação isolada cabe, mas somas de valores enormes (saldo, relatório)
estouram na conversão `bigint` → `number` do repository e viram 500.

O `decimalStringSchema` (regex `^\d+(\.\d{1,8})?$`) aceita qualquer quantidade de
dígitos inteiros, mas `NUMERIC(20,8)` só comporta 12. O excesso é recusado pelo
banco, também como 500.

Além disso, valor absurdo quase sempre é erro de digitação (zeros a mais, número
de conta colado no campo), e hoje seria gravado sem aviso.

## Decisão

**Valores monetários**

- `MAX_AMOUNT_CENTS = 10_000_000_000` (10¹⁰ centavos, R$ 100 milhões) por
  operação, constante exportada de `packages/shared/src/money.ts`. A mesma
  constante vale para `BRL`, `USD` e `EUR` (todas com 2 casas, ADR 0003).
- `moneySchema`: `amountCents` inteiro com `1 ≤ amountCents ≤ MAX_AMOUNT_CENTS`.
  Fora disso → `422 VALIDATION_ERROR`, mensagem "Valor máximo por lançamento:
  R$ 100.000.000,00", formatada com `Intl` em `pt-BR` na moeda da operação.
- O frontend usa a mesma constante no parse de `"1.234,56"` e mostra o erro no
  campo antes de enviar.
- Banco: continua só `CHECK (amount_cents > 0)`, **sem teto**. Subir o limite é
  mudar a constante, sem migration.
- A conversão no repository continua lançando erro se o valor não for inteiro
  seguro (ADR 0001), como última defesa. Com o teto, estourar uma soma exigiria
  ~900 mil lançamentos no valor máximo.

**Decimais** (quantidade e preço unitário, `NUMERIC(20,8)`)

- `decimalStringSchema` passa a ser `^(0|[1-9]\d{0,11})(\.\d{1,8})?$`: até 12
  dígitos inteiros, até 8 decimais, sem zeros à esquerda.
- Quantidade e preço exigem `> 0` via `.refine` com `decimal.js` (a regex aceita
  `"0"` e `"0.00"`).
- O valor derivado (quantidade × preço, convertido para centavos com
  `ROUND_HALF_UP` conforme ADR 0001) também precisa ser `≤ MAX_AMOUNT_CENTS`,
  senão `422 VALIDATION_ERROR`.

**Testes obrigatórios**

- `amountCents`: `0` (rejeita), `1` (aceita), `MAX_AMOUNT_CENTS` (aceita),
  `MAX_AMOUNT_CENTS + 1` (rejeita).
- Regex: 12 dígitos inteiros (aceita) e 13 (rejeita); 8 decimais (aceita) e 9
  (rejeita); zeros à esquerda como `"01"` (rejeita); `"0"` passa na regex e é
  rejeitado pelo `.refine` de quantidade e preço.
- Valor derivado acima do teto (rejeita).

## Consequências

- Somas e decimais longos deixam de gerar 500; o erro vira `422` na borda, com
  mensagem clara, e o frontend avisa antes de enviar.
- Lançamentos acima de R$ 100 milhões não são aceitos. Se surgir caso real, subir
  a constante basta (sem migration), desde que a margem das somas continue folgada.
- A verificação do valor derivado precisa ser feita em `Decimal`, **antes** da
  conversão para `number`: quantidade × preço pode chegar a ~10²⁴, muito acima do
  inteiro seguro.
- Mesmo com quantidade e preço `> 0`, o valor derivado pode arredondar para
  **0 centavo** (ex.: `"0.00000001"` × `"1"`). Este ADR não decide esse caso;
  fica para o ADR de investimentos (roadmap 10), que deve dizer se rejeita ou
  aceita posição com valor derivado zero.
- Partes de divisão (ADR 0004) e parcelas (ADR 0020) são menores ou iguais ao
  total, então herdam o teto sem validação extra.

## Alternativas consideradas

- **Teto de R$ 10 milhões:** pega mais erro de digitação, mas trava registro de
  compra de imóvel caro.
- **Teto de R$ 1 bilhão:** funciona matematicamente, mas aceita erro de digitação
  sem ganho real.
- **Teto também em `CHECK` no banco:** cada ajuste exigiria migration; o papel do
  banco é barrar zero e negativo, não valor grande.
- **Sem teto:** mantém os 500 em somas e em decimais longos.
