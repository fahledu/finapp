# 0005. Cartão de crédito e compras parceladas

- Status: Aceito
- Data: 2026-09-24

## Contexto

No Brasil, boa parte dos gastos passa pelo cartão de crédito, muitos parcelados
("10x sem juros"). Sem regra, o cartão vira uma conta comum, a fatura não existe e
o parcelamento é lançado à mão, com erro de centavos (R$ 100 em 3x).

Também é preciso decidir como distribuir os centavos entre parcelas, a data de
competência de cada parcela, como filtrar o extrato por fatura e o que acontece
ao editar um plano com parcelas em faturas já fechadas.

## Decisão

**Conta de cartão**

- Conta com `kind = CREDIT_CARD` (ADR 0004), com `closing_day` e `due_day`
  (1 a 31; em meses mais curtos, vale o último dia) e limite opcional
  `credit_limit_cents`.
- Saldo do cartão negativo = dívida; a interface mostra "fatura atual", "próximas
  faturas" e "limite usado".

**Compras e fatura**

- Compra no cartão é uma transação `EXPENSE` na conta do cartão, com data de
  competência = data da compra.
- Cada transação do cartão grava `statement_month` (`"YYYY-MM"`), calculado na
  criação a partir da data e do `closing_day` vigente. Fica congelado: mudar o dia
  de fechamento depois não move compras antigas de fatura.
- A fatura é derivada (soma por `statement_month`), não uma tabela.
- Pagar a fatura é uma **transferência** da conta corrente para o cartão (ADR 0004).
- Em relatórios, dashboard e orçamentos, toda transação de cartão (à vista ou
  parcela) conta pelo `statement_month`; a regra está no ADR 0008.

**Extrato do cartão**

- Aceita o filtro `statementMonth=YYYY-MM`, além de `from`/`to` e `month`
  (ADR 0013). `statementMonth` junto com `from`/`to` ou `month` →
  `422 VALIDATION_ERROR`.

**Parcelamento**

- Tabela `installment_plan`: `total_cents`, `currency`, `count` (2 a 48),
  `first_statement_month`, `description`, `category_id`.
- Gera `count` transações com `installment_number` e `installment_plan_id`, uma
  por fatura consecutiva.
- Todas as parcelas guardam `date` = data da compra (competência da compra,
  verdade do extrato). A parcela `k` tem
  `statement_month = first_statement_month + (k − 1)` meses.
- Parcelas não são editadas isoladamente; excluir o plano faz soft delete de todas.

**`splitEvenly(total, n)`**

- Função pura em `packages/shared/src/money.ts`, separada do `split.ts` da divisão
  de grupo (ADR 0007), que desempata por id como string (`"10" < "2"`) e daria os
  centavos extras às parcelas erradas a partir da décima.
- Parte base `floor(total / n)`; os `total mod n` centavos que sobram vão para as
  **primeiras** parcelas (índice crescente), como no comércio. Sem ids.
- `total < n` → `422 INSTALLMENT_SHARE_ZERO`. Toda parcela tem ao menos 1 centavo
  (`CHECK (amount_cents > 0)` já garante no banco).
- Propriedades (fast-check): soma = total; diferença entre parcelas ≤ 1; sequência
  não crescente; determinismo.

**Editar o plano**

- **Fatura aberta atual** = o `statement_month` que uma compra feita hoje
  receberia: mesma função da criação, aplicada a `todayInSaoPaulo()` (ADR 0002) e
  ao `closing_day` vigente. **Fatura fechada** = `statement_month` anterior a ela.
- Parcelas de fatura fechada são imutáveis.
- Novo total e/ou nova quantidade recalculam só as abertas:
  `splitEvenly(novoTotal − somaFechadas, quantidadeAbertas)`.
- Validações:
  - `novoTotal − somaFechadas ≥ quantidadeAbertas`, senão
    `422 INSTALLMENT_TOTAL_TOO_LOW`;
  - nova quantidade > quantidade de parcelas fechadas e dentro de 2 a 48;
  - novo total ≤ `MAX_AMOUNT_CENTS` (ADR 0001).
- Parcelas abertas existentes são atualizadas; as que sobram viram soft delete;
  as que faltam são criadas, com `statement_month` seguindo a regra acima.
- Tudo numa única transação de banco (ADR 0009), com `audit_log` do plano (antes e
  depois, ADR 0010).

**Testes obrigatórios**

- Propriedades de `splitEvenly`; `total < n` rejeitado; `R$ 100,00` em 3x =
  `3334, 3333, 3333`.
- Edição com parcelas fechadas preserva as fechadas e mantém soma = novo total.
- Redução de quantidade faz soft delete das sobras.
- `INSTALLMENT_TOTAL_TOO_LOW` no limite (igual passa, um centavo a menos falha).

## Consequências

- Entra no roadmap antes do "Dashboard" (itens 4 e 5 do GUIA) para os números
  fazerem sentido para quem usa cartão, ou é explicitamente adiado.
- `split.ts` e `splitEvenly` evoluem separados. Com `total ≤ MAX_AMOUNT_CENTS` e
  `n ≤ 48`, `splitEvenly` trabalha com `number` sem risco de estouro; não precisa
  de `bigint`.
- Como todas as parcelas têm a data da compra, o saldo do cartão assume a dívida
  inteira no dia da compra, e o extrato filtrado por `from`/`to` mostra todas as
  parcelas juntas. Para ver a fatura, a interface usa `statementMonth`.
- Plano com todas as parcelas em faturas fechadas não admite mudança de total nem
  de quantidade (nenhuma parcela aberta sobra para absorver a diferença). Descrição
  e categoria continuam editáveis; o plano da feature decide o erro (`409`).
- "Fatura aberta" usa o `closing_day` vigente, enquanto o `statement_month` das
  parcelas foi congelado com o antigo. Se o dia de fechamento mudar, a fronteira
  entre aberta e fechada segue o dia novo; é o comportamento esperado.
- Juros de parcelamento e estorno de compra ficam fora (estorno já está fora da
  V1, ADR 0001).

## Alternativas consideradas

- **Cartão como conta comum:** sem fatura, sem vencimento; o dashboard mostra a
  compra no mês errado para quem controla pela fatura.
- **Tabela `statement` materializada:** mais rígida; só vale se houver fechamento
  manual com ajustes.
- **Centavos extras na última parcela:** também é comum; escolher um e manter.
- **Reusar `split.ts` com o número da parcela, com zeros à esquerda, como id:**
  gambiarra que acopla a divisão de grupo ao parcelamento.
- **Parcela com `date` = compra + (k − 1) meses:** a data deixa de ser a verdade
  da compra e não bate com a fatura quando a compra é depois do fechamento.
- **Recalcular também as faturas fechadas:** altera fatura que já pode ter sido
  paga.
