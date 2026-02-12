# Quero Bro App

Aplicativo para gestão da **produção e venda de broas**, sincronizado com TypeScript.

> Observação de contexto: "Bro" no nome do projeto é abreviação/brincadeira de **Broa + App**.

Monorepo com Turborepo + pnpm:

- `apps/api`: NestJS + Prisma (SQLite em dev, Postgres em prod)
- `apps/web`: Next.js + Tailwind + shadcn/ui
- `apps/mobile`: Expo React Native
- `packages/shared`: schemas e types com zod
- `packages/ui`: componentes compartilhados para web

## Instalação e uso

1. Clone o repositório:

```bash
git clone https://github.com/guimarangon369085/querobroapp.git
cd querobroapp
```

2. Instale dependências:

```bash
pnpm install
```

3. Inicie o app:

```bash
pnpm dev
```

## Tecnologias usadas

- TypeScript
- Node.js
- NestJS
- Next.js
- Expo React Native
- Prisma
- Turborepo
- pnpm

## Fluxo operacional (MVP)

1. Cadastre **produtos/sabores** em `/produtos`.
2. Crie pedido em `/pedidos` com cliente + itens.
3. Abra o detalhe do pedido, ajuste status e registre pagamento.
4. Use o botão **Marcar pedido como pago** para quitar o saldo restante.

Convenção de domínio adotada:
- `sabor/variedade` é representado como `Product` no catálogo (categoria `Sabores`, ex.: `T/G/S/R/D`).

## Ficha técnica (BOM)

- Ao criar um produto pela API (`POST /products`), a API cria automaticamente uma ficha técnica (BOM) vazia.
- Endpoint para consultar/criar (backfill) a BOM padrão: `GET /products/:id/bom`.
- No Web, a lista de produtos tem ação **Ficha técnica** que abre `/estoque?bomProductId=<id>` e pré-seleciona a BOM.

Links rápidos:
- `http://127.0.0.1:3000/produtos`
- `http://127.0.0.1:3000/estoque?bomProductId=<id>`

## Mobile (pagamentos)

O app mobile (`apps/mobile`) permite:
- ver detalhe do pedido (totais + itens + financeiro),
- registrar pagamento parcial,
- marcar pedido como pago (cria pagamento restante via API),
- navegar do pedido para o cliente (abre a aba Clientes com edição).

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
- handoff de sessão: `docs/HANDOFF_TEMPLATE.md`
- histórico de handoffs: `docs/HANDOFF_LOG.md`
- memória consolidada: `docs/MEMORY_VAULT.md`
- prompts prontos: `docs/BOOTSTRAP_PROMPTS.md`
- releitura rápida no terminal: `scripts/relearn-context.sh`
- salvar handoff automaticamente: `scripts/save-handoff.sh`
- integração iOS de cupom fiscal: `docs/IOS_SHORTCUT_CUPOM.md`
- setup rápido do Atalhos (IP/URL): `scripts/shortcut-receipts-setup.sh`
- teste local com imagem de cupom: `scripts/test-receipt-image.sh`

Regra prática: cada sessão termina com handoff preenchido e próximo passo objetivo.

Uso rápido:

```bash
# modo interativo (recomendado)
./scripts/save-handoff.sh

# modo não interativo (exemplo)
HANDOFF_OBJETIVO="Encerramento da sessão" \
HANDOFF_RESULTADO="Handoff registrado" \
HANDOFF_PENDENTE="Nenhum" \
HANDOFF_DECISOES="Manter fluxo de handoff" \
HANDOFF_BLOQUEIOS="Nenhum" \
HANDOFF_PROXIMO_PASSO="Retomar do próximo item" \
./scripts/save-handoff.sh
```

## Requisitos

- Node.js 20+
- pnpm 9+
- Docker (opcional, apenas para Postgres local)

## Setup local (SQLite)

1. Instale dependências:

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

3. Gere o client do Prisma, rode migração e seed:

```bash
pnpm --filter @querobroapp/api prisma:generate:dev
pnpm --filter @querobroapp/api prisma:migrate:dev
pnpm --filter @querobroapp/api prisma:seed
```

O seed é idempotente e cria dados de exemplo:
- produtos e sabores de broa,
- clientes,
- pedidos com cenários `PENDENTE`, `PARCIAL` e `PAGO`.

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
- `pnpm test`: roda os testes existentes nos workspaces

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
- `POST /receipts/parse` (extração de cupom fiscal para linhas `;` no Numbers)
- `POST /receipts/parse-clipboard` (retorna apenas texto pronto para colar no Numbers)
  - requer `OPENAI_API_KEY` na API
  - opcional: `RECEIPTS_API_TOKEN` + header `x-receipts-token`

## Observações

- Em desenvolvimento, o Prisma usa SQLite (`DATABASE_URL=file:./dev.db`).
- Em produção, use `DATABASE_URL_PROD` com Postgres e os scripts `prisma:*:prod`.
