# 0004. Despesas de grupo: divisão, pagadores e saldos

- Status: Aceito
- Data: 2026-09-23

## Contexto

A soma das partes precisa ser exatamente o total (CLAUDE.md, regra 3). Faltava
definir o desempate do maior resto, a ordem de implementação dos modos, as
validações de cada modo e o que fazer quando o arredondamento gera parte **zero**
(R$ 0,02 em `EQUAL` entre 3 dá 1 + 1 + 0; 1 ponto-base de R$ 1,00 dá 0). Parte
zero com o `CHECK (amount_cents > 0)` do ADR 0001 vira erro de banco (500); sem o
`CHECK`, surge um "participante" que não deve nada.

No uso real, uma conta também pode ser paga por mais de uma pessoa ("eu passei
R$ 200 no cartão, ela R$ 100 no pix"). Se o schema nascer com uma coluna de
pagador, suportar vários depois exige migration de dados e reescrita dos saldos.

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
   O participante é o membro do grupo (`group_member.id`, ADR 0008).

**Partes sempre positivas**

- `expense_share.amount_cents` tem `CHECK (amount_cents > 0)`.
- `split.ts` continua puro e total (devolve as partes calculadas, inclusive
  zeros). A verificação fica numa função de validação de `packages/shared`, usada
  pelo service e pela pré-visualização do formulário, para o usuário ver o
  problema antes de enviar.
- `EQUAL`, `PERCENTAGE` e `SHARES`: alguma parte zero → `422 SPLIT_SHARE_ZERO`,
  com `details.memberIds` listando os membros afetados. Nada é gravado. Caso
  típico: total menor que o número de participantes.
- `EXACT`: cada parte informada deve ser `> 0`; quem não participa é omitido da
  lista, nunca enviado com zero (`422 VALIDATION_ERROR`).

**Pagadores**

- Pagamentos em tabela própria desde a primeira migration de despesas:
  `expense_payment` (`id`, `expense_id`, `member_id` → `group_member.id`,
  `amount_cents > 0`, `deleted_at`). **Sem** coluna de pagador em `expense`.
- Soma dos pagamentos = total da despesa, senão `422 SPLIT_PAYMENT_SUM_MISMATCH`.
  Pagador sem repetição.
- **V1 da interface e da API aceita só um pagador** (lista com um item). Liberar
  vários é só mudar a validação e a tela.
- Editar ou excluir a despesa altera pagamentos e partes juntos, na mesma
  transação e no mesmo `audit_log`.

**Saldo de cada membro no grupo** = Σ pagou − Σ partes + Σ acertos recebidos −
Σ acertos pagos. Função pura; a simplificação de dívidas trabalha só com esses saldos.

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
- `EQUAL` com `total < n`: a validação sempre rejeita; com `total >= n`, nunca.
- Soma dos saldos do grupo = 0.

Casos fixos obrigatórios: R$ 0,02 entre 3 (rejeita), R$ 0,03 entre 3
(1 + 1 + 1), `PERCENTAGE` com 1 ponto-base em total pequeno (rejeita).

## Consequências

- O desempate por id é estável, mas não "intuitivo" para o usuário (quem fica com o
  centavo a mais não é quem foi adicionado primeiro). A interface mostra as partes
  calculadas antes de salvar.
- Os testes não devem depender da ordem de criação dos participantes.
- O `CHECK` do banco é a última defesa; o erro normal é o `422` do service.
- Múltiplos pagadores custam agora uma tabela e um join, e evitam migration de dados depois.

## Alternativas consideradas

- **Desempate pela ordem de entrada:** o resultado mudaria se o cliente enviasse
  a lista em outra ordem; quebraria a invariância acima.
- **Desempate aleatório:** não determinístico; proibido pela regra 3.
- **Permitir parte zero (`CHECK >= 0`):** membro "participa" sem dever nada;
  confuso na interface e cria linhas inúteis no saldo.
- **Remover silenciosamente quem ficou com zero:** a lista de participantes
  mudaria sem o usuário pedir.
- **Dar o centavo a quem ficou com zero:** quebra a proporcionalidade e o
  desempate determinístico.
- **Coluna `payer_member_id` agora e tabela depois:** migration com movimentação de
  dados em produção e dois formatos de API.
- **Registrar o segundo pagador como acerto:** distorce o histórico ("acerto" que
  na verdade foi pagamento da conta).
