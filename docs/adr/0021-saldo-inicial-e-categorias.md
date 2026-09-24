# 0021. Saldo inicial de conta e categorias padrão

- Status: Aceito
- Data: 2026-09-23

## Contexto

Ao cadastrar uma conta que já existe no banco, o usuário precisa informar o saldo
atual, que pode ser negativo (cheque especial, fatura em aberto). Como valores são
sempre positivos com direção por `type` (ADR 0001), um campo de saldo com sinal
quebraria a regra. Também não está decidido se categorias são globais ou do
usuário, nem o que acontece ao apagar uma categoria em uso.

## Decisão

**Saldo inicial**

- É uma transação comum (`INCOME` para positivo, `EXPENSE` para negativo) com
  `is_opening_balance = true`, na data de abertura informada, criada junto com a
  conta. Saldo zero não cria transação.
- Fica fora de relatórios de receita/despesa e de orçamentos; entra no saldo.
- Uma por conta (índice único parcial `WHERE is_opening_balance AND deleted_at IS NULL`);
  editável como qualquer transação.
- Saldo da conta é sempre calculado pela soma das transações. Cache de saldo só
  com medição que justifique.

**Categorias**

- **Por usuário:** no cadastro, uma cópia da lista padrão (constante em
  `packages/shared`) é criada para o usuário. Assim a regra 5 (filtro pelo dono)
  vale sem exceção e cada um renomeia à vontade.
- `kind` (`INCOME`/`EXPENSE`); transação só usa categoria do mesmo tipo (`422`).
  Transferências não têm categoria.
- Até 2 níveis (`parent_id` opcional, sem pai do pai).
- Categoria em uso não é apagada: é **arquivada** (`archived_at`), some dos
  formulários e continua nos relatórios. Sem uso, pode ser apagada.
- Nome único por usuário entre as não arquivadas (sem distinguir maiúsculas).

## Consequências

- Nenhum dado global compartilhado entre usuários; o seed cria categorias por usuário.
- Mudar a lista padrão não afeta quem já se cadastrou.

## Alternativas consideradas

- **Coluna `opening_balance_cents` com sinal:** viola o ADR 0001.
- **Categorias globais + personalizadas:** exige `OR user_id IS NULL` em toda
  query, exceção à regra 5 e cuidado para ninguém editar a global.
- **Hierarquia ilimitada:** complica relatórios sem ganho real.
