# Architecture Decision Records

Decisões estruturais e duradouras do FinApp. Cada ADR tem status:
**Proposto** (em discussão), **Aceito**, **Substituído por NNNN** ou **Descartado**.

Nunca edite a decisão de um ADR aceito; crie um novo que o substitua.

| # | Título | Status |
|---|---|---|
| [0001](0001-representacao-de-dinheiro.md) | Representação de dinheiro, decimais e porcentagens | Proposto |
| [0002](0002-datas-e-fusos.md) | Datas, instantes e fuso horário | Proposto |
| [0003](0003-moedas.md) | Suporte a moedas na V1 | Aceito |
| [0004](0004-algoritmo-de-divisao.md) | Algoritmo de divisão de gastos | Proposto |
| [0005](0005-soft-delete-auditoria-lgpd.md) | Soft delete, auditoria e exclusão de conta (LGPD) | Aceito |
| [0006](0006-idempotencia.md) | Idempotência de operações financeiras | Proposto |
| [0007](0007-sessoes.md) | Sessões e proteção CSRF | Proposto |
| [0008](0008-membros-de-grupo.md) | Membros de grupo e participantes sem conta | Proposto |

## Modelo

```markdown
# NNNN. Título

- Status: Proposto
- Data: AAAA-MM-DD

## Contexto
Qual problema, quais forças em jogo.

## Decisão
O que foi decidido, de forma verificável.

## Consequências
O que fica mais fácil, o que fica mais difícil, o que precisa ser feito.

## Alternativas consideradas
Opção: por que não.
```
