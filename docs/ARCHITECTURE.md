# ARCHITECTURE

## TOC
- [1. Componentes](#1-componentes)
- [2. Fluxo De Dados](#2-fluxo-de-dados)
- [3. Fluxos Criticos](#3-fluxos-criticos)
- [4. Pontos De Depuracao Rapida](#4-pontos-de-depuracao-rapida)

## 1. Componentes

```text
+--------------------+          +---------------------+
| apps/web (Next.js) |<-------->| apps/api (NestJS)   |
| App Router ERP     |  HTTP    | Controllers/Services |
+--------------------+          +----------+----------+
            ^                              |
            |                              | Prisma Client
            |                              v
+----------------------+          +---------------------+
| apps/mobile (Expo)   |--------->| SQLite dev /        |
| Mobile ERP basico    |   HTTP   | Postgres prod       |
+----------------------+          +---------------------+

+-----------------------+
| packages/shared (Zod) |
| Contratos de dominio  |
+-----------+-----------+
            |
            +--> consumido por web/api/mobile
```

Referencias:
- API composition: [`apps/api/src/app.module.ts`](../apps/api/src/app.module.ts)
- Web shell: [`apps/web/src/app/layout.tsx`](../apps/web/src/app/layout.tsx)
- Shared contracts: [`packages/shared/src/index.ts`](../packages/shared/src/index.ts)

## 2. Fluxo De Dados

```text
[Web/Mobile Form]
      |
      v
[apiFetch (web/mobile)]
      |
      v
[Nest Controller] --> [Zod parse] --> [Service]
                                      |
                                      v
                                   [Prisma]
                                      |
                                      v
                                    [DB]
                                      |
                                      v
                            [JSON response -> UI]
```

Clientes HTTP:
- Web: [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts)
- Mobile: [`apps/mobile/src/lib/api.ts`](../apps/mobile/src/lib/api.ts)

## 3. Fluxos Criticos

### 3.1 Criar pedido com consumo de estoque

```text
POST /orders
  -> OrdersService.create
     -> valida cliente + itens
     -> calcula subtotal/discount/total
     -> cria Order + OrderItem
     -> applyInventoryMovements(direction=OUT)
         -> consulta BOM por produto
         -> gera InventoryMovement por item de insumo
```

Referencia:
- [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts)

### 3.2 Cancelar pedido com estorno de estoque

```text
PATCH /orders/:id/status (CANCELADO)
  -> valida transicao ABERTO/CONFIRMADO/EM_PREPARACAO/PRONTO -> CANCELADO
  -> applyInventoryMovements(direction=IN)
  -> atualiza status do pedido
```

### 3.3 Estoque detalhado no web

```text
GET /inventory-items
GET /inventory-movements
GET /boms
  -> pagina /estoque calcula:
     saldo por item
     custo por caixa (BOM)
     capacidade estimada
```

Referencia:
- [`apps/web/src/app/estoque/page.tsx`](../apps/web/src/app/estoque/page.tsx)

## 4. Pontos De Depuracao Rapida

- Health API: [`apps/api/src/app.controller.ts`](../apps/api/src/app.controller.ts)
- Bootstrap/env/Swagger: [`apps/api/src/main.ts`](../apps/api/src/main.ts)
- Logs dev scripts: `/tmp/querobroapp-api.log`, `/tmp/querobroapp-web.log`
- Smoke script: [`scripts/qa-smoke.mjs`](../scripts/qa-smoke.mjs)

Risco estrutural atual:
- drift entre schema dev/prod e lock de migracoes em sqlite.
- referencias: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma), [`apps/api/prisma/schema.prod.prisma`](../apps/api/prisma/schema.prod.prisma), [`apps/api/prisma/migrations/migration_lock.toml`](../apps/api/prisma/migrations/migration_lock.toml)
