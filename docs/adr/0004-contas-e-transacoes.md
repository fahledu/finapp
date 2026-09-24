# 0004. Contas e transações

- Status: Aceito
- Data: 2026-09-24

## Contexto

Finanças pessoais giram em torno de contas e transações, e várias perguntas
ficavam em aberto:

- Como registrar o saldo de uma conta que já existe no banco, que pode ser
  negativo (cheque especial, fatura em aberto), se valores são sempre positivos
  com direção por `type` (ADR 0001)?
- Uma transferência mexe em duas contas: é uma linha ou duas, como fica a direção
  sem sinal, e o que fazer com moedas diferentes (sem câmbio na V1, ADR 0003)?
- Categorias são globais ou do usuário? O que acontece ao apagar uma em uso?
- O tipo da conta pode mudar depois de haver lançamentos?
- Como encerrar uma conta? Apagar conta com histórico (mesmo com soft delete)
  deixa saldo e relatórios inconsistentes; não poder encerrar conta alguma polui
  formulários para sempre.

## Decisão

**1. Tipo de conta**

- `account.kind`: `CHECKING`, `SAVINGS`, `CASH`, `CREDIT_CARD`. Os campos e
  regras próprios do cartão estão no ADR 0005.
- `kind` só muda enquanto nenhuma operação referencia a conta, **contando
  registros com soft delete**; senão `409 ACCOUNT_KIND_LOCKED`. Motivo: o mês de
  referência nos relatórios depende do tipo (ADR 0008), e trocá-lo moveria
  lançamentos antigos de mês. A moeda da conta tem trava equivalente
  (`409 CURRENCY_LOCKED`, ADR 0003).

**2. Saldo**

- Saldo da conta é sempre calculado pela soma das transações:
  `INCOME` + `TRANSFER IN` − `EXPENSE` − `TRANSFER OUT`. Cache de saldo só com
  medição que justifique.

**3. Saldo inicial**

- É uma transação comum (`INCOME` para positivo, `EXPENSE` para negativo) com
  `is_opening_balance = true`, na data de abertura informada, criada junto com a
  conta. Saldo zero não cria transação.
- Entra no saldo e fica fora de relatórios de receita/despesa e de orçamentos
  (ADR 0008).
- Uma por conta (índice único parcial `WHERE is_opening_balance AND deleted_at IS NULL`);
  editável como qualquer transação.

**4. Categorias**

- **Por usuário:** no cadastro, uma cópia da lista padrão (constante em
  `packages/shared`) é criada para o usuário. Assim a regra 5 (filtro pelo dono)
  vale sem exceção e cada um renomeia à vontade.
- `kind` (`INCOME`/`EXPENSE`); transação só usa categoria do mesmo tipo (`422`).
  Transferências não têm categoria.
- Até 2 níveis (`parent_id` opcional, sem pai do pai).
- Categoria em uso não é apagada: é **arquivada** (`archived_at`), some dos
  formulários e continua nos relatórios. Sem uso, pode ser apagada.
- Nome único por usuário entre as não arquivadas (sem distinguir maiúsculas).

**5. Transferências**

- Tabela `transfer`: `id`, `user_id`, `from_account_id`, `to_account_id`,
  `amount_cents`, `currency`, `date` (competência), `description`, `deleted_at`.
- Duas linhas em `transaction`, ambas `type = TRANSFER`, com `transfer_id` e
  `transfer_direction` (`OUT` na origem, `IN` no destino). A direção vem de um
  campo, nunca do sinal.
- Criação, edição e exclusão (soft) sempre alteram as três linhas juntas numa
  única transação de banco (ADR 0009), com um `audit_log` para o `transfer`
  (ADR 0010). As transações de transferência não podem ser editadas isoladamente
  (`409`).
- Transferências ficam **fora** de receitas, despesas e orçamentos (ADR 0008).
- Validações: as duas contas são do usuário (`404` se não forem), origem ≠ destino
  (`422`), moedas iguais nas duas contas e no valor (`422 CURRENCY_MISMATCH`).
- `Idempotency-Key` cobre a operação inteira (ADR 0009).
- Transferência entre moedas diferentes não existe na V1: o usuário lança uma
  despesa numa conta e uma receita na outra. A conversão gravada fica para o ADR
  de câmbio previsto no 0003.
- Pagamento de fatura de cartão é uma transferência (ADR 0005).

**6. Excluir ou arquivar conta**

- Conta que nunca teve transação (nem apagada), transferência, parcelamento ou
  vínculo com despesa ou acerto de grupo (`source_type`, ADR 0008) pode ser
  **excluída de verdade**, com registro no `audit_log` na mesma transação. Conta
  não está na lista da regra 6 do CLAUDE.md nem tem `deleted_at`.
- Conta com histórico só pode ser **arquivada** (`archived_at`), e só com saldo
  zero; senão `409 ACCOUNT_HAS_BALANCE` (o patrimônio não some da tela).
- Conta arquivada:
  - some dos formulários e da lista padrão (`GET /api/accounts?includeArchived=true`
    a inclui);
  - continua no extrato, no histórico e nos relatórios;
  - novo lançamento nela (transação, transferência de origem ou destino,
    parcelamento, vínculo de despesa ou acerto) → `409 ACCOUNT_ARCHIVED`;
  - editar ou excluir lançamento existente nela (inclusive transferência ou
    parcelamento que a envolva) também → `409 ACCOUNT_ARCHIVED`; é preciso
    desarquivar antes. Assim o saldo zero exigido no arquivamento se mantém;
  - pode ser desarquivada (`archived_at = NULL`).
- Cartão com parcelas futuras tem saldo diferente de zero e por isso não arquiva:
  comportamento esperado.

## Consequências

- Nenhum dado global compartilhado entre usuários; o seed cria categorias por
  usuário. Mudar a lista padrão não afeta quem já se cadastrou.
- Cada conta tem seu extrato completo, com a transferência visível; o saldo usa
  todas as linhas, e os relatórios excluem transferência e saldo inicial pela view
  do ADR 0008.
- A verificação de "tem histórico" (trava de `kind`, exclusão de conta) consulta
  tabelas com soft delete **sem** o filtro da extensão (ADR 0010); o repository
  precisa de consulta explícita para isso. As FKs `Restrict` (ADR 0012) já impedem
  a exclusão física se algo escapar.
- Conta nova com saldo inicial já tem transação, então só arquiva. Excluir de
  verdade serve para conta criada por engano e vazia.

## Alternativas consideradas

- **Coluna `opening_balance_cents` com sinal:** viola o ADR 0001.
- **Categorias globais + personalizadas:** exige `OR user_id IS NULL` em toda
  query, exceção à regra 5 e cuidado para ninguém editar a global.
- **Hierarquia de categorias ilimitada:** complica relatórios sem ganho real.
- **Transferência como uma linha com origem e destino:** o extrato de cada conta
  precisa de `OR` entre duas colunas e o cálculo de saldo fica especial.
- **Transferência como duas linhas `EXPENSE`/`INCOME`:** apareceria como gasto e
  renda nos relatórios.
- **Excluir conta com histórico via soft delete:** a conta some, mas saldo,
  transferências e relatórios ficam inconsistentes.
- **Arquivar com saldo diferente de zero:** patrimônio some da tela sem aviso.
