# QuerobroApp Monorepo

Monorepo com Turborepo + pnpm:

- `apps/api`: NestJS + Prisma (SQLite em dev, Postgres em prod)
- `apps/web`: Next.js + Tailwind + shadcn/ui
- `apps/mobile`: Expo React Native
- `packages/shared`: schemas e types com zod
- `packages/ui`: componentes compartilhados para web

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
- `GET /payments`, `POST /payments`, `PATCH /payments/:id/mark-paid`
- `GET /stock-movements`, `POST /stock-movements`

## Observacoes

- Em desenvolvimento, o Prisma usa SQLite (`DATABASE_URL=file:./dev.db`).
- Em producao, use `DATABASE_URL_PROD` com Postgres e os scripts `prisma:*:prod`.
