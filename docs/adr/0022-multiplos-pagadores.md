# 0022. Despesa com mais de um pagador

- Status: Proposto
- Data: 2026-09-23

## Contexto

O modelo previsto (agente database) tem `expense` com um único pagador. No uso real,
uma conta de restaurante é paga por duas pessoas ("eu passei R$ 200 no cartão, ela
R$ 100 no pix"). Se o schema nascer com uma coluna de pagador, suportar vários
depois exige migration de dados e reescrita do cálculo de saldos.

## Decisão (recomendada)

- Pagamentos em tabela própria desde a primeira migration de despesas:
  `expense_payment` (`id`, `expense_id`, `member_id` → `group_member.id`,
  `amount_cents > 0`, `deleted_at`). Sem coluna `payer` em `expense`.
- Soma dos pagamentos = total da despesa, senão `422 SPLIT_PAYMENT_SUM_MISMATCH`.
  Pagador sem repetição.
- **V1 da interface e da API aceita só um pagador** (lista com um item). Liberar
  vários é só mudar a validação e a tela.
- Saldo de cada membro no grupo = Σ pagou − Σ partes + Σ acertos recebidos −
  Σ acertos pagos. Função pura, testada com a propriedade "soma dos saldos do
  grupo = 0".
- Editar ou excluir a despesa altera pagamentos e partes juntos, na mesma
  transação e no mesmo `audit_log`.

## Consequências

- Custo agora: uma tabela e um join. Evita migration de dados depois.
- A simplificação de dívidas trabalha só com os saldos, sem mudança.

## Alternativas consideradas

- **Coluna `payer_member_id` agora e tabela depois:** migration com movimentação de
  dados em produção e dois formatos de API.
- **Registrar o segundo pagador como acerto:** distorce o histórico ("acerto" que
  na verdade foi pagamento da conta).
