# 0007. Despesas de grupo: divisão, pagadores, acertos e saldos

- Status: Aceito
- Data: 2026-09-24

## Contexto

A soma das partes precisa ser exatamente o total (CLAUDE.md, regra 3). É preciso
definir o desempate do maior resto, a ordem de implementação dos modos, as
validações de cada modo e o que fazer quando o arredondamento gera parte **zero**
(R$ 0,02 em `EQUAL` entre 3 dá 1 + 1 + 0; 1 ponto-base de R$ 1,00 dá 0). Parte
zero com o `CHECK (amount_cents > 0)` do ADR [0001](0001-dinheiro-decimais-e-limites.md)
vira erro de banco (500); sem o `CHECK`, surge um "participante" que não deve nada.

No uso real, uma conta também pode ser paga por mais de uma pessoa ("eu passei
R$ 200 no cartão, ela R$ 100 no pix"). Se o schema nascer com uma coluna de
pagador, suportar vários depois exige migration de dados e reescrita dos saldos.

Falta ainda o fechamento do ciclo: como se registra um acerto (parcial, acima da
dívida, com membro sem conta, quem registra) e como sugerir quem paga a quem com
poucas transferências.

## Decisão

**Modos**, implementados nesta ordem, cada um em um plano próprio:
`EQUAL` → `EXACT` → `PERCENTAGE` → `SHARES`. Despesas usam a moeda do grupo (ADR
[0003](0003-moedas.md)).

**Algoritmo único** para `EQUAL`, `PERCENTAGE` e `SHARES`, como função pura em
`packages/shared/src/split.ts`:

1. Cada participante `i` tem um peso inteiro `wᵢ > 0`: `1` em `EQUAL`, pontos-base
   em `PERCENTAGE` (ADR 0001), cotas em `SHARES`. `W = Σwᵢ`.
2. Parte base: `floor(total × wᵢ / W)`; resto: `(total × wᵢ) mod W`. Conta feita em
   `bigint` para não estourar o inteiro seguro.
3. Sobra `r = total − Σ partes base` (sempre `0 ≤ r < n`).
4. Os `r` participantes com **maior resto** recebem +1 centavo. Empate: **id do
   participante em ordem crescente** (comparação de string com `<`, sem locale).
   O participante é o membro do grupo (`group_member.id`, ADR
   [0006](0006-grupos-membros-e-convites.md)).

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

**Validações da despesa** (erro `422`)

- `total > 0`, pelo menos 1 participante, participantes sem repetição, `wᵢ > 0`.
- `EXACT`: as partes informadas somam exatamente o total → senão `SPLIT_SUM_MISMATCH`.
- `PERCENTAGE`: pontos-base somam `10000` → senão `SPLIT_PERCENTAGE_INVALID`.

Criar, editar ou excluir despesa que envolva membro `LEFT` → `409
MEMBER_NOT_ACTIVE` (ADR 0006).

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

**Acerto:** tabela `settlement`: `id`, `group_id`, `from_member_id` e
`to_member_id` (→ `group_member.id`), `amount_cents` (`CHECK > 0`), `currency`
(= moeda do grupo, senão `422 CURRENCY_MISMATCH`, ADR 0003), `date` (competência,
`DATE`, ADR [0002](0002-datas-e-fusos.md)), `note`, `created_by_user_id`,
`created_at`, `updated_at`, `deleted_at`.

- `from_member_id ≠ to_member_id`, senão `422 VALIDATION_ERROR`. Os dois são
  membros do mesmo grupo; envolver membro `LEFT` → `409 MEMBER_NOT_ACTIVE` (ADR 0006).
- Qualquer membro ativo registra, edita e exclui (soft) qualquer acerto do grupo,
  com `audit_log`, como nas despesas (ADR 0006). Membros sem conta podem ser
  origem ou destino.
- Valor: qualquer inteiro de `1` a `MAX_AMOUNT_CENTS` (ADR 0001). Acerto parcial
  é normal. Acerto acima da dívida é permitido e inverte o saldo; a interface
  sugere o valor exato e avisa quando o valor passa da dívida.
- Criação de despesa e de acerto aceita `Idempotency-Key` (regra 7, ADR
  [0009](0009-escrita-transacao-idempotencia-e-outbox.md)).
- O vínculo opcional com transação pessoal, para despesa e acerto, segue o ADR
  [0008](0008-relatorios-e-grupos-nas-financas-pessoais.md).

**Saldo de cada membro no grupo** = Σ pagou − Σ partes + Σ acertos recebidos −
Σ acertos pagos (só registros não apagados). Função pura; a simplificação de
dívidas trabalha só com esses saldos.

**Simplificação de dívidas**

- Calculada na leitura, em `GET /api/groups/:groupId/settle-up`, e **nunca
  gravada**.
- Função pura em `packages/shared/src/settle.ts`, que recebe os saldos e ignora os
  zerados. A cada passo, o maior devedor paga ao maior credor
  `min(|dívida|, crédito)`. Empate: `group_member.id` crescente (comparação de
  string com `<`, sem locale, como na divisão).
- Com `n` membros de saldo não zero, gera no máximo `n − 1` transferências. Não
  garante o mínimo absoluto (problema NP-difícil); é aceitável.
- As sugestões só preenchem o formulário de acerto; nada é registrado
  automaticamente.

**Propriedades testadas com fast-check**

- Divisão: soma das partes = total, para qualquer total e conjunto de pesos;
  nenhuma parte difere da parte ideal (`total × wᵢ / W`) em 1 centavo ou mais;
  **invariância à ordem de entrada** (embaralhar os participantes não muda a parte
  de ninguém); determinismo; `EQUAL` com `total < n`: a validação sempre rejeita,
  com `total >= n`, nunca.
- Saldos: soma dos saldos do grupo = 0.
- Simplificação: aplicar as sugestões zera todos os saldos; no máximo `n − 1`
  transferências; nenhuma de valor zero; determinismo; invariância à ordem de
  entrada.

Casos fixos obrigatórios: R$ 0,02 entre 3 (rejeita), R$ 0,03 entre 3
(1 + 1 + 1), `PERCENTAGE` com 1 ponto-base em total pequeno (rejeita).

## Consequências

- O desempate por id é estável, mas não "intuitivo" para o usuário (quem fica com o
  centavo a mais não é quem foi adicionado primeiro). A interface mostra as partes
  calculadas antes de salvar.
- Os testes não devem depender da ordem de criação dos participantes.
- O `CHECK` do banco é a última defesa; o erro normal é o `422` do service.
- Múltiplos pagadores custam agora uma tabela e um join, e evitam migration de dados depois.
- `split.ts` serve só à divisão de grupo; parcelas de cartão usam `splitEvenly`
  (ADR [0005](0005-cartao-e-parcelamento.md)), que não depende de ids.
- `settlement` entra na lista de modelos com soft delete e ganha o trigger na
  mesma migration (ADR [0010](0010-soft-delete-auditoria-e-garantias-no-banco.md)).
  A lista de acertos segue a paginação por cursor (ADR
  [0013](0013-convencoes-de-api.md)), ordenada por `(date, id)` decrescente, com
  índice `(group_id, date, id)`.
- Quem registra um acerto entre outros dois membros não cria transação pessoal
  para ninguém (ADR 0008).

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
- **Acerto só pelo valor exato da dívida:** bloqueia pagamento parcial, comum na
  prática.
- **Gravar a simplificação:** fica desatualizada a cada despesa ou acerto.
- **Algoritmo de mínimo exato:** exponencial, sem ganho perceptível em grupos
  pequenos.
