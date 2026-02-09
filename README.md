# QuerobroApp Monorepo

Monorepo com Turborepo + pnpm:

- `apps/api`: NestJS + Prisma (Postgres)
- `apps/web`: Next.js + Tailwind + shadcn/ui
- `apps/mobile`: Expo React Native
- `packages/shared`: schemas e types com zod
- `packages/ui`: componentes compartilhados para web

## Requisitos

- Node.js 20+
- pnpm 9+
- Docker (para Postgres local)

## Setup local

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

3. Suba o Postgres:

```bash
docker compose up -d
```

4. Gere o client do Prisma:

```bash
pnpm --filter @querobroapp/api prisma:generate
```

5. Rode tudo:

```bash
pnpm dev
```

## Scripts

- `pnpm dev`: roda tudo em paralelo
- `pnpm build`: build de todos os pacotes
- `pnpm lint`: lint de todos os pacotes
- `pnpm typecheck`: typecheck de todos os pacotes

## URLs

- API Nest: `http://localhost:3001/health`
- Web: `http://localhost:3000`
- Expo: `http://localhost:8081` (default)

## Observacoes

- O Prisma usa `DATABASE_URL` em `apps/api/.env`.
- Para mudar a porta do Postgres, ajuste `.env` no root.
