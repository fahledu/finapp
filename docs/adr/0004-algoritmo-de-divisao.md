# 0004. Algoritmo de divisão de gastos

- Status: Aceito (complementado por [0009](0009-partes-de-divisao-positivas.md))
- Data: 2026-09-23

## Contexto

A soma das partes precisa ser exatamente o total (CLAUDE.md, regra 3). Faltava
definir o desempate do maior resto, a ordem de implementação dos modos e as
validações de cada modo.

## Decisão

**Modos**, implementados nesta ordem, cada um em um plano próprio:
`EQUAL` → `EXACT` → `PERCENTAGE` → `SHARES`.

**Algoritmo único** para `EQUAL`, `PERCENTAGE` e `SHARES`, como função pura em
`packages/shared/src/split.ts`:

1. Cada participante `i` tem um peso inteiro `wᵢ > 0`: `1` em `EQUAL`, pontos-base
   em `PERCENTAGE` (ADR 0001), cotas em `SHARES`. `W = Σwᵢ`.
2. Parte base: `floor(total × wᵢ / W)`; resto: `(total × wᵢ) mod W`. Conta feita em
   `bigint` para não estourar o inteiro seguro.
3. Sobra `r = total − Σ partes base` (sempre `0 ≤ r < n`).
4. Os `r` participantes com **maior resto** recebem +1 centavo. Empate: **id do
   participante em ordem crescente** (comparação de string com `<`, sem locale).
   O participante é o membro do grupo (ADR 0008).

**Validações** (erro `422`)

- `total > 0`, pelo menos 1 participante, participantes sem repetição, `wᵢ > 0`.
- `EXACT`: as partes informadas somam exatamente o total → senão `SPLIT_SUM_MISMATCH`.
- `PERCENTAGE`: pontos-base somam `10000` → senão `SPLIT_PERCENTAGE_INVALID`.

**Propriedades testadas com fast-check**

- Soma das partes = total, para qualquer total e conjunto de pesos.
- Nenhuma parte difere da parte ideal (`total × wᵢ / W`) em 1 centavo ou mais.
- **Invariância à ordem de entrada:** embaralhar os participantes não muda a parte
  de ninguém.
- Determinismo: mesma entrada, mesma saída.

## Consequências

- O desempate por id é estável, mas não "intuitivo" para o usuário (quem fica com o
  centavo a mais não é quem foi adicionado primeiro). A interface mostra as partes
  calculadas antes de salvar.
- Os testes não devem depender da ordem de criação dos participantes.

## Alternativas consideradas

- **Desempate pela ordem de entrada:** o resultado mudaria se o cliente enviasse
  a lista em outra ordem; quebraria a invariância acima.
- **Desempate aleatório:** não determinístico; proibido pela regra 3.
