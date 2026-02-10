# NEXT_STEP_PLAN

## TOC
- [1. Escopo E Fontes](#1-escopo-e-fontes)
- [2. Estado Atual Validado](#2-estado-atual-validado)
- [3. Estrategia Local Vs Codigo](#3-estrategia-local-vs-codigo)
- [4. Cobertura Dos Blocos LEGO](#4-cobertura-dos-blocos-lego)
- [5. Lacunas Criticas Para MVP](#5-lacunas-criticas-para-mvp)
- [6. Prioridade Da Proxima Etapa](#6-prioridade-da-proxima-etapa)
- [7. Recomendacao De Push](#7-recomendacao-de-push)
- [8. Impedimentos Encontrados](#8-impedimentos-encontrados)

## 1. Escopo E Fontes

Fontes usadas nesta validacao:
- Repositorio local: `$HOME/querobroapp` (branch local `main`, com `ahead 2` em relacao a `origin/main`).
- GitHub API (`<owner>/querobroapp`):
  - repo id `1145500582`
  - default branch `main`
  - branches `main`, `codex/refine-layout-for-high-end-design`, `codex/redesign-app-layout-and-improve-ux`
- Codigo remoto validado por `origin/main`:
  - [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts)
  - [`apps/api/src/main.ts`](../apps/api/src/main.ts)
  - ausencia de `docs/` em `origin/main` (sem `PROJECT_SNAPSHOT` e `REPO_SCRAPE_REPORT` publicados)
- Documentos locais:
  - `QUEROBROAPP - Migrar app para GitHub.pdf`
  - `QUEROBROAPP - Arquitetura Plug&Play.pdf`
  - `QUEROBROAPP - Desenvolvimento App Chef Convex.pdf`
  - `ChatGPT - QUEROBROAPP*.pdf` (leitura parcial)
  - `QUERO BROA (1).xlsx`

## 2. Estado Atual Validado

### 2.1 Infra e monorepo

- Estrutura confirmada: `apps/api`, `apps/web`, `apps/mobile`, `packages/shared`, `packages/ui`.
- Orquestracao confirmada em [`pnpm-workspace.yaml`](../pnpm-workspace.yaml) e [`turbo.json`](../turbo.json).
- Scripts operacionais validados:
  - [`scripts/dev-all.sh`](../scripts/dev-all.sh)
  - [`scripts/stop-all.sh`](../scripts/stop-all.sh)
  - [`scripts/repo-scrape.sh`](../scripts/repo-scrape.sh)

### 2.2 API (Nest + Prisma)

- Modulos ativos: produtos, clientes, pedidos, pagamentos, estoque, inventario, BOM.
- Validacao de payload com Zod via `@querobroapp/shared`:
  - [`packages/shared/src/index.ts`](../packages/shared/src/index.ts)
- CORS/local env no codigo local:
  - [`apps/api/src/main.ts`](../apps/api/src/main.ts) com allowlist `127.0.0.1:3000` e `localhost:3000`
- Persistencia:
  - dev em SQLite [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma)
  - prod em Postgres [`apps/api/prisma/schema.prod.prisma`](../apps/api/prisma/schema.prod.prisma)
- Gap importante: drift entre schema dev e prod ainda existe.

### 2.3 Web ERP (Next.js App Router)

- Rotas ERP confirmadas:
  - `/dashboard`, `/produtos`, `/clientes`, `/pedidos`, `/estoque`
  - refs em [`apps/web/src/app`](../apps/web/src/app)
- Cliente HTTP local robustecido:
  - [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts)
  - fallback dev: `http://127.0.0.1:3001`
  - tratamento de erro com metodo/url/status
- Divergencia com remoto `main`:
  - `origin/main` ainda esta com `baseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'` e sem try/catch detalhado.

### 2.4 Mobile (Expo)

- Existe fluxo funcional basico em [`apps/mobile/App.tsx`](../apps/mobile/App.tsx):
  - dashboard, clientes, produtos, pedidos
- Ainda sem paridade com web:
  - sem estoque/BOM completo
  - sem fluxo financeiro completo
  - sem D+1

### 2.5 GitHub/branches e historico

- Branches `codex/refine-layout-for-high-end-design` e `codex/redesign-app-layout-and-improve-ux` estao atras de `main` no compare (ou seja, integradas).
- Local `main` contem dois commits ainda nao enviados ao remoto:
  - `docs: add project snapshot and repo scrape report`
  - `fix(web): handle api fetch errors and align api base url`

## 3. Estrategia Local Vs Codigo

### 3.1 O que os documentos pedem

Dos PDFs locais, a estrategia canônica converge em:
- app em blocos LEGO: `Dados -> Catalogo -> Pedido -> Itens -> Calculo -> Estados -> Producao D+1 -> Financeiro -> WhatsApp`
- operacao D+1 com catalogo variavel
- integracao futura de WhatsApp e pagamento (incluindo PIX)
- evolucao modular para nao travar MVP

### 3.2 O que a planilha mostra

Arquivo `QUERO BROA (1).xlsx`:
- abas de custo e operacao confirmadas:
  - `Custos`: custo por insumo com base em embalagem e consumo de receita
  - `NF_RAW`: estrutura pronta para ingestao fiscal (`timestamp`, `chave_acesso`, `valor_total`, `itens_descricao`, `raw_text`)
  - `CONSUMO` e `ESTOQUE`: tabela temporal por data/insumo (nao existe aba literal `ESTOQUE/CONSUMO`; estao separadas)
- implicacao pratica:
  - o dominio de custos/consumo existe no dado operacional, mas ainda nao esta fechado ponta a ponta no backend para planejamento D+1 e financeiro.

### 3.3 Convex/Vite

- `QUEROBROAPP - Desenvolvimento App Chef Convex.pdf` indica tentativa paralela (Convex/Vite/Auth) como trilha experimental.
- O repositorio atual em producao de codigo e Nest/Next/Prisma; Convex nao e o core atual.

## 4. Cobertura Dos Blocos LEGO

| Bloco | Estado atual no codigo | Evidencia | Status |
| --- | --- | --- | --- |
| Dados | Entidades core existem; migrations e schemas em uso | [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma) | Parcial |
| Catalogo | CRUD de produtos funcional; sem `sku` canonico | [`apps/api/src/modules/products`](../apps/api/src/modules/products), [`apps/web/src/app/produtos/page.tsx`](../apps/web/src/app/produtos/page.tsx) | Parcial |
| Pedido | Criacao/listagem e CRUD basico implementados | [`apps/api/src/modules/orders`](../apps/api/src/modules/orders), [`apps/web/src/app/pedidos/page.tsx`](../apps/web/src/app/pedidos/page.tsx) | Implementado |
| Itens | Add/remove de itens por pedido implementado | [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts) | Implementado |
| Calculo | subtotal/discount/total existem; ainda ha pontos de endurecimento | [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts) | Parcial |
| Estados | Maquina de status implementada | [`packages/shared/src/index.ts`](../packages/shared/src/index.ts), [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts) | Implementado |
| Producao D+1 | BOM + consumo por pedido existe, sem agenda D+1 formal | [`apps/api/src/modules/bom`](../apps/api/src/modules/bom), [`apps/api/src/modules/inventory`](../apps/api/src/modules/inventory) | Parcial |
| Financeiro | Payments existe, conciliacao incompleta | [`apps/api/src/modules/payments`](../apps/api/src/modules/payments), [`apps/web/src/app/pedidos/page.tsx`](../apps/web/src/app/pedidos/page.tsx) | Parcial |
| WhatsApp | Sem modulo, sem webhook, sem outbox | inexistente no backend atual | Ausente |

## 5. Lacunas Criticas Para MVP

| Lacuna | Impacto | Probabilidade | Arquivos-alvo |
| --- | --- | --- | --- |
| Drift Prisma dev/prod | Alto (risco de deploy) | Alta | [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma), [`apps/api/prisma/schema.prod.prisma`](../apps/api/prisma/schema.prod.prisma) |
| Regras de financeiro incompletas (saldo pago vs total) | Alto | Media | [`apps/api/src/modules/payments/payments.service.ts`](../apps/api/src/modules/payments/payments.service.ts) |
| D+1 sem entidade/visao operacional formal | Alto | Media | `orders + inventory + bom modules` |
| Falta de trilha de WhatsApp (roadmap) | Medio/Alto | Alta | novo modulo API |
| Testes automatizados insuficientes para fluxo core | Alto | Alta | monorepo |
| Divergencia local vs remoto no hardening API/Web | Medio | Alta | [`apps/web/src/lib/api.ts`](../apps/web/src/lib/api.ts), [`apps/api/src/main.ts`](../apps/api/src/main.ts) |

## 6. Prioridade Da Proxima Etapa

Sequencia proposta para iniciar desenvolvimento imediatamente:

1. Publicar baseline tecnico no remoto (`main`)
- Incluir commits locais ja prontos (`docs` + fix de `baseUrl/CORS/apiFetch`) para alinhar equipe e evitar retrabalho.

2. Fechar bloco MVP de `Pedido + Itens + Calculo + Estados`
- Endurecer regras server-side de totalizacao e transicoes.
- Garantir cenarios de erro e regressao com testes minimos API.

3. Fechar bloco `Financeiro` acoplado ao pedido
- Regra de conciliacao: soma de pagamentos nao ultrapassa total.
- Expor status financeiro derivado no pedido (pendente/parcial/pago).

4. Entregar `Producao D+1` operacional
- Criar endpoint de necessidade por item baseado em pedidos abertos + BOM.
- Exibir no web em `/estoque` como quadro de producao do proximo dia.

5. Preparar fundacao de `WhatsApp` sem travar MVP
- Criar outbox/evento de mensagens por mudanca de status.
- Deixar provider de envio para fase seguinte.

## 7. Recomendacao De Push

Documentos locais valiosos ainda fora do remoto:
- [`docs/PROJECT_SNAPSHOT.md`](./PROJECT_SNAPSHOT.md)
- [`docs/REPO_SCRAPE_REPORT.md`](./REPO_SCRAPE_REPORT.md)
- [`docs/DELIVERY_BACKLOG.md`](./DELIVERY_BACKLOG.md)
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`docs/NEXT_STEP_PLAN.md`](./NEXT_STEP_PLAN.md)

Recomendacao: publicar esses docs no GitHub para virar base oficial de onboarding e execucao.

## 8. Impedimentos Encontrados

- Leitor PDF indicado (`http://localhost:8451/`) indisponivel no momento da analise (`connection refused`).
- Parte dos PDFs de chat esta em formato com baixa extraibilidade textual (conteudo escaneado/imagem), entao a leitura foi parcial.
- GitHub API teve oscilacao pontual de DNS durante uma das consultas; validacao foi complementada com refs locais `origin/*`.
