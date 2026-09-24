# 0028. Contas: moeda fixa, arquivamento e transações de relatório

- Status: Aceito
- Data: 2026-09-24
- Complementa: [0003](0003-moedas.md), [0021](0021-saldo-inicial-e-categorias.md)

## Contexto

O ADR 0003 dá moeda própria a conta, grupo e ativo, mas não diz se ela pode mudar
depois de haver lançamentos. Trocar `BRL` por `USD` numa conta com histórico faria
os mesmos centavos passarem a significar outro valor.

O ADR 0021 arquiva categoria em uso, mas não diz nada sobre a conta. Apagar conta
com histórico (mesmo com soft delete) deixa saldo e relatórios inconsistentes;
não poder encerrar conta alguma polui formulários para sempre.

Relatórios, dashboard e orçamentos precisam excluir várias coisas: transações
apagadas, transferências (ADR 0019), saldo inicial (ADR 0021) e acertos (ADR
0018), e o cartão conta pelo mês da fatura (ADR 0020). Repetir esses filtros em
cada consulta é garantia de que um deles vai ser esquecido.

## Decisão

**1. Moeda (e tipo de conta) fixos depois do primeiro lançamento.**

- `currency` de conta, grupo e ativo só pode mudar enquanto nenhuma operação a
  referencia, **contando registros com soft delete**.
- Depois disso, tentativa de troca → `409 CURRENCY_LOCKED`.
- `account.kind` segue a mesma trava: só muda enquanto nenhuma operação referencia
  a conta (contando soft delete); senão `409 ACCOUNT_KIND_LOCKED`. Motivo:
  `reference_month` (item 3) depende do tipo, e trocá-lo moveria lançamentos
  antigos de mês nos relatórios.

**2. Excluir ou arquivar conta.**

- Conta que nunca teve transação (nem apagada), transferência, parcelamento ou
  vínculo (`source_type`, ADR 0018) pode ser **excluída de verdade**, com registro
  no `audit_log` na mesma transação. Conta não está na lista da regra 6 do CLAUDE.md
  nem tem `deleted_at`.
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

**3. Uma definição única de "transação de relatório".**

- View SQL `reportable_transaction`, criada em migration `--create-only`, é a
  **única fonte** para relatórios, dashboard e orçamentos.
- Ela exclui:
  - `deleted_at IS NOT NULL`;
  - `type = 'TRANSFER'` (ADR 0019);
  - `is_opening_balance` (ADR 0021);
  - `source_type` de acerto (ADR 0018).
- Expõe `reference_month` (`"YYYY-MM"`): `statement_month` para transações de
  conta `CREDIT_CARD` (ADR 0020 e 0029), senão o mês de `date`.
- Agregações usam `$queryRaw` sobre a view, com o resultado validado por schema
  Zod e **sempre** com filtro `user_id` (regra 5). Somas vêm em `bigint` e passam
  pela conversão do repository (ADR 0001).
- Listagens (extrato) **não** usam a view: consultam `transaction` pelo Prisma,
  como de costume.

**Testes obrigatórios** (integração, Postgres real)

- Um caso por exclusão: transferência, saldo inicial, acerto e transação apagada
  não aparecem na view.
- `reference_month` do cartão: compra depois do fechamento cai no mês seguinte;
  transação de conta comum usa o mês de `date`.
- Consulta de agregação sem `user_id` não existe: teste com dois usuários
  confere que um não vê o total do outro.

## Consequências

- Trocar moeda por engano antes do primeiro lançamento continua fácil; depois,
  o caminho é criar outra conta.
- A verificação de "tem histórico" consulta tabelas com soft delete **sem** o
  filtro da extensão (ADR 0005); o repository precisa de consulta explícita para
  isso. As FKs `Restrict` (ADR 0010) já impedem a exclusão física se algo escapar.
- Conta nova com saldo inicial já tem transação, então só arquiva. Excluir de
  verdade serve para conta criada por engano e vazia.
- A view não está no `schema.prisma`. Mudar o que é "transação de relatório"
  exige nova migration com `CREATE OR REPLACE VIEW`. A view lista colunas
  explícitas (não `t.*`, que o Postgres congela na criação), e o Postgres impede
  `ALTER COLUMN ... TYPE` numa coluna usada por ela: a migration precisa recriar
  a view.
- Novos tipos de exclusão (ex.: estorno, importação em revisão) entram na view,
  não nas consultas.

## Alternativas consideradas

- **Moeda editável sempre:** reinterpreta valores históricos.
- **Excluir conta com histórico via soft delete:** a conta some, mas saldo,
  transferências e relatórios ficam inconsistentes.
- **Arquivar com saldo diferente de zero:** patrimônio some da tela sem aviso.
- **Helper de `where` do Prisma em vez de view:** não serve para `$queryRaw` de
  agregação; viraria duas definições que divergem.
- **Filtros repetidos em cada relatório:** fácil esquecer uma exclusão.
