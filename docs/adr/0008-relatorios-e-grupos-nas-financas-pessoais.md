# 0008. Relatórios e grupos nas finanças pessoais

- Status: Aceito
- Data: 2026-09-24

## Contexto

O FinApp tem dois domínios de dinheiro: finanças pessoais (contas, transações,
orçamentos) e divisão de gastos (grupos, despesas, acertos). É preciso decidir
como eles se relacionam:

- Se eu pago R$ 300 de um jantar dividido por 3, saíram R$ 300 da minha conta, mas
  meu gasto real é R$ 100 e tenho R$ 200 a receber. Os outros dois gastaram R$ 100
  cada sem nenhuma transação na conta deles até o acerto.
- O relatório de "Alimentação" deve contar R$ 300, R$ 100 ou nada? E o de quem
  deve?
- Quando alguém me paga o acerto, isso é receita?

Contar o valor pago dá o total certo e o gasto por pessoa errado: o pagador vê
R$ 300 e quem deve vê R$ 0, já no dashboard. Sincronizar automaticamente cria
problemas de edição e exclusão (quem edita a despesa altera a transação de outro?).

Além disso, relatórios, dashboard e orçamentos precisam excluir várias coisas:
transações apagadas, transferências e saldo inicial (ADR
[0004](0004-contas-e-transacoes.md)) e acertos; e o cartão conta pelo mês da
fatura (ADR [0005](0005-cartao-e-parcelamento.md)). Repetir esses filtros em cada
consulta é garantia de que um deles vai ser esquecido.

## Decisão

**1. Domínios separados, com vínculo opcional e explícito.**

- Despesa de grupo **não** cria transação pessoal automaticamente.
- No formulário da despesa, quem pagou pode marcar "registrar o pagamento na
  minha conta": cria uma transação `EXPENSE` do valor pago, na conta escolhida
  (mesma moeda do grupo, ADR [0003](0003-moedas.md); conta não arquivada, ADR
  0004), com `source_type = 'GROUP_EXPENSE'` e `source_id` = id da despesa. A
  categoria da transação é escolhida pelo usuário, entre as dele.
- Acertos têm a mesma opção: quem pagou registra `EXPENSE`; quem recebeu, `INCOME`.
- Só o próprio usuário cria o vínculo na conta dele: o pagador da despesa, ou a
  origem ou o destino do acerto. Quem registra um acerto entre outros dois
  membros não cria transação para ninguém.
- Editar ou excluir a despesa ou o acerto **não** altera a transação vinculada; a
  interface avisa ("a transação ligada na sua conta não foi alterada") e oferece
  o atalho.

**2. Uma definição única de "transação de relatório".**

- View SQL `reportable_transaction`, criada em migration `--create-only`, é a
  **única fonte** para relatórios, dashboard e orçamentos. Listagens (extrato) e
  saldo de conta **não** usam a view: consultam `transaction` pelo Prisma, como de
  costume, com o valor pago.
- Exclui:
  - `deleted_at IS NOT NULL`;
  - `type = 'TRANSFER'`;
  - `is_opening_balance`;
  - `source_type` de acerto (devolução de dinheiro, não consumo nem renda).
- Expõe `reference_month` (`"YYYY-MM"`): `statement_month` para transações de
  conta `CREDIT_CARD`, à vista ou parcela (ADR 0005); senão o mês de `date`. Um
  critério só por conta.
- Agregações usam `$queryRaw` sobre a view, com o resultado validado por schema
  Zod e **sempre** com filtro `user_id` (regra 5). Somas vêm em `bigint` e passam
  pela conversão do repository (ADR [0001](0001-dinheiro-decimais-e-limites.md)).

**3. Despesa de grupo conta pela parte do usuário.**

- Transação com `source_type = 'GROUP_EXPENSE'` entra na view com o valor da
  **parte do próprio usuário** naquela despesa (a `expense_share` do membro dele),
  na categoria que ele escolheu na transação e no `reference_month` dela, e não
  com o valor pago. Se ele não participa da divisão (só pagou), ou se a despesa ou
  a parte foi apagada, não há parte: a transação não aparece nos relatórios.
- As partes do usuário em despesas de grupo **sem** transação vinculada não
  apagada dele (não pagou, ou pagou e não vinculou) entram na view:
  - na categoria sintética **"Gastos em grupo"**: não é linha de `category`
    (`category_id` nulo na view, com uma coluna que marca a origem); o rótulo é
    uma constante de `packages/shared`;
  - como `EXPENSE`, no mês da `date` da despesa, na moeda do grupo;
  - só de grupos em que ele é membro `ACTIVE` (ADR
    [0006](0006-grupos-membros-e-convites.md)), só de despesas e partes não apagadas.
