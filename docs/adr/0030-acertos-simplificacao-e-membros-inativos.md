# 0030. Acertos, simplificação de dívidas e membros inativos

- Status: Aceito
- Data: 2026-09-24
- Complementa: [0004](0004-despesas-de-grupo.md), [0008](0008-grupos-membros-e-convites.md), [0018](0018-despesas-de-grupo-e-financas-pessoais.md)

## Contexto

O item 8 do roadmap (saldos, acertos, simplificação) não tinha ADR. Faltava
definir o modelo do acerto, o acerto parcial ou acima da dívida, o acerto com
membro sem conta, quem registra, e o algoritmo e o desempate da simplificação.

Havia também uma brecha no ADR 0008: sair do grupo exige saldo zero, mas editar
ou apagar uma despesa antiga que envolve o membro que saiu muda o saldo de quem
já não tem acesso ao grupo. E o ADR 0018 não dizia se "sua parte em gastos de
grupo" no dashboard inclui grupos de que o usuário saiu.

## Decisão

**1. Membro inativo congela o histórico dele**

- Criar, editar ou excluir despesa ou acerto que envolva membro `LEFT` (como
  pagador, participante, origem ou destino) → `409 MEMBER_NOT_ACTIVE`, com
  `details.memberIds`. Vale também para editar uma despesa antiga em que ele
  aparece, mesmo que a mudança não toque a parte dele.
- Para corrigir, o membro volta ao grupo antes (reativa a mesma linha, ADR 0008).
  Assim o invariante "quem saiu tem saldo zero" nunca quebra.
- Membro com conta volta só por convite (ADR 0008). Membro **sem conta** `LEFT`
  não tem login para aceitar convite: o `OWNER` o reativa com
  `POST /api/groups/:groupId/members/:memberId/reactivate`, registrado no
  `audit_log`.
- O membro de quem excluiu a conta (ADR 0010) **continua `ACTIVE`**, como membro
  sem conta ("Usuário removido"): o grupo precisa conseguir registrar acertos com
  ele. Isso esclarece o ADR 0010, que não dizia o status.

**2. Acerto**

Tabela `settlement`: `id`, `group_id`, `from_member_id` e `to_member_id`
(→ `group_member.id`), `amount_cents` (`CHECK > 0`), `currency` (= moeda do
grupo, senão `422 CURRENCY_MISMATCH`, ADR 0003), `date` (competência, `DATE`,
ADR 0002), `note`, `created_by_user_id`, `created_at`, `updated_at`,
`deleted_at` (soft delete com `audit_log`, ADR 0005, e trigger do ADR 0027).

- `from_member_id ≠ to_member_id`, senão `422 VALIDATION_ERROR`. Os dois são
  membros do mesmo grupo.
- Qualquer membro ativo registra, edita e exclui (soft) qualquer acerto do grupo,
  com `audit_log`, como nas despesas (ADR 0008). Membros sem conta podem ser
  origem ou destino.
- Valor: qualquer inteiro de `1` a `MAX_AMOUNT_CENTS` (ADR 0024). Acerto parcial
  é normal. Acerto acima da dívida é permitido e inverte o saldo; a interface
  sugere o valor exato e avisa quando o valor passa da dívida.
- Criação aceita `Idempotency-Key` (regra 7, ADR 0006). O vínculo opcional com
  transação pessoal segue o ADR 0018.
- Saldo: fórmula do ADR 0004, sem mudança.

**3. Simplificação de dívidas**

- Calculada na leitura, em `GET /api/groups/:groupId/settle-up`, e **nunca
  gravada**.
- Função pura em `packages/shared/src/settle.ts`, que recebe os saldos (ADR 0004)
  e ignora os zerados. A cada passo, o maior devedor paga ao maior credor
  `min(|dívida|, crédito)`. Empate: `group_member.id` crescente (comparação de
  string com `<`, sem locale, como no ADR 0004).
- Com `n` membros de saldo não zero, gera no máximo `n − 1` transferências. Não
  garante o mínimo absoluto (problema NP-difícil); é aceitável.
- As sugestões só preenchem o formulário de acerto; nada é registrado
  automaticamente.
- Propriedades testadas com fast-check: aplicar as sugestões zera todos os
  saldos; no máximo `n − 1` transferências; nenhuma de valor zero; determinismo;
  invariância à ordem de entrada.

**4. Dashboard (ADR 0018)**

"Sua parte em gastos de grupo" e "saldo a receber/pagar em grupos" consideram só
grupos em que o usuário é membro `ACTIVE`. Ao sair, o histórico daquele grupo sai
do dashboard, coerente com a perda de acesso (ADR 0008).

## Consequências

- O saldo de quem saiu nunca muda sem ele; a soma dos saldos do grupo continua 0.
- Corrigir despesa antiga com ex-membro exige trazê-lo de volta. A reativação
  pelo `OWNER` garante que isso seja possível também com membro sem conta, sem
  deixar a despesa congelada para sempre.
- O "Usuário removido" continua ativo e aparece nas sugestões de acerto e nas
  listas de participantes. A interface pode escondê-lo do seletor de
  participantes de despesas **novas**, mas a API não o bloqueia.
- O texto do ADR 0010 ("a saída não exige saldo zero") passa a ser lido como
  desvincular o usuário da linha, não marcá-la `LEFT`.
- `settlement` entra na lista de modelos com soft delete (ADR 0005) e ganha o
  trigger na mesma migration (ADR 0027); a lista de acertos segue a paginação por
  cursor do ADR 0026, ordenada por `(date, id)` decrescente, com índice
  `(group_id, date, id)`.
- O vínculo com transação pessoal (ADR 0018) só existe para o usuário que é a
  origem ou o destino; quem registra um acerto entre outros dois membros não cria
  transação para ninguém.
- Sair do grupo zera o que o dashboard mostrava daquele grupo, inclusive a parte
  em gastos de meses passados; o número muda sem nenhuma despesa nova.

## Alternativas consideradas

- **Editar despesa com membro que saiu e reabrir o saldo dele:** quebra o
  invariante do ADR 0008, e ele não tem acesso para acertar.
- **Marcar como `LEFT` o membro de quem excluiu a conta:** o grupo não
  conseguiria mais acertar com ele.
- **Acerto só pelo valor exato da dívida:** bloqueia pagamento parcial, comum na
  prática.
- **Gravar a simplificação:** fica desatualizada a cada despesa ou acerto.
- **Algoritmo de mínimo exato:** exponencial, sem ganho perceptível em grupos
  pequenos.
- **Dashboard incluindo grupos antigos:** exige acesso a histórico que o ADR 0008
  remove.
