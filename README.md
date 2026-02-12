# QUEROBROApp Monorepo

Monorepo com Turborepo + pnpm:

- `apps/api`: NestJS + Prisma (SQLite em dev, Postgres em prod)
- `apps/web`: Next.js + Tailwind + shadcn/ui
- `apps/mobile`: Expo React Native
- `packages/shared`: schemas e types com zod
- `packages/ui`: componentes compartilhados para web

## Fluxo operacional (MVP)

1. Cadastre **produtos/sabores** em `/produtos`.
2. Crie pedido em `/pedidos` com cliente + itens.
3. Abra o detalhe do pedido, ajuste status e registre pagamento.
4. Use o botao **Marcar pedido como pago** para quitar o saldo restante.

Convencao de dominio adotada:
- `sabor/variedade` e representado como `Product` no catalogo (categoria `Sabores`, ex.: `T/G/S/R/D`).

## Ficha tecnica (BOM)

- Ao criar um produto pela API (`POST /products`), a API cria automaticamente uma ficha tecnica (BOM) vazia.
- Endpoint para consultar/criar (backfill) a BOM padrao: `GET /products/:id/bom`.
- No Web, a lista de produtos tem acao **Ficha tecnica** que abre `/estoque?bomProductId=<id>` e pre-seleciona a BOM.

Links rapidos:
- `http://127.0.0.1:3000/produtos`
- `http://127.0.0.1:3000/estoque?bomProductId=<id>`

## Mobile (pagamentos)

O app mobile (`apps/mobile`) agora permite:
- ver detalhe do pedido (totais + itens + financeiro),
- registrar pagamento parcial,
- marcar pedido como pago (cria pagamento restante via API),
- navegar do pedido para o cliente (abre a aba Clientes com edicao).

## Onde mexer

- Dados (Prisma): `apps/api/prisma/schema.prisma`, `apps/api/prisma/seed.ts`
- Backend (Nest):
  - Produtos: `apps/api/src/modules/products`
  - Pedidos/itens/status: `apps/api/src/modules/orders`
  - Pagamentos: `apps/api/src/modules/payments`
  - Estoque/BOM/D+1: `apps/api/src/modules/inventory`, `apps/api/src/modules/bom`, `apps/api/src/modules/production`
- UI (Next):
  - Produtos/sabores: `apps/web/src/app/produtos/page.tsx`
  - Pedidos e pagamentos: `apps/web/src/app/pedidos/page.tsx`
  - Estoque e quadro D+1: `apps/web/src/app/estoque/page.tsx`

## Continuidade entre ChatGPT/Codex

Para manter contexto entre ChatGPT Online/Mobile e Codex Terminal/Cloud:

- contexto vivo: `docs/querobroapp-context.md`
- handoff de sessao: `docs/HANDOFF_TEMPLATE.md`
- historico de handoffs: `docs/HANDOFF_LOG.md`
- memoria consolidada: `docs/MEMORY_VAULT.md`
- prompts prontos: `docs/BOOTSTRAP_PROMPTS.md`
- releitura rapida no terminal: `scripts/relearn-context.sh`

Regra pratica: cada sessao termina com handoff preenchido e proximo passo objetivo.

## Requisitos

- Node.js 20+
- pnpm 9+
- Docker (opcional, apenas para Postgres local)

## Setup local (SQLite)

1. Instale dependencias:

```bash
pnpm install
```

2. Copie os envs:

```bash
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/mobile/.env.example apps/mobile/.env
```

3. Gere o client do Prisma, rode migracao e seed:

```bash
pnpm --filter @querobroapp/api prisma:generate:dev
pnpm --filter @querobroapp/api prisma:migrate:dev
pnpm --filter @querobroapp/api prisma:seed
```

O seed e idempotente e cria dados de exemplo:
- produtos e sabores de broa,
- clientes,
- pedidos com cenarios `PENDENTE`, `PARCIAL` e `PAGO`.

4. Rode tudo:

```bash
pnpm dev
```

## Setup local (Postgres)

1. Suba o Postgres:

```bash
docker compose up -d
```

2. Ajuste `DATABASE_URL_PROD` em `apps/api/.env` e rode:

```bash
pnpm --filter @querobroapp/api prisma:generate:prod
pnpm --filter @querobroapp/api prisma:migrate:prod
```

## Scripts

- `pnpm dev`: roda tudo em paralelo
- `pnpm build`: build de todos os pacotes
- `pnpm lint`: lint de todos os pacotes
- `pnpm typecheck`: typecheck de todos os pacotes

## URLs

- API Nest: `http://localhost:3001/health`
- Swagger: `http://localhost:3001/docs`
- Web: `http://localhost:3000`
- Expo: `http://localhost:8081` (default)

## API (resumo)

- `GET /products`, `POST /products`, `GET /products/:id`, `PUT /products/:id`, `DELETE /products/:id`
- `GET /customers`, `POST /customers`, `GET /customers/:id`, `PUT /customers/:id`, `DELETE /customers/:id`
- `GET /orders`, `POST /orders`, `GET /orders/:id`, `PUT /orders/:id`, `DELETE /orders/:id`
- `POST /orders/:id/items`, `DELETE /orders/:id/items/:itemId`, `PATCH /orders/:id/status`
- `PATCH /orders/:id/mark-paid`
- `GET /products/:id/bom`
- `GET /payments`, `POST /payments`, `PATCH /payments/:id/mark-paid`
- `GET /stock-movements`, `POST /stock-movements`

## Observacoes

- Em desenvolvimento, o Prisma usa SQLite (`DATABASE_URL=file:./dev.db`).
- Em producao, use `DATABASE_URL_PROD` com Postgres e os scripts `prisma:*:prod`.
