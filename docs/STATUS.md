# Status do projeto

Ponto de retomada: onde o projeto está, o que vem a seguir e o que está em aberto.
Atualize ao fim de cada item do roadmap (GUIA.md, seção 4) ou quando uma questão
for resolvida. Questão resolvida sai daqui e vai para um ADR ou plano.

- **Última atualização:** 2026-09-24
- **Fase:** documentação pronta, sem código.
- **Próximo passo:** roadmap item 1, pelo prompt "Primeira sessão" do GUIA.md.
  Antes, resolver as questões marcadas com **(antes do item 1)**.

## Feito

- ADRs 0001–0021 aceitos e consolidados (linha de base de 2026-09-24, ver `docs/adr/README.md`).
- Agentes e hooks de área em `.claude/`.

## Pendências de ferramenta (hooks e agentes)

- [ ] `readonly-bash.mjs` deixa passar comandos que executam programas:
      `cat <(cmd)`, `rg --pre prog`, `sort --compress-program=prog`. Bloquear
      `<(`, `--pre` e `--compress-program`.
- [ ] Agente `database` não tem hook: pode editar `.claude/` e desligar os hooks
      dos outros. Dar a ele `--deny .claude/`.
- [ ] Agente `docs` deveria só comentar código, mas o hook permite editar `apps/`.
      Restringir a `docs/`, `README.md` e `CLAUDE.md` (JSDoc em `packages/shared`
      fica com quem escreve o código).
- [ ] Não existe `.claude/settings.json`: sessão principal sem restrição e nada
      impede ler `.env`. Criar com `deny` para `Read(.env*)`.
- [ ] Limite conhecido: agentes com Bash contornam o `guard-paths` (`sed -i`,
      `pnpm db:migrate`). Documentar no CLAUDE.md ou aceitar.

## Questões de domínio em aberto

Não estão decididas em nenhum ADR. O architect traz cada uma para decisão ao
planejar a feature indicada.

**Antes do item 1** (afetam `packages/shared` e a primeira migration)

- [ ] **Teto de valores.** `amountCents` só é limitado pelo inteiro seguro; somas
      de valores enormes estouram na conversão (500). `decimalStringSchema` aceita
      mais de 12 dígitos inteiros, que o `NUMERIC(20,8)` recusa (500). Definir
      máximo por operação e limitar a regex.
- [ ] **Transação atravessando camadas.** Idempotência (plugin), operação e
      `audit_log` precisam da mesma `$transaction`. Escolher: passar `tx`
      explicitamente ou `AsyncLocalStorage`.
- [ ] **Convenções de API:** paginação (cursor ou offset), filtros e ordenação;
      integração Zod 4 ↔ Fastify (type provider) para validação e OpenAPI.
- [ ] **Soft delete em escritas aninhadas.** A extensão (ADR 0005) não pega
      `update({ data: { shares: { deleteMany } } })` nem `upsert`. Proibir por
      lint/revisão ou tratar na extensão.

**Contas e transações (itens 2–5)**

- [ ] Uma definição única de "transação que entra em relatório" (exclui
      `TRANSFER`, `is_opening_balance` e `source_type` de acerto): view ou helper.
- [ ] Moeda de conta e grupo é imutável depois que existem lançamentos?
- [ ] Conta pode ser excluída ou arquivada? (Hoje só categoria tem regra.)
- [ ] Parcelamento (ADR 0020): `split.ts` desempata por id como **string**; com
      números de parcela, `"10" < "2"`. Precisa de chave numérica ou zero à esquerda.
- [ ] Parcelamento: data de competência de cada parcela; editar o total pode
      gerar parcela zero ou negativa nas faturas abertas.
- [ ] Orçamento conta compra à vista no cartão pela data ou pelo `statement_month`?

**Grupos (itens 6–8)**

- [ ] **Membro `LEFT` ganhando saldo.** Sair exige saldo zero, mas editar ou
      apagar despesa antiga com ele muda o saldo de quem não tem mais acesso.
      Bloquear a edição ou recusar despesas com membro `LEFT`.
- [ ] ADR de acertos e simplificação de dívidas (ver `docs/adr/README.md`).
- [ ] Dashboard "sua parte em grupos" (ADR 0018) inclui grupos de que o usuário saiu?

**Segurança e LGPD**

- [ ] Backups guardam dados já expurgados: definir retenção e documentar.
- [ ] Retenção de `session.ip`, `session.user_agent` e logs do pino.
- [ ] Limite de reset por e-mail (3/h) permite a um atacante esgotar o reset da
      vítima; limite de login por IP afeta usuários atrás de CGNAT.

## Lembretes com data

- **Outubro de 2026:** Node 26 vira LTS; revisar o ADR 0011.
