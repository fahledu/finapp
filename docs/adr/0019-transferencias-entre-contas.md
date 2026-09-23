# 0019. Transferências entre contas

- Status: Proposto
- Data: 2026-09-23

## Contexto

O ADR 0001 prevê `type = TRANSFER` com valores sempre positivos, mas uma
transferência mexe em duas contas: sai de uma e entra em outra. Não está decidido
se é uma linha ou duas, como fica a direção sem usar sinal, nem o que fazer com
contas de moedas diferentes (sem câmbio na V1, ADR 0003).

## Decisão (recomendada)

- Tabela `transfer`: `id`, `user_id`, `from_account_id`, `to_account_id`,
  `amount_cents`, `currency`, `date` (competência), `description`, `deleted_at`.
- Duas linhas em `transaction`, ambas `type = TRANSFER`, com `transfer_id` e
  `transfer_direction` (`OUT` na origem, `IN` no destino). A direção continua
  vindo de um campo, nunca do sinal.
- Criação, edição e exclusão (soft) sempre alteram as três linhas juntas numa
  `$transaction`, com um `audit_log` para o `transfer`. As transações de
  transferência não podem ser editadas isoladamente (`409`).
- Saldo da conta = `INCOME` + `TRANSFER IN` − `EXPENSE` − `TRANSFER OUT`.
- Transferências ficam **fora** de receitas, despesas e orçamentos, e não têm categoria.
- Validações: as duas contas são do usuário (`404` se não forem), origem ≠ destino
  (`422`), moedas iguais nas duas contas e no valor (`422 CURRENCY_MISMATCH`).
- `Idempotency-Key` cobre a operação inteira (ADR 0006).
- Transferência entre moedas diferentes não existe na V1: o usuário lança uma
  despesa numa conta e uma receita na outra. A conversão gravada fica para o ADR
  de câmbio previsto no 0003.
- Pagamento de fatura de cartão é uma transferência (ADR 0020).

## Consequências

- Relatórios filtram `type <> 'TRANSFER'`; o saldo usa todas as linhas.
- Cada conta continua tendo seu extrato completo, com a transferência visível.

## Alternativas consideradas

- **Uma linha com origem e destino:** o extrato de cada conta precisa de `OR`
  entre duas colunas e o cálculo de saldo fica especial.
- **Duas linhas `EXPENSE`/`INCOME`:** transferência apareceria como gasto e renda
  nos relatórios.
