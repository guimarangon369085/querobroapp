# QUEROBROAPP

QUEROBROAPP e um sistema para organizar vendas, producao e estoque de broas.
A regra do produto e simples: complexidade no backend, tela clara para operacao do dia a dia.

## O que ja funciona

- Cadastro de produtos e sabores.
- Cadastro de clientes com telefone e endereco.
- Criacao de pedidos com itens, desconto e status.
- Pagamento parcial ou total com saldo automatico.
- Controle de estoque com movimentos manuais e consumo por ficha tecnica (BOM).
- Quadro D+1 para planejar faltas de insumos no proximo dia.
- Outbox de WhatsApp (fundacao pronta, envio real em etapa futura).
- Builder visual para ajustar layout, tema e regras sem alterar codigo.

## Fluxo diario (simples)

1. `Produtos`: cadastre o que voce vende.
2. `Clientes`: salve contato e endereco.
3. `Pedidos`: monte o pedido e avance status.
4. `Estoque`: veja D+1, lance movimentos e confira saldo.

## Arquitetura do projeto

- `apps/api`: NestJS + Prisma (API principal).
- `apps/web`: Next.js (ERP web).
- `apps/mobile`: Expo (app mobile).
- `packages/shared`: contratos Zod/TypeScript usados por web, api e mobile.
- `packages/ui`: componentes compartilhados.

## Subir localmente

### 1) Instalar

```bash
pnpm install
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/mobile/.env.example apps/mobile/.env
```

### 2) Preparar banco dev (SQLite)

```bash
pnpm --filter @querobroapp/api prisma:generate:dev
pnpm --filter @querobroapp/api prisma:migrate:dev
pnpm --filter @querobroapp/api prisma:seed
```

### 3) Rodar

```bash
pnpm dev
```

## URLs locais

- Web: `http://127.0.0.1:3000`
- API Health: `http://127.0.0.1:3001/health`
- Swagger (quando habilitado): `http://127.0.0.1:3001/docs`
- Builder: `http://127.0.0.1:3000/builder`

## Seguranca (resumo)

- Em dev, auth pode ficar desativada por padrao.
- Em producao, a API exige auth ativa (`APP_AUTH_ENABLED=true`) por padrao.
- Swagger em producao fica bloqueado por padrao.
- Existem scripts para scan de segredos, policy gate e hardening local/GitHub.

## Scripts principais

```bash
pnpm dev
pnpm lint
pnpm typecheck
pnpm test
pnpm check:prisma-drift
pnpm security:secrets
pnpm security:policy:diff
pnpm qa:smoke
```

## Endpoints principais da API

- `products`: CRUD + `GET /products/:id/bom`
- `customers`: CRUD
- `orders`: CRUD + itens + status + `mark-paid`
- `payments`: list/create/delete + `mark-paid`
- `inventory-items` e `inventory-movements`
- `boms` + bootstrap + combinacoes de sabores
- `production/requirements` (D+1)
- `receipts/*` (parse, ingest, notificacao, sync de custo)
- `builder/*` (config e imagens)
- `whatsapp/outbox`

## Mapa rapido para devs

- API bootstrap/env/security: `apps/api/src/main.ts`
- Modulos API: `apps/api/src/modules`
- Schema Prisma: `apps/api/prisma/schema.prisma`
- Telas web: `apps/web/src/app`
- Contratos compartilhados: `packages/shared/src/index.ts`

## Documentacao recomendada

- Visao tecnica: `docs/PROJECT_SNAPSHOT.md`
- Arquitetura: `docs/ARCHITECTURE.md`
- Proximos passos: `docs/NEXT_STEP_PLAN.md`
- Backlog: `docs/DELIVERY_BACKLOG.md`
- Seguranca de segredos: `docs/SECRETS_SECURITY_PROCEDURE.md`
- Atalho iOS de cupom: `docs/IOS_SHORTCUT_CUPOM.md`
