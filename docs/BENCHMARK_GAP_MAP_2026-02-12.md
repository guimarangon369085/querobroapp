# Benchmark + Gap Map (2026-02-12)

## Objetivo
Mapear oportunidades de melhoria do QUEROBROApp comparando o estado atual com referencias publicas de apps/plataformas maduras em operacao, dados, UX, automacao e seguranca.

## Baseline atual (repositorio)
- Stack: Next.js 14 (web), NestJS (api), Prisma (SQLite dev / Postgres prod), Expo (mobile).
- Monorepo: turborrepo + pnpm.
- Builder modular ja existente (blocos theme/forms/home/integrations/layout).
- Integracao de cupom via endpoint `/receipts/ingest` com OCR multimodal e regras editaveis de mapeamento.
- Lint e typecheck: OK.
- Testes automatizados: praticamente inexistentes (comando `pnpm test` passa sem suite relevante).

## Benchmark externo usado
- InvenTree (MRP/estoque/BOM): foco forte em rastreabilidade, permissao e plugin.
- ERPNext Manufacturing: padrao para BOM, planejamento e fluxo de producao.
- Medusa/Vendure/Saleor: arquitetura modular e extensivel para dominio de operacao.
- Next.js/NestJS/Prisma docs: caching, seguranca e performance.
- OWASP API Top 10 + ASVS: baseline de seguranca para APIs de negocio.
- Stripe idempotency + Temporal/BullMQ/n8n: robustez em automacoes e fluxos assincronos.

## Gap map priorizado

### P0 (agora)
1. Seguranca de API e superficie publica
- Gap: sem autenticacao/autorizacao global na API; CORS muito basico; sem rate limit.
- Risco: abuso de endpoint, alteracao indevida de dados operacionais.
- Acao:
  - adicionar auth (JWT/session) + RBAC por modulo.
  - aplicar throttling por rota, principalmente `/receipts/*` e mutacoes de pedidos/estoque.
  - habilitar headers de seguranca (Helmet no Nest).

2. Integridade de dados em producao
- Gap: drift entre `apps/api/prisma/schema.prisma` e `apps/api/prisma/schema.prod.prisma`.
- Risco: migracao quebrar ou divergir comportamento dev/prod.
- Acao:
  - unificar schema ou gerar estrategia formal de dupla definicao com checks de diff.
  - padronizar enums e indices equivalentes.

3. Confiabilidade de automacao de cupom
- Gap: ingestao sem idempotency key; retries externos podem duplicar movimentos.
- Risco: estoque inflado por duplicidade de lancamento.
- Acao:
  - aceitar `idempotency-key` no endpoint `POST /receipts/ingest`.
  - salvar hash de requisicao + resultado e reaproveitar resposta para repeticoes.
  - log estruturado por `requestId` para auditoria.

4. Observabilidade minima
- Gap: logs sem padrao estruturado e sem metricas/traces.
- Risco: diagnostico lento em erro de producao.
- Acao:
  - logs JSON estruturados (request, latency, outcome).
  - metricas basicas (RPS, latencia p95, erro por endpoint).
  - tracing (OpenTelemetry) ao menos API -> DB -> OpenAI.

### P1 (proximo ciclo)
1. UX de navegacao e produtividade
- Ponto forte atual: ja existe `scrollToLayoutSlot` e foco por query `?focus=`.
- Oportunidade:
  - padronizar comportamento de "acao concluida" em todas as telas (sempre scroll + highlight do bloco destino).
  - adicionar "skip links" e atalhos de teclado para secoes principais.
  - adicionar `prefers-reduced-motion` para acessibilidade de animacoes.

2. Performance de leitura e lista
- Gap: carregamentos full-list em varias telas sem paginacao no backend.
- Risco: degradacao com crescimento de pedidos/movimentos.
- Acao:
  - paginacao + filtros server-side.
  - indices compostos para filtros mais usados (status, datas, customerId/orderId).
  - revisar queries com EXPLAIN ANALYZE no Postgres.

3. Pipeline de eventos operacional
- Gap: outbox existe para WhatsApp, mas sem worker robusto com retry/backoff/DLQ.
- Acao:
  - formalizar worker (BullMQ) para canais de integracao.
  - retries exponenciais + dead-letter queue + painel de reprocessamento.

