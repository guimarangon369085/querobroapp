# ARCHITECTURE

## Visao simples

```text
Web (Next.js)  ----\
                  ---> API (NestJS) ---> Prisma ---> SQLite dev / Postgres prod
Mobile (Expo) ---/

Runtime config (read-only JSON) ---> API
Shared contracts (Zod) ---------> Web + API + Mobile
```

## Camadas

- Interface: `apps/web` e `apps/mobile`.
- Regras de negocio: `apps/api/src/modules`.
- Contratos de entrada e saida: `packages/shared/src/index.ts`.
- Persistencia: `apps/api/prisma/schema.prisma` e `apps/api/prisma/schema.prod.prisma`.
- Runtime config legada, em leitura: `GET /runtime-config` (com alias legado `GET /builder/config`).

## Modulos principais da API

- Base: `products`, `customers`
- Operacao: `orders`, `payments`, `deliveries`, `production`
- Estoque: `inventory`, `stock`, `bom`
- Suporte interno: `runtime-config` (read-only)

Arquivo de composicao:

- `apps/api/src/app.module.ts`

## Fluxos principais

### 1) Pedido, entrega e financeiro

1. Web cria pedido com cliente + itens.
2. API calcula subtotal, desconto e total.
3. API aplica consumo de estoque por BOM e movimenta producao quando o fluxo avanca.
4. Entrega move o pedido pelo caminho certo.
5. Pagamentos atualizam `amountPaid`, `balanceDue` e `paymentStatus`.

### 2) Agenda operacional em Pedidos

1. Web abre direto em `/pedidos`.
2. A agenda `Dia`, `Semana` e `Mes` vive na mesma tela.
3. Clique em qualquer dia sempre abre a visao `Dia`, inclusive vazio.
4. A visao `Dia` e compacta e cobre `08:00` a `22:59`.

### 3) D+1 e estoque

1. API le pedidos e BOM.
2. Calcula necessidade por insumo para a data alvo.
3. Compara necessidade com saldo de inventario.
4. Web mostra faltas e compras no quadro D+1.

### 4) Integracoes externas

1. Nao ha integracoes externas ativas na base operacional atual.
2. O fluxo validado hoje e 100% interno.
3. Qualquer reintegracao futura deve ser redesenhada do zero.

## Decisoes tecnicas importantes

- Em dev, banco padrao e SQLite.
- Em producao, usar Postgres com `schema.prod.prisma`.
- Auth em producao e obrigatoria por padrao.
- Throttling e `helmet` ja estao ativos na API.
- Loopback local (`localhost`, `127.0.0.1`, `::1`) e tratado como origem valida para o fluxo de QA local.

## Qualidade e operacao

- `pnpm qa:trust` e o gate base.
- `pnpm qa:browser-smoke` valida as 4 telas principais em navegador real.
- `pnpm qa:critical-e2e` valida a jornada critica ponta a ponta.
- `./scripts/dev-all.sh` e o caminho preferido para subir API + Web localmente.

## Riscos atuais

- Drift entre schema dev e prod ainda exige monitoramento continuo.
- Cobertura de testes de negocio ainda nao cobre todo edge case.
- Integracoes externas removidas reduzem ambiguidade de ambiente, mas exigem disciplina para nao presumir contratos legados em docs, env ou testes.
