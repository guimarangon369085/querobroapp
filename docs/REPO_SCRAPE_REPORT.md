# REPO_SCRAPE_REPORT

## TOC
- [1. Escopo E Metodo](#1-escopo-e-metodo)
- [2. Inventario Tecnico](#2-inventario-tecnico)
- [3. Mapa Estrutural Do Web](#3-mapa-estrutural-do-web)
- [4. Mapa Estrutural Da API](#4-mapa-estrutural-da-api)
- [5. Estado Do Mobile](#5-estado-do-mobile)
- [6. Scrape De Dominio: Cobertura Vs Lacunas](#6-scrape-de-dominio-cobertura-vs-lacunas)
- [7. Debitos Tecnicos E Anti-patterns](#7-debitos-tecnicos-e-anti-patterns)
- [8. Top 10 Riscos De Entrega](#8-top-10-riscos-de-entrega)
- [9. Top 20 Oportunidades](#9-top-20-oportunidades)
- [10. Recomendacoes Objetivas](#10-recomendacoes-objetivas)
- [11. Resultado Das Checagens Leves](#11-resultado-das-checagens-leves)

## 1. Escopo E Metodo

Scraping executado localmente em `$HOME/querobroapp` com:
- inventario de arquivos e manifests
- mapeamento de rotas web (App Router)
- mapeamento de controllers/services da API
- mapeamento de schemas Prisma e Zod
- varredura de TODO/FIXME/HACK/XXX e referencias de env/token (sem expor valores)
- checagens leves de lint/test/prisma

Evidencias brutas salvas em `/tmp/querobroapp-scrape/` nesta execucao.

## 2. Inventario Tecnico

### 2.1 Estrutura de monorepo

- `apps/api`: backend Nest + Prisma
- `apps/web`: frontend Next.js (App Router)
- `apps/mobile`: app Expo React Native
- `packages/shared`: contratos de dominio (Zod + types)
- `packages/ui`: componentes compartilhados base
- `scripts/`: automacoes locais (`dev-all`, `stop-all`, `qa`, `push-all`)

Workspace/pipeline:
- [`pnpm-workspace.yaml`](../pnpm-workspace.yaml)
- [`turbo.json`](../turbo.json)

### 2.2 Bibliotecas criticas (stack real)

| Camada | Bibliotecas chave | Evidencia |
| --- | --- | --- |
| API | `@nestjs/*`, `@prisma/client`, `prisma`, `zod` | [`apps/api/package.json`](../apps/api/package.json) |
| Web | `next@14`, `react`, `tailwindcss`, `lucide-react` | [`apps/web/package.json`](../apps/web/package.json) |
| Mobile | `expo@51`, `react-native@0.74`, `react` | [`apps/mobile/package.json`](../apps/mobile/package.json) |
| Shared | `zod` | [`packages/shared/package.json`](../packages/shared/package.json) |

### 2.3 Scripts e pipelines relevantes

| Contexto | Script | Observacao |
| --- | --- | --- |
| Dev local completo | [`scripts/dev-all.sh`](../scripts/dev-all.sh) | Build shared + migrate dev + sobe API/Web |
| Stop stack | [`scripts/stop-all.sh`](../scripts/stop-all.sh) | Mata processos e limpa portas |
| QA smoke | [`scripts/qa.sh`](../scripts/qa.sh), [`scripts/qa-smoke.mjs`](../scripts/qa-smoke.mjs) | Valida endpoints-chave |
| CI | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Instala, lint, typecheck, build |

## 3. Mapa Estrutural Do Web

### 3.1 Route map (App Router)

| Rota | Arquivo | Dados consumidos |
| --- | --- | --- |
| `/` | [`apps/web/src/app/page.tsx`](../apps/web/src/app/page.tsx) | estatico (links + galeria) |
| `/dashboard` | [`apps/web/src/app/dashboard/page.tsx`](../apps/web/src/app/dashboard/page.tsx) | `/products`, `/customers`, `/orders`, `/payments` |
| `/produtos` | [`apps/web/src/app/produtos/page.tsx`](../apps/web/src/app/produtos/page.tsx) | CRUD `/products` |
| `/clientes` | [`apps/web/src/app/clientes/page.tsx`](../apps/web/src/app/clientes/page.tsx) | CRUD `/customers`, Google Places |
| `/pedidos` | [`apps/web/src/app/pedidos/page.tsx`](../apps/web/src/app/pedidos/page.tsx) | `/orders`, `/payments`, `/customers`, `/products` |
| `/estoque` | [`apps/web/src/app/estoque/page.tsx`](../apps/web/src/app/estoque/page.tsx) | `/inventory-items`, `/inventory-movements`, `/boms`, `/products` |

### 3.2 Componentes globais relevantes

- Shell/layout: [`apps/web/src/app/layout.tsx`](../apps/web/src/app/layout.tsx)
- Nav lateral: [`apps/web/src/components/nav.tsx`](../apps/web/src/components/nav.tsx)
- Topbar contextual: [`apps/web/src/components/topbar.tsx`](../apps/web/src/components/topbar.tsx)
- Form helper: [`apps/web/src/components/form/FormField.tsx`](../apps/web/src/components/form/FormField.tsx)
- Tema e tokens: [`apps/web/src/app/globals.css`](../apps/web/src/app/globals.css)

### 3.3 Cliente API e integracoes externas

- Cliente HTTP unificado: [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts)
- Base URL: `NEXT_PUBLIC_API_URL`
- Google Places no cadastro de cliente: [`apps/web/src/lib/googleMaps.ts`](../apps/web/src/lib/googleMaps.ts), [`apps/web/src/app/clientes/page.tsx`](../apps/web/src/app/clientes/page.tsx)

## 4. Mapa Estrutural Da API

### 4.1 Modulos ativos

| Modulo | Controller | Service | Rotas principais |
| --- | --- | --- | --- |
| Products | [`products.controller.ts`](../apps/api/src/modules/products/products.controller.ts) | [`products.service.ts`](../apps/api/src/modules/products/products.service.ts) | `/products` |
| Customers | [`customers.controller.ts`](../apps/api/src/modules/customers/customers.controller.ts) | [`customers.service.ts`](../apps/api/src/modules/customers/customers.service.ts) | `/customers` |
| Orders | [`orders.controller.ts`](../apps/api/src/modules/orders/orders.controller.ts) | [`orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts) | `/orders`, itens, status |
| Payments | [`payments.controller.ts`](../apps/api/src/modules/payments/payments.controller.ts) | [`payments.service.ts`](../apps/api/src/modules/payments/payments.service.ts) | `/payments` |
| Stock | [`stock.controller.ts`](../apps/api/src/modules/stock/stock.controller.ts) | [`stock.service.ts`](../apps/api/src/modules/stock/stock.service.ts) | `/stock-movements` |
| Inventory | [`inventory.controller.ts`](../apps/api/src/modules/inventory/inventory.controller.ts) | [`inventory.service.ts`](../apps/api/src/modules/inventory/inventory.service.ts) | `/inventory-items`, `/inventory-movements` |
| BOM | [`bom.controller.ts`](../apps/api/src/modules/bom/bom.controller.ts) | [`bom.service.ts`](../apps/api/src/modules/bom/bom.service.ts) | `/boms` |

Composicao em [`apps/api/src/app.module.ts`](../apps/api/src/app.module.ts).

### 4.2 Validacao e normalizacao

- Contratos validados com Zod em controllers/services, baseados em `@querobroapp/shared`.
- Helper de parse: [`apps/api/src/common/validation.ts`](../apps/api/src/common/validation.ts)
- Normalizacao textual/telefone/money: [`apps/api/src/common/normalize.ts`](../apps/api/src/common/normalize.ts)

Observacao: nao ha DTOs class-validator nem pipe global; a validacao e feita manualmente por rota.

### 4.3 Prisma, modelos e migracoes

- Schema dev: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)
- Schema prod: [`apps/api/prisma/schema.prod.prisma`](../apps/api/prisma/schema.prod.prisma)
- Seed: [`apps/api/prisma/seed.ts`](../apps/api/prisma/seed.ts)
- Migracoes: [`apps/api/prisma/migrations`](../apps/api/prisma/migrations)
- Lock de provider: [`apps/api/prisma/migrations/migration_lock.toml`](../apps/api/prisma/migrations/migration_lock.toml) (`sqlite`)

## 5. Estado Do Mobile

Status atual: funcional para operacao basica, sem paridade completa com Web.

Cobertura real:
- tabs: dashboard, clientes, produtos, pedidos
- CRUD clientes/produtos
- criacao de pedidos com itens/discount/notes

Referencias:
- UI e fluxo: [`apps/mobile/App.tsx`](../apps/mobile/App.tsx)
- cliente API: [`apps/mobile/src/lib/api.ts`](../apps/mobile/src/lib/api.ts)

Lacunas no mobile vs web:
- sem modulo de estoque/BOM
- sem pagamentos por pedido
- sem transicao de status do pedido
- sem autocomplete de endereco/Google

## 6. Scrape De Dominio: Cobertura Vs Lacunas

### 6.1 Entidades existentes (Prisma)

Modelos atuais:
- `Customer`, `Product`, `Order`, `OrderItem`, `Payment`
- `StockMovement`, `InventoryItem`, `InventoryMovement`
- `Bom`, `BomItem`

Fonte: [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)

### 6.2 Comparacao com dominio alvo (ERP + pedidos/pagamentos + WhatsApp)

| Dominio desejado | Cobertura atual | Lacuna pratica |
| --- | --- | --- |
| Produto/SKU | Produto existe | Sem campo `sku` canonico, sem unicidade SKU |
| Cliente | Forte cobertura (inclusive campos Uber) | Sem validacao de CEP/UF consistente no backend |
| Pedido/Itens | Implementado com status e itens | `update` permite alterar subtotal/total manualmente |
| Pagamento | Entidade e rotas existem | Sem reconciliacao financeira, sem gateway, sem regra de fechamento |
| Estoque/MOV | Inventario e consumo por BOM estao ativos | Duas trilhas (`stock_movement` e `inventory_movement`) com acoplamento parcial |
| Status machine | Existe em OrdersService | Nao cobre regras de pagamento/expedicao integradas |
| Producao D+1 | Parcial (BOM/capacidade) | Sem entidade/plano de producao por data |
| WhatsApp | Nao implementado | Sem modulo de mensageria, sem webhooks, sem fila |

## 7. Debitos Tecnicos E Anti-patterns

### 7.1 Achados de varredura

- `git grep TODO|FIXME|HACK|XXX`: sem TODOs reais de codigo de negocio; apenas ocorrencias em filtros (`TODOS`) e lockfile.
- `git grep` de referencias de segredo/env: referencias corretas em exemplos e codigo, sem dump de valor secreto no repo versionado.

### 7.2 Debitos principais

| Tipo | Evidencia | Impacto |
| --- | --- | --- |
| Drift de schema dev/prod | [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma) vs [`apps/api/prisma/schema.prod.prisma`](../apps/api/prisma/schema.prod.prisma) | Alto risco de quebra em deploy prod |
| Migrations amarradas em sqlite | [`apps/api/prisma/migrations/migration_lock.toml`](../apps/api/prisma/migrations/migration_lock.toml) | pipeline Postgres inconsistente |
| Sem testes automatizados de produto | ausencia de testes de app/api (apenas smoke script) | regressao silenciosa |
| Lint quebrado em workspaces sem arquivos alvo | `pnpm -r lint` falhou com "No files matching pattern" | CI/local com sinal falso/instavel |
| Fluxo financeiro frouxo | [`apps/api/src/modules/payments/payments.service.ts`](../apps/api/src/modules/payments/payments.service.ts) | pagamento sem reconciliacao de saldo do pedido |
| Integridade de totais | [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts) (`update`) | total/subtotal podem divergir dos itens |
| Calculo de saldo no frontend dependente de ordenacao | [`apps/web/src/app/estoque/page.tsx`](../apps/web/src/app/estoque/page.tsx) (balanco por loop em movimentos desc) | saldo exibido pode ficar incorreto |
| Swagger condicional e README pouco explicito | [`apps/api/src/main.ts`](../apps/api/src/main.ts), [`README.md`](../README.md) | troubleshooting mais lento |
| Codigo legado paralelo (Express antigo) | [`src/server.js`](../src/server.js), [`src/db.js`](../src/db.js) | confusao arquitetural |
| Duplicacao de utilitarios web/mobile | [`apps/web/src/lib/format.ts`](../apps/web/src/lib/format.ts), [`apps/mobile/src/lib/format.ts`](../apps/mobile/src/lib/format.ts) | manutencao duplicada |

## 8. Top 10 Riscos De Entrega

| # | Risco | Impacto | Probabilidade | Mitigacao objetiva | Arquivos afetados |
| --- | --- | --- | --- | --- | --- |
| 1 | Deploy prod falhar por drift Prisma dev/prod | Alto | Alta | unificar schema e gerar trilha de migracao Postgres valida | [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma), [`apps/api/prisma/schema.prod.prisma`](../apps/api/prisma/schema.prod.prisma), [`apps/api/prisma/migrations`](../apps/api/prisma/migrations) |
| 2 | Migrate prod incompativel por lock sqlite | Alto | Alta | criar projeto de migracoes provider `postgresql` | [`apps/api/prisma/migrations/migration_lock.toml`](../apps/api/prisma/migrations/migration_lock.toml) |
| 3 | Totais financeiros inconsistentes em pedidos | Alto | Media | recalcular total no backend a partir dos itens em qualquer alteracao | [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts) |
| 4 | Pagamentos sem reconciliacao de saldo | Alto | Media | validar soma paga <= total e status financeiro do pedido | [`apps/api/src/modules/payments/payments.service.ts`](../apps/api/src/modules/payments/payments.service.ts), [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts) |
| 5 | Saldo de inventario exibido incorreto no web | Medio/Alto | Media | mover calculo de saldo para API (ordem cronologica/campos consolidados) | [`apps/web/src/app/estoque/page.tsx`](../apps/web/src/app/estoque/page.tsx), [`apps/api/src/modules/inventory/inventory.service.ts`](../apps/api/src/modules/inventory/inventory.service.ts) |
| 6 | Sem auth/autorizacao para ERP | Alto | Media | adicionar auth basica (JWT/session) + perfis | [`apps/api/src/main.ts`](../apps/api/src/main.ts), modulos API |
| 7 | Cobertura de testes insuficiente para releases | Alto | Alta | criar suite minima API + web critical paths | monorepo inteiro |
| 8 | Lint atual gera falha por configuracao, nao por bug real | Medio | Alta | ajustar scripts `lint` por workspace (globs corretos) | `package.json` dos workspaces |
| 9 | UX de operacao critica sem estados de carregamento/erro completos | Medio | Media | padronizar estados async e mensagens por modulo | [`apps/web/src/app/*/page.tsx`](../apps/web/src/app) |
| 10 | Roadmap WhatsApp sem fundacao tecnica (fila/webhooks/eventos) | Alto | Alta | definir arquitetura de integracao (outbox + webhook + retry) | novo modulo API + workers |

## 9. Top 20 Oportunidades

### 9.1 Categoria 1: Entrega funcional (MVP)

| Prioridade | Oportunidade | Esforco | Impacto | Arquivos afetados |
| --- | --- | --- | --- | --- |
| P0 | Introduzir `sku` unico em produto | M | Alto | [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma), [`packages/shared/src/index.ts`](../packages/shared/src/index.ts), [`apps/web/src/app/produtos/page.tsx`](../apps/web/src/app/produtos/page.tsx) |
| P0 | Travar recalculo de pedido por itens (backend source of truth) | M | Alto | [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts) |
| P0 | Regras de conciliacao pagamento x pedido | M | Alto | [`apps/api/src/modules/payments/payments.service.ts`](../apps/api/src/modules/payments/payments.service.ts) |
| P1 | Status operacional e financeiro desacoplados (pedido vs pagamento) | M | Alto | `Order`/`Payment` schema + services |
| P1 | Planejamento de producao D+1 (entidade simples + tela) | M | Alto | API + [`apps/web/src/app/estoque/page.tsx`](../apps/web/src/app/estoque/page.tsx) |

### 9.2 Categoria 2: Confiabilidade/observabilidade

| Prioridade | Oportunidade | Esforco | Impacto | Arquivos afetados |
| --- | --- | --- | --- | --- |
| P0 | Healthcheck com dependencia de DB (readiness real) | S | Alto | [`apps/api/src/app.controller.ts`](../apps/api/src/app.controller.ts), [`apps/api/src/prisma.service.ts`](../apps/api/src/prisma.service.ts) |
| P0 | Erros padronizados e codigos de negocio consistentes | M | Alto | controllers/services API |
| P1 | Log estruturado com correlation id | M | Medio/Alto | [`apps/api/src/main.ts`](../apps/api/src/main.ts) + middlewares |
| P1 | Retry/compensacao para movimentos de inventario em fluxos criticos | M | Alto | [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts) |

### 9.3 Categoria 3: Performance

| Prioridade | Oportunidade | Esforco | Impacto | Arquivos afetados |
| --- | --- | --- | --- | --- |
| P1 | Endpoints agregados para dashboard (evitar N chamadas) | M | Medio | API dashboard endpoint + [`apps/web/src/app/dashboard/page.tsx`](../apps/web/src/app/dashboard/page.tsx) |
| P2 | Cache de leituras estaveis (catalogo/clientes) no web | S | Medio | [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts), paginas web |

### 9.4 Categoria 4: Seguranca

| Prioridade | Oportunidade | Esforco | Impacto | Arquivos afetados |
| --- | --- | --- | --- | --- |
| P0 | Autenticacao e autorizacao por perfil | M | Alto | API e Web |
| P1 | Rate limit e protecao de abuso | S | Medio/Alto | [`apps/api/src/main.ts`](../apps/api/src/main.ts) |
| P1 | Hardening de CORS para dominios permitidos | S | Medio | [`apps/api/src/main.ts`](../apps/api/src/main.ts) |

### 9.5 Categoria 5: DX (developer experience)

| Prioridade | Oportunidade | Esforco | Impacto | Arquivos afetados |
| --- | --- | --- | --- | --- |
| P0 | Corrigir `lint` por workspace e adicionar `test` script canônico | S | Alto | `package.json` raiz e workspaces |
| P1 | Consolidar utilitarios de formatacao no `packages/shared` | S | Medio | [`packages/shared/src/index.ts`](../packages/shared/src/index.ts), web/mobile libs |

### 9.6 Categoria 6: UX/UI (web)

| Prioridade | Oportunidade | Esforco | Impacto | Arquivos afetados |
| --- | --- | --- | --- | --- |
| P1 | Feedback assíncrono padronizado (loading/success/error toasts) | S | Medio | paginas em [`apps/web/src/app`](../apps/web/src/app) |
| P2 | Filtros persistentes por rota (URL state) | M | Medio | `pedidos`, `produtos`, `clientes` pages |

### 9.7 Categoria 7: Integracao WhatsApp/pagamentos

| Prioridade | Oportunidade | Esforco | Impacto | Arquivos afetados |
| --- | --- | --- | --- | --- |
| P0 | Outbox de mensagens + webhook receiver para WhatsApp | L | Alto | novo modulo API (`modules/whatsapp`) + DB |
| P1 | Camada de provider de pagamento (PIX/card) com `providerRef` real | L | Alto | [`apps/api/src/modules/payments/payments.service.ts`](../apps/api/src/modules/payments/payments.service.ts), schema payment |

## 10. Recomendacoes Objetivas

Ordem recomendada (o que fazer primeiro e por que):

1. **Corrigir base de dados de producao (Prisma dev/prod + migracoes)**
   - remove risco de deploy quebrado e bloqueio de roadmap.
2. **Blindar integridade de pedido/pagamento**
   - reduz risco financeiro e inconsistencias visiveis ao cliente.
3. **Adicionar testes minimos de API para fluxo critico**
   - evita regressao em create order, status, pagamento, inventario.
4. **Padronizar observabilidade (health/readiness + logs estruturados)**
   - acelera suporte e depuracao em incidentes reais.
5. **Entrar no roadmap WhatsApp/pagamento com arquitetura de eventos (nao chamada direta)**
   - evita acoplamento e facilita retries/auditoria.

## 11. Resultado Das Checagens Leves

Checagens executadas:

- `pnpm -r lint` -> **falhou**
  - motivo: workspaces sem alvo de ESLint (`No files matching the pattern "." were found`) em `apps/mobile`, `packages/shared`, `packages/ui`.
- `pnpm -r test` -> **sem execucao efetiva de testes de produto**
  - nao ha suite de testes configurada nos workspaces de app.
- `pnpm --filter @querobroapp/api exec prisma validate` -> **ok** (`schema.prisma is valid`).
- `pnpm --filter @querobroapp/api prisma:generate:dev` -> **ok** (Prisma Client gerado).

Observacao sobre README:
- [`README.md`](../README.md) acerta no fluxo SQLite dev e Postgres prod em alto nivel.
- Porem, nao explicita que Swagger depende de `ENABLE_SWAGGER=true` (implementado em [`apps/api/src/main.ts`](../apps/api/src/main.ts)).
