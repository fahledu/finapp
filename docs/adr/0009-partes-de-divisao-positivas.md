# 0009. Partes de divisão sempre positivas

- Status: Aceito
- Data: 2026-09-23
- Complementa: [0004](0004-algoritmo-de-divisao.md)

## Contexto

O ADR 0001 exige `amount_cents > 0` em todo valor de operação. O algoritmo do ADR
0004 pode gerar parte **zero**: R$ 0,02 em `EQUAL` entre 3 membros dá 1 + 1 + 0
centavos; em `PERCENTAGE`, 1 ponto-base de R$ 1,00 dá 0,01 centavo, arredondado
para 0. Se `expense_share` tiver o `CHECK` do ADR 0001, o insert falha com erro
de banco (500); se não tiver, surge um "participante" que não deve nada, o que
polui saldos e simplificação de dívidas.

## Decisão

- **Toda parte de despesa é `> 0`.** `expense_share.amount_cents` tem
  `CHECK (amount_cents > 0)`, como qualquer valor de operação.
- `EQUAL`, `PERCENTAGE` e `SHARES`: se o algoritmo produzir alguma parte zero, a
  API responde `422 SPLIT_SHARE_ZERO`, com `details.memberIds` listando os membros
  afetados. Nada é gravado. Caso típico: total menor que o número de participantes.
- `EXACT`: cada parte informada deve ser `> 0`; quem não participa é omitido da
  lista, nunca enviado com zero (`422 VALIDATION_ERROR`).
- `split.ts` continua puro e total (devolve as partes calculadas, inclusive
  zeros); a verificação fica numa função de validação de `packages/shared`, usada
  pelo service e pela pré-visualização do formulário. Assim o usuário vê o
  problema antes de enviar.

## Consequências

- O `CHECK` do banco vira a última defesa; o erro normal é o `422` do service.
- Propriedades do ADR 0004 continuam válidas para `split.ts`. Novo teste: para
  `total < n` em `EQUAL`, a validação sempre rejeita; para `total >= n`, nunca.
- Casos de teste obrigatórios: R$ 0,02 entre 3 (rejeita), R$ 0,03 entre 3
  (1 + 1 + 1), `PERCENTAGE` com 1 ponto-base em total pequeno (rejeita).

## Alternativas consideradas

- **Permitir parte zero (`CHECK >= 0`):** membro "participa" sem dever nada;
  confuso na interface e cria linhas inúteis no saldo.
- **Remover silenciosamente quem ficou com zero:** a lista de participantes
  mudaria sem o usuário pedir.
- **Dar o centavo a quem ficou com zero:** quebra a proporcionalidade e o
  desempate determinístico do ADR 0004.
