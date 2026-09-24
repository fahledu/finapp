# Status do projeto

Ponto de retomada: onde o projeto está, o que vem a seguir e o que está em aberto.
Atualize ao fim de cada item do roadmap (GUIA.md, seção 4) ou quando uma questão
for resolvida. Questão resolvida sai daqui e vai para um ADR ou plano.

- **Última atualização:** 2026-09-24
- **Fase:** documentação pronta, sem código.
- **Próximo passo:** roadmap item **1a (fundação)**, pelo prompt "Primeira
  sessão" do GUIA.md: o architect gera `docs/plans/fundacao.md` a partir dos ADRs.

## Feito

- 15 ADRs aceitos, um por assunto (consolidados em 2026-09-24; índice em
  `docs/adr/README.md`). São a fonte única das regras.
- CLAUDE.md como índice das regras; agentes enxutos que citam os ADRs.
- Garantias de consistência: `scripts/check-docs.mjs` (índice, links, citações)
  rodando por hook ao fim de cada sessão e subagente; testes dos hooks em
  `.claude/hooks/hooks.test.mjs`.
- Hooks de área: só o `architect` escreve ADRs, só o `database` altera o schema,
  ninguém altera `.claude/`, `reviewer`/`security` só leem, `.env` não é lido.

## Limites aceitos

- Hooks de caminho valem para Edit/Write, não para shell (proibição registrada no CLAUDE.md).
- `pnpm test`/`lint` rodados pelos agentes de revisão executam scripts do projeto.

## Questões em aberto

Nenhuma bloqueando o item 1a. As que dependem de feature futura estão em
`docs/adr/README.md` ("Decisões ainda sem ADR").

## Lembretes com data

- **Outubro de 2026:** Node 26 vira LTS; revisar o ADR 0015.
- **Ao criar o CI (item 1a):** incluir `node scripts/check-docs.mjs` e
  `node --test .claude/hooks/hooks.test.mjs`.
