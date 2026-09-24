# 0029. Parcelas, mês de referência e edição de parcelamento

- Status: Aceito
- Data: 2026-09-24
- Complementa: [0020](0020-cartao-de-credito-e-parcelamento.md)

## Contexto

O ADR 0020 manda calcular as parcelas "pelo mesmo cálculo do ADR 0004", com
desempate por `installment_number` crescente. Mas o `split.ts` do ADR 0004
desempata pelo id como **string** (`"10" < "2"`), então reusá-lo daria os
centavos extras às parcelas erradas a partir da décima.

Também faltava decidir:

- a data de competência de cada parcela;
- em que mês uma compra **à vista** no cartão conta nos relatórios;
- o que acontece quando a edição do plano deixaria parcela zero ou negativa.

## Decisão

**1. `splitEvenly(total, n)`**, função pura em `packages/shared/src/money.ts`,
separada do `split.ts`.

- Parte base `floor(total / n)`; os `total mod n` centavos que sobram vão para as
  **primeiras** parcelas (índice crescente). Sem ids.
- `total < n` → `422 INSTALLMENT_SHARE_ZERO`. Toda parcela tem ao menos 1 centavo
  (`CHECK (amount_cents > 0)` já garante no banco).
- Propriedades (fast-check): soma = total; diferença entre parcelas ≤ 1; sequência
  não crescente; determinismo.

**2. Data das parcelas.** Todas guardam `date` = data da compra (competência da
compra, verdade do extrato). A parcela `k` tem
`statement_month = first_statement_month + (k − 1)` meses.

**3. Mês de referência.** Toda transação de conta `CREDIT_CARD` (à vista ou
parcela) conta em relatórios, dashboard e orçamentos pelo `statement_month`; as
demais, pelo mês de `date`. Implementado pela coluna `reference_month` da view
`reportable_transaction` (ADR 0028). Estende à compra à vista o que o ADR 0020 já
diz para parcelas, para a conta ter um critério só.

**4. Extrato do cartão** aceita o filtro `statementMonth=YYYY-MM`, além de
`from`/`to` e `month` (ADR 0026). `statementMonth` junto com `from`/`to` ou
`month` → `422 VALIDATION_ERROR`.

**5. Editar o plano**

- **Fatura aberta atual** = o `statement_month` que uma compra feita hoje
  receberia: mesma função da criação, aplicada a `todayInSaoPaulo()` e ao
  `closing_day` vigente. **Fatura fechada** = `statement_month` anterior a ela.
- Parcelas de fatura fechada são imutáveis.
- Novo total e/ou nova quantidade recalculam só as abertas:
  `splitEvenly(novoTotal − somaFechadas, quantidadeAbertas)`.
- Validações:
  - `novoTotal − somaFechadas ≥ quantidadeAbertas`, senão
    `422 INSTALLMENT_TOTAL_TOO_LOW`;
  - nova quantidade > quantidade de parcelas fechadas e dentro de 2 a 48 (ADR 0020);
  - novo total ≤ `MAX_AMOUNT_CENTS` (ADR 0024).
- Parcelas abertas existentes são atualizadas; as que sobram viram soft delete;
  as que faltam são criadas, com `statement_month` seguindo a regra do item 2.
- Tudo numa transação (ADR 0025), com `audit_log` do plano (antes e depois).

## Consequências

- O resultado é o que o ADR 0020 queria (centavos extras nas primeiras parcelas),
  sem depender do formato do id. `split.ts` e `splitEvenly` evoluem separados.
- Com `total ≤ MAX_AMOUNT_CENTS` e `n ≤ 48`, `splitEvenly` trabalha com `number`
  sem risco de estouro; não precisa de `bigint`.
- Como todas as parcelas têm a data da compra, o saldo do cartão assume a dívida
  inteira no dia da compra, e o extrato filtrado por `from`/`to` mostra todas as
  parcelas juntas. Para ver a fatura, a interface usa `statementMonth`.
- Plano com todas as parcelas em faturas fechadas não admite mudança de total nem
  de quantidade (nenhuma parcela aberta sobra para absorver a diferença). Descrição
  e categoria continuam editáveis; o plano da feature decide o erro (`409`).
- "Fatura aberta" usa o `closing_day` vigente, enquanto o `statement_month` das
  parcelas foi congelado com o antigo (ADR 0020). Se o dia de fechamento mudar, a
  fronteira entre aberta e fechada segue o dia novo; é o comportamento esperado.
- Testes obrigatórios: propriedades de `splitEvenly`; `total < n` rejeitado;
  `R$ 100,00` em 3x = `3334, 3333, 3333`; edição com parcelas fechadas preserva as
  fechadas e mantém soma = novo total; redução de quantidade faz soft delete das
  sobras; `INSTALLMENT_TOTAL_TOO_LOW` no limite (igual passa, um centavo a menos
  falha).

## Alternativas consideradas

- **Reusar `split.ts` com o número da parcela, com zeros à esquerda, como id:**
  gambiarra que acopla a divisão de grupo ao parcelamento.
- **Parcela com `date` = compra + (k − 1) meses:** a data deixa de ser a verdade
  da compra e não bate com a fatura quando a compra é depois do fechamento.
- **Compra à vista no cartão pelo mês da data e parcela pelo mês da fatura:** dois
  critérios na mesma conta.
- **Recalcular também as faturas fechadas:** altera fatura que já pode ter sido
  paga.