- O valor é lido na hora da consulta: editar a despesa (total, divisão, data)
  muda o relatório de todos os participantes, sem tocar em nenhuma transação.
- Cada usuário tem no máximo uma transação não apagada vinculada a uma mesma
  despesa (índice único parcial em `(user_id, source_type, source_id) WHERE
  deleted_at IS NULL`), para a parte não ser contada duas vezes.
- Exemplo: jantar de R$ 300 entre 3, pago por A, que vinculou a transação em
  Alimentação. A vê R$ 100 em Alimentação; B e C veem R$ 100 cada em "Gastos em
  grupo". A soma por pessoa é o consumo real.

**4. Dashboard.** Mostra, separado das contas e por moeda, "sua parte em gastos
de grupo no mês" (soma das suas `expense_share`) e "saldo a receber/pagar em
grupos". Os dois consideram só grupos em que o usuário é membro `ACTIVE`; ao sair,
o histórico daquele grupo sai do dashboard, coerente com a perda de acesso (ADR
0006).

**5. Orçamentos.** Como tratam a parte em despesas de grupo (inclusive a
categoria "Gastos em grupo") fica para um ADR futuro de orçamentos, que pode usar
a mesma view.

**Testes obrigatórios** (integração, Postgres real)

- Um caso por exclusão: transferência, saldo inicial, acerto e transação apagada
  não aparecem na view.
- `reference_month` do cartão: compra depois do fechamento cai no mês seguinte;
  transação de conta comum usa o mês de `date`.
- Consulta de agregação sem `user_id` não existe: teste com dois usuários
  confere que um não vê o total do outro.
- O jantar do exemplo: A vê R$ 100 em Alimentação e nada em "Gastos em grupo"; B e
  C veem R$ 100 em "Gastos em grupo".
- Pagador que não participa da divisão: a transação vinculada não aparece.
- Despesa editada muda o valor no relatório, tanto da transação vinculada quanto
  de "Gastos em grupo".
- Grupo de que o usuário saiu: as partes dele somem de "Gastos em grupo" e do
  dashboard.

## Consequências

- Nenhuma ação de um membro altera dados pessoais de outro (regra 5 intacta); a
  edição de uma despesa muda só o que os outros veem nos relatórios, que é o
  consumo real deles.
- O extrato mostra R$ 300 saindo da conta e o relatório mostra R$ 100 de gasto; a
  interface precisa explicar a diferença (os R$ 200 aparecem como "a receber").
- A mesma parte pode cair em meses diferentes conforme o caminho: vinculada a um
  cartão, conta pelo `statement_month`; sem vínculo, pelo mês da `date` da
  despesa.
- A transação vinculada continua contando a parte depois que o usuário sai do
  grupo (é dado pessoal dele, e a parte de membro `LEFT` está congelada, ADR
  0006); só as partes sem vínculo e o dashboard de grupos somem.
- Apagar a transação vinculada move a parte para "Gastos em grupo"; apagar a
  despesa faz a transação vinculada sumir dos relatórios, embora continue no
  extrato e no saldo.
- A view não está no `schema.prisma`. Mudar o que é "transação de relatório"
  exige nova migration com `CREATE OR REPLACE VIEW`. A view lista colunas
  explícitas (não `t.*`, que o Postgres congela na criação), e o Postgres impede
  `ALTER COLUMN ... TYPE` numa coluna usada por ela: a migration precisa recriar
  a view. Com a parte de grupo, ela junta `transaction`, `expense`,
  `expense_share` e `group_member`; os índices em `expense_share(member_id)` e em
  `transaction(source_type, source_id)` sustentam a consulta.
- Novos tipos de exclusão (ex.: estorno, importação em revisão) entram na view,
  não nas consultas.

## Alternativas consideradas

- **Integração automática estilo "sua parte vira transação":** exige sincronizar
  edições e exclusões entre usuários, com risco de alterar dados alheios.
- **Domínios totalmente isolados:** o usuário lança tudo duas vezes, sem rastreio.
- **Contar o valor pago:** total certo, gasto por pessoa distorcido (pagador
  com R$ 300, devedores com R$ 0).
- **Ignorar gastos de grupo nos relatórios:** subnotifica quem só deve.
- **Exigir categoria pessoal em toda despesa de grupo:** categorias são por
  usuário (ADR 0004), então cada membro teria de categorizar cada despesa.
- **Helper de `where` do Prisma em vez de view:** não serve para `$queryRaw` de
  agregação; viraria duas definições que divergem.
- **Filtros repetidos em cada relatório:** fácil esquecer uma exclusão.
- **Compra à vista no cartão pelo mês da data e parcela pelo mês da fatura:** dois
  critérios na mesma conta.
- **Dashboard incluindo grupos antigos:** exige acesso a histórico que o ADR 0006
  remove.
