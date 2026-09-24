# 0033. Rate limit por falha e tokens de reset simultâneos

- Status: Aceito
- Data: 2026-09-24
- Complementa: [0007](0007-sessoes-e-autenticacao.md), [0014](0014-envio-de-email-e-tokens.md)

## Contexto

Dois pontos dos ADRs de autenticação abrem negação de serviço contra usuários
legítimos:

1. **Login por IP (ADR 0007):** 50 requisições/h por IP atinge muitas pessoas
   atrás do mesmo IP (CGNAT de operadora móvel, universidades, empresas), e login
   **bem-sucedido** consome a cota como qualquer outro.
2. **Reset de senha (ADR 0014):** "pedir um novo token invalida os anteriores",
   somado a 3 pedidos/h por e-mail, deixa um atacante pedir reset em nome da
   vítima, invalidar o link que ela acabou de receber e esgotar a cota dela.

## Decisão

Este ADR **altera dois pontos** e mantém o resto dos ADRs 0007 e 0014:

- as linhas de `POST /api/auth/login` na tabela de rate limit do ADR 0007;
- a regra "pedir um novo token invalida os anteriores do mesmo tipo" do ADR
  0014, **só para `PASSWORD_RESET`**.

**Login conta só falhas**

- Contadores no Redis, incrementados pelo service de auth quando a credencial é
  inválida (o `@fastify/rate-limit` conta requisições, não falhas).
- Limites:

  | Chave | Limite de falhas |
  |---|---|
  | IP + e-mail normalizado | 5/min e 20/h |
  | IP | 100/h |

- Os contadores são consultados **antes** de verificar a senha: com o limite
  estourado, não se roda o argon2.
- Login bem-sucedido zera o contador de IP + e-mail (o de IP não).
- Estouro → `429 RATE_LIMITED` com `Retry-After`, igual ao ADR 0007.
- Cadastro e pedido de reset continuam no `@fastify/rate-limit` com os limites
  do ADR 0007; as demais rotas autenticadas também.

**Reset de senha**

- Novo pedido **não** invalida os tokens `PASSWORD_RESET` anteriores.
- No máximo 3 tokens `PASSWORD_RESET` ativos (não usados e não expirados) por
  usuário, coerente com 3 pedidos/h por e-mail. Se já houver 3, o pedido é
  aceito com a mesma resposta neutra do ADR 0014 ("se houver conta, enviamos um
  link") e não gera token nem e-mail.
- Usar qualquer um deles invalida todos (`used_at` em todos, na mesma transação)
  e apaga as sessões do usuário (ADR 0007).
- Os e-mails que o atacante dispara chegam à própria vítima, com links válidos;
  não há mais como bloquear o reset dela.
- `EMAIL_VERIFY` e `ACCOUNT_DELETION_CANCEL` seguem o ADR 0014 sem mudança.

**Testes**

- Login bem-sucedido não consome cota.
- 6ª falha em 1 min para o mesmo IP + e-mail → `429` com `Retry-After`.
- Pedido de reset não invalida o link anterior.
- Usar um token de reset invalida os outros e apaga as sessões.

## Consequências

- Muitos usuários atrás do mesmo IP logam normalmente; só erro de senha conta.
- Força bruta continua contida pelo limite por IP + e-mail; o limite por IP
  (100 falhas/h) segura quem testa muitos e-mails.
- O rate limit do login sai do plugin e vira código do service de auth, com
  teste de integração próprio (Redis real via Testcontainers).
- Como o contador é consultado antes do argon2, com o limite por IP estourado
  (100 falhas/h) todos os logins daquele IP recebem `429`, inclusive os com senha
  certa, até a janela passar. Aceito: é o custo de não rodar o hash sob ataque, e
  100 falhas/h de um mesmo IP já indica abuso.
- As chaves de IP + e-mail guardam e-mail no Redis só pelo TTL da janela (ADR
  0032).
- Pela regra do README, alterar decisão de ADR aceito seria caso de substituição;
  aqui a mudança é restrita a dois pontos e o restante dos ADRs 0007 e 0014
  continua valendo, por isso "complementa". Quem ler o 0007 ou o 0014 precisa
  seguir a nota na linha de status até este ADR.

## Alternativas consideradas

- **Bloqueio de conta após N falhas:** DoS contra a vítima; já recusado no ADR
  0007.
- **CAPTCHA no login e no reset:** fica para quando houver abuso real.
- **Manter "novo pedido invalida o anterior" no reset:** permite o DoS descrito
  no contexto.
- **Manter o limite por requisição e só aumentar o de IP:** login bem-sucedido
  continuaria consumindo cota, e um valor alto enfraquece o limite contra ataque.
