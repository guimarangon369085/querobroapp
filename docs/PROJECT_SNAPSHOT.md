# PROJECT_SNAPSHOT

## TOC
- [1. Visao Geral Do Monorepo](#1-visao-geral-do-monorepo)
- [2. Como Subir Localmente](#2-como-subir-localmente)
- [3. ERP Web: Paginas E Fluxo Com A API](#3-erp-web-paginas-e-fluxo-com-a-api)
- [4. Prisma: Dev Vs Prod](#4-prisma-dev-vs-prod)
- [5. Checklist Se Deu Ruim](#5-checklist-se-deu-ruim)
- [6. Definicoes Canonicas De Dominio](#6-definicoes-canonicas-de-dominio)

## 1. Visao Geral Do Monorepo

| Pacote | Stack | Papel | Arquivos de referencia |
| --- | --- | --- | --- |
| `apps/api` | NestJS + Prisma + Zod | API ERP (produtos, clientes, pedidos, pagamentos, estoque/inventario, BOM) | [`apps/api/src/app.module.ts`](../apps/api/src/app.module.ts), [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma) |
| `apps/web` | Next.js 14 App Router + Tailwind | ERP web operacional | [`apps/web/src/app/layout.tsx`](../apps/web/src/app/layout.tsx), [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts) |
| `apps/mobile` | Expo React Native | App operacional mobile (dashboard + CRUDs basicos + criacao de pedidos) | [`apps/mobile/App.tsx`](../apps/mobile/App.tsx), [`apps/mobile/src/lib/api.ts`](../apps/mobile/src/lib/api.ts) |
| `packages/shared` | TypeScript + Zod | Schemas/contratos de dominio compartilhados | [`packages/shared/src/index.ts`](../packages/shared/src/index.ts) |
| `packages/ui` | React utilitario | Base de componentes compartilhados (ainda pouco usada) | [`packages/ui/src/index.ts`](../packages/ui/src/index.ts) |

Orquestracao:
- workspace: [`pnpm-workspace.yaml`](../pnpm-workspace.yaml)
- pipelines: [`turbo.json`](../turbo.json)
- CI: [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)

## 2. Como Subir Localmente

### 2.1 Comandos principais

```bash
cd $HOME/querobroapp
pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/mobile/.env.example apps/mobile/.env
```

### 2.2 Fluxo recomendado (scripts locais)

```bash
# sobe API + Web, gera build shared e aplica migrate dev
./scripts/dev-all.sh

# derruba API/Web/Expo e limpa portas 3000/3001/8081
./scripts/stop-all.sh
```

Scripts relevantes:
- [`scripts/dev-all.sh`](../scripts/dev-all.sh): `kill-ports`, build shared, `prisma:migrate:dev`, sobe API e Web em background (logs em `/tmp/querobroapp-*.log`).
- [`scripts/qa.sh`](../scripts/qa.sh): sobe stack e roda smoke test.
- [`scripts/qa-smoke.mjs`](../scripts/qa-smoke.mjs): valida endpoints essenciais e ciclo CRUD basico.

### 2.3 Alternativa por workspace

```bash
# monorepo completo (turbo)
pnpm dev

# web isolado
pnpm --filter @querobroapp/web dev

# api isolada
pnpm --filter @querobroapp/api dev
```

### 2.4 Portas

| Servico | Porta | Referencia |
| --- | --- | --- |
| Web Next.js | `3000` | [`apps/web/package.json`](../apps/web/package.json) |
| API Nest | `3001` | [`apps/api/.env.example`](../apps/api/.env.example) |
| Expo dev server | `8081` | [`scripts/kill-ports.sh`](../scripts/kill-ports.sh) |

## 3. ERP Web: Paginas E Fluxo Com A API

### 3.1 Rotas principais (App Router)

| Rota | Arquivo | Funcao |
| --- | --- | --- |
| `/` | [`apps/web/src/app/page.tsx`](../apps/web/src/app/page.tsx) | Home/entrada visual e links para modulos |
| `/dashboard` | [`apps/web/src/app/dashboard/page.tsx`](../apps/web/src/app/dashboard/page.tsx) | KPIs de produtos, clientes, pedidos e pagamentos |
| `/produtos` | [`apps/web/src/app/produtos/page.tsx`](../apps/web/src/app/produtos/page.tsx) | CRUD de catalogo |
| `/clientes` | [`apps/web/src/app/clientes/page.tsx`](../apps/web/src/app/clientes/page.tsx) | CRUD de clientes + autocomplete Google Places |
| `/pedidos` | [`apps/web/src/app/pedidos/page.tsx`](../apps/web/src/app/pedidos/page.tsx) | Criacao/gestao de pedidos, itens, status e pagamentos |
| `/estoque` | [`apps/web/src/app/estoque/page.tsx`](../apps/web/src/app/estoque/page.tsx) | Inventario, movimentacoes e BOM/custos |

### 3.2 Estrutura de shell e navegacao

- Layout global: [`apps/web/src/app/layout.tsx`](../apps/web/src/app/layout.tsx)
- Navegacao lateral: [`apps/web/src/components/nav.tsx`](../apps/web/src/components/nav.tsx)
- Topbar contextual por rota: [`apps/web/src/components/topbar.tsx`](../apps/web/src/components/topbar.tsx)
- Sistema visual/tokens: [`apps/web/src/app/globals.css`](../apps/web/src/app/globals.css)

### 3.3 Como o Web conversa com a API

Cliente HTTP unico:
- [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts)
- base URL por `NEXT_PUBLIC_API_URL`

Mapa de consumo por pagina:

| Pagina | Endpoints usados |
| --- | --- |
| `dashboard` | `GET /products`, `GET /customers`, `GET /orders`, `GET /payments` |
| `produtos` | `GET/POST /products`, `PUT/DELETE /products/:id` |
| `clientes` | `GET/POST /customers`, `PUT/DELETE /customers/:id` |
| `pedidos` | `GET/POST /orders`, `POST /orders/:id/items`, `DELETE /orders/:id/items/:itemId`, `PATCH /orders/:id/status`, `DELETE /orders/:id`, `POST /payments`, `DELETE /payments/:id` |
| `estoque` | `GET /inventory-items`, `PUT/DELETE /inventory-items/:id`, `GET/POST/DELETE /inventory-movements`, `GET/POST/PUT/DELETE /boms` |

## 4. Prisma: Dev Vs Prod

### 4.1 Arquivos canônicos

- Dev (SQLite): [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)
- Prod (Postgres): [`apps/api/prisma/schema.prod.prisma`](../apps/api/prisma/schema.prod.prisma)
- Seed: [`apps/api/prisma/seed.ts`](../apps/api/prisma/seed.ts)
- Migracoes versionadas: [`apps/api/prisma/migrations`](../apps/api/prisma/migrations)

### 4.2 Scripts Prisma (API)

Em [`apps/api/package.json`](../apps/api/package.json):
- `prisma:migrate:dev`
- `prisma:generate:dev`
- `prisma:seed`
- `prisma:generate:prod`
- `prisma:migrate:prod`

### 4.3 Resolucao de DATABASE_URL em runtime

Em [`apps/api/src/main.ts`](../apps/api/src/main.ts):
- `NODE_ENV=development` sem `DATABASE_URL` -> usa `file:./dev.db`
- `NODE_ENV!=development` sem `DATABASE_URL` e com `DATABASE_URL_PROD` -> aponta para `DATABASE_URL_PROD`

### 4.4 Observacao critica

Existe divergencia real entre `schema.prisma` (dev) e `schema.prod.prisma` (prod), especialmente no modelo `Customer` (campos Uber Direct e endereco expandido). As migracoes atuais tambem estao travadas como `provider = "sqlite"` em [`apps/api/prisma/migrations/migration_lock.toml`](../apps/api/prisma/migrations/migration_lock.toml). Isso aumenta risco de deploy em Postgres sem alinhar schema/migracoes primeiro.

## 5. Checklist Se Deu Ruim

### 5.1 Logs e processo

```bash
# logs da stack levantada via scripts/dev-all.sh
tail -f /tmp/querobroapp-api.log
tail -f /tmp/querobroapp-web.log

# matar tudo
./scripts/stop-all.sh
```

### 5.2 Health e verificacao rapida

```bash
curl -s http://127.0.0.1:3001/health
curl -s http://127.0.0.1:3001/products | head
curl -s http://127.0.0.1:3001/customers | head
```

Health endpoint:
- [`apps/api/src/app.controller.ts`](../apps/api/src/app.controller.ts)

### 5.3 Swagger

- Implementado em [`apps/api/src/main.ts`](../apps/api/src/main.ts)
- So sobe quando `ENABLE_SWAGGER=true`
- URL: `http://localhost:3001/docs`

### 5.4 Smoke de ponta a ponta

```bash
# sobe stack e roda smoke
./scripts/qa.sh

# smoke isolado (API ja rodando)
pnpm qa:smoke
```

## 6. Definicoes Canonicas De Dominio

Fonte primaria dos contratos: [`packages/shared/src/index.ts`](../packages/shared/src/index.ts)

| Conceito | Definicao atual no codigo | Status |
| --- | --- | --- |
| Produto / SKU | `Product` possui `id`, `name`, `category`, `unit`, `price`, `active`; nao ha campo `sku` explicito | Parcial |
| Cliente | `Customer` possui identificacao, contato e endereco expandido (inclui `placeId`, `lat`, `lng`, `deliveryNotes`) | Implementado |
| Pedido | `Order` possui `customerId`, `status`, `subtotal`, `discount`, `total`, `notes` | Implementado |
| Itens do pedido | `OrderItem` vincula `orderId`, `productId`, `quantity`, `unitPrice`, `total` | Implementado |
| Pagamento | `Payment` com `orderId`, `amount`, `method`, `status`, `paidAt`, `dueDate`, `providerRef` | Implementado (sem gateway) |
| Estoque (produto final) | `StockMovement` existe na API (`/stock-movements`) para produto | Implementado, pouco usado no Web |
| Estoque (insumo) / MOV | `InventoryItem` + `InventoryMovement` e consumo automatico por BOM nos pedidos | Implementado |
| Status de pedido | Enum: `ABERTO -> CONFIRMADO -> EM_PREPARACAO -> PRONTO -> ENTREGUE` (+ cancelamento em pontos permitidos) | Implementado |
| Status de pagamento | Enum: `PENDENTE`, `PAGO`, `CANCELADO` | Implementado |

Transicoes de status de pedido estao em [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts).
