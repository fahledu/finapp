# Status do projeto

Ponto de retomada: onde o projeto está, o que vem a seguir e o que está em aberto.
Atualize ao fim de cada item do roadmap (GUIA.md, seção 4) ou quando uma questão
for resolvida. Questão resolvida sai daqui e vai para um ADR ou plano.

- **Última atualização:** 2026-09-24
- **Fase:** documentação pronta, sem código.
- **Próximo passo:** roadmap item 1, pelo prompt "Primeira sessão" do GUIA.md.

## Feito

- ADRs 0001–0021 aceitos e consolidados (linha de base de 2026-09-24, ver `docs/adr/README.md`).
- ADR 0024: limites de valores monetários e decimais.
- ADR 0025: transação passada explicitamente entre camadas.
- ADR 0026: convenções de API (cursor, filtros, type provider com schema de resposta).
- ADR 0027: soft delete e `audit_log` garantidos no banco (triggers) e escritas aninhadas.
- ADR 0028: moeda e tipo de conta fixos, arquivamento de conta, view `reportable_transaction`.
- ADR 0029: `splitEvenly` para parcelas, mês de referência do cartão, edição de parcelamento.
- ADR 0030: acertos, simplificação de dívidas, membros inativos.
- ADR 0031: outbox de jobs.
- ADR 0032: retenção de backups, sessões e logs.
- ADR 0033: rate limit de login por falha e tokens de reset simultâneos.
- Agentes e hooks de área em `.claude/`, com as brechas da revisão fechadas:
  `readonly-bash` bloqueia `<(`, `--pre`, `--compress-program`, `--ext-diff`,
  `--textconv`; `database` não edita `.claude/`; `docs` só escreve documentação;
  `.claude/settings.json` bloqueia leitura de `.env`.

## Limites aceitos

- Hooks de caminho valem para Edit/Write, não para Bash (registrado no CLAUDE.md).
- `pnpm test`/`lint` rodados pelos agentes de revisão executam scripts do projeto.

## Questões em aberto

Nenhuma bloqueando o item 1. As que dependem de feature estão em
`docs/adr/README.md` ("Decisões ainda sem ADR"): investimentos, orçamentos,
recorrências, importação de extrato e câmbio.

## Lembretes com data

- **Outubro de 2026:** Node 26 vira LTS; revisar o ADR 0011.
