# 0018. Despesas de grupo e finanças pessoais

- Status: Aceito (complementado por [0030](0030-acertos-simplificacao-e-membros-inativos.md))
- Data: 2026-09-23

## Contexto

O FinApp tem dois domínios de dinheiro: finanças pessoais (contas, transações,
orçamentos) e divisão de gastos (grupos, despesas, acertos). Não está decidido
como eles se relacionam:

- Se eu pago R$ 300 de um jantar dividido por 3, saíram R$ 300 da minha conta, mas
  meu gasto real é R$ 100 e tenho R$ 200 a receber.
- O orçamento de "Alimentação" deve contar R$ 300, R$ 100 ou nada?
- Quando alguém me paga o acerto, isso é receita?

Contar errado distorce dashboard e orçamentos; sincronizar automaticamente cria
problemas de edição e exclusão (quem edita a despesa altera a transação de outro?).

## Decisão

**V1: domínios separados, com vínculo opcional e explícito.**

- Despesa de grupo **não** cria transação pessoal automaticamente.
- No formulário da despesa, quem pagou pode marcar "registrar o pagamento na
  minha conta": cria uma transação `EXPENSE` do valor pago, na conta escolhida
  (mesma moeda, ADR 0003), com `source_type = 'GROUP_EXPENSE'` e `source_id`.
  Só o próprio pagador cria o vínculo; os outros membros nunca geram transações
  na conta dele.
- Acertos têm a mesma opção: quem pagou registra `EXPENSE`; quem recebeu, `INCOME`.
  Transações com `source_type` de acerto ficam **fora** de receitas e despesas nos
  relatórios e orçamentos (é devolução de dinheiro, não consumo nem renda).
- Editar ou excluir a despesa **não** altera a transação vinculada; a interface
  avisa ("a transação ligada na sua conta não foi alterada") e oferece o atalho.
- Dashboard pessoal mostra, separado das contas e por moeda: "sua parte em gastos
  de grupo no mês" (soma das suas `expense_share`) e "saldo a receber/pagar em grupos".
- Orçamentos na V1 contam só transações pessoais. Contar a parte do grupo no
  orçamento fica para um ADR futuro, junto com o mapeamento de categorias.

## Consequências

- Nenhuma ação de um membro altera dados pessoais de outro (regra 5 intacta).
- O usuário pode ver R$ 300 saindo da conta e R$ 100 como parte no grupo; a
  interface precisa explicar a diferença (os R$ 200 aparecem como "a receber").

## Alternativas consideradas

- **Integração automática estilo "sua parte vira transação":** exige sincronizar
  edições e exclusões entre usuários, com risco de alterar dados alheios.
- **Domínios totalmente isolados:** o usuário lança tudo duas vezes, sem rastreio.