4. Testes criticos de negocio
- Gap: falta cobertura de regras financeiras e estoque.
- Acao:
  - testes de contrato API e testes de servico para:
    - pagamentos parciais/quitacao.
    - consumo/estorno de estoque em mudanca de status/itens.
    - ingestao de cupom com regras habilitadas/desabilitadas.

### P2 (escala)
1. Arquitetura modular "LEGO" de verdade
- Evolucao: transformar blocos do Builder em "modulos com contrato" (manifest de bloco, schema, handlers e UI editor).
- Resultado: novos blocos sem tocar no core.

2. Camada de automacao visual para leigos
- Integrar "receitas de automacao" no Builder (gatilho -> transformacao -> acao) inspirado em n8n.
- Exemplo: NFC -> foto cupom -> OCR -> filtro ingredientes -> lancamento estoque -> notificacao.

3. Data platform operacional
- Criar trilha analitica dedicada (eventos + snapshots) separada de transacional.
- Permite dashboards tipo Looker Studio sem pesar operacao diaria.

4. Hardening de supply chain
- SAST/secret scanning/dependency review automáticos em PR.
- Scorecard e checklist de release segura.

## Melhor fluxo de trabalho entre IAs (recomendado)
1. ChatGPT Web/Mobile
- ideacao, refinamento de prompt de negocio, validacao de UX copy.

2. Codex Terminal (este ambiente)
- implementacao real em codigo, execucao de comandos, testes e migracoes.

3. GitHub Copilot
- assistencia pontual de autocomplete dentro do editor, sem autonomia de merge/deploy.

Regra operacional: somente 1 agente com permissao de "mudanca final" por vez (preferencia: Codex Terminal), para evitar drift de branch e alteracoes concorrentes nao rastreaveis.

## Plano de execucao recomendado

### Sprint A (seguranca + robustez)
- Auth + RBAC + rate limit + helmet.
- Idempotency em receipts ingest.
- Logs estruturados + requestId.

### Sprint B (dados + performance)
- Resolver drift prisma dev/prod.
- Paginacao e filtros server-side.
- Indices e tuning com EXPLAIN.

### Sprint C (experiencia + automacao)
- UX padrao de scroll/foco + reduced motion.
- Worker de outbox com retry/DLQ.
- Blocos de automacao no Builder.

## Fontes
- InvenTree repo: https://github.com/inventree/InvenTree
- InvenTree docs: https://docs.inventree.org/en/latest/
- ERPNext manufacturing: https://docs.frappe.io/erpnext/user/manual/en/manufacturing
- ERPNext BOM: https://docs.frappe.io/erpnext/user/manual/en/bill-of-materials
- Medusa modular architecture: https://docs.medusajs.com/learn/fundamentals/modules
- Medusa repo: https://github.com/medusajs/medusa
- Vendure repo: https://github.com/vendure-ecommerce/vendure
- Saleor repo: https://github.com/saleor/saleor
- Next.js data fetching: https://nextjs.org/docs/app/building-your-application/data-fetching
- Next.js caching: https://nextjs.org/docs/app/building-your-application/caching
- NestJS rate limiting: https://docs.nestjs.com/security/rate-limiting
- NestJS security: https://docs.nestjs.com/security
- Prisma performance: https://www.prisma.io/docs/orm/prisma-client/queries/query-optimization-performance
- PostgreSQL indexes: https://www.postgresql.org/docs/current/indexes.html
- PostgreSQL EXPLAIN: https://www.postgresql.org/docs/current/using-explain.html
- BullMQ retrying jobs: https://docs.bullmq.io/guide/retrying-failing-jobs
- n8n docs: https://docs.n8n.io/
- Temporal: https://temporal.io/
- OWASP API Security Top 10 (2023): https://owasp.org/API-Security/editions/2023/en/0x11-t10/
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- Stripe idempotency: https://docs.stripe.com/api/idempotent_requests
- OpenTelemetry docs: https://opentelemetry.io/docs/
- GitHub secret scanning: https://docs.github.com/en/code-security/secret-scanning/introduction/about-secret-scanning
