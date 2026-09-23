# 0002. Datas, instantes e fuso horário

- Status: Proposto
- Data: 2026-09-23

## Contexto

O Prisma lê uma coluna `DATE` como `Date` à meia-noite UTC (`2026-09-23T00:00:00Z`).
Formatada com `Intl` no fuso `America/Sao_Paulo`, ela aparece como **22/09**. O
mesmo erro acontece ao contrário: depois das 21h em Brasília, "hoje" em UTC já é
o dia seguinte.

## Decisão

**Instantes** (`createdAt`, horário de uma operação)

- Banco: `timestamptz` (`DateTime @db.Timestamptz`).
- JSON: ISO 8601 em UTC, `"2026-09-23T14:05:00.000Z"`.
- Exibição: `Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ... })`,
  sempre com `timeZone` explícito.

**Datas de competência** (dia de uma transação ou despesa)

- Banco: `DATE` (`DateTime @db.Date`).
- JSON e código: **string** `"YYYY-MM-DD"` (schema `localDateSchema` em
  `packages/shared`). Nunca `Date` fora do repository.
- Repository converte: leitura `date.toISOString().slice(0, 10)`; escrita
  ``new Date(`${s}T00:00:00Z`)``.
- Exibição: `Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' })` sobre
  ``new Date(`${s}T00:00:00Z`)``, ou formatar as partes da string direto.
- "Hoje" e "mês atual" são calculados em `America/Sao_Paulo`, nunca em UTC nem no
  fuso do servidor. Helper `todayInSaoPaulo()` em `packages/shared`.
- Filtros por mês usam intervalo de strings: `date >= '2026-09-01' AND date < '2026-10-01'`.

## Consequências

- Um teste deve cobrir uma transação criada às 22h de Brasília: a data de
  competência continua sendo o dia local.
- Servidor e CI devem funcionar com qualquer `TZ`; testes rodam com `TZ=UTC` e com
  `TZ=America/Sao_Paulo` para pegar dependências do fuso da máquina.

## Alternativas consideradas

- **Usar `Date` em todo lugar:** é a causa do bug de "um dia a menos".
- **Guardar competência como `timestamptz`:** mistura instante com data de calendário.
- **Biblioteca de datas (date-fns-tz, Temporal):** pode entrar depois; a regra
  acima não depende dela.
