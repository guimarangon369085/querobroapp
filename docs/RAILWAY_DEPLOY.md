# Railway Deploy

## Objetivo

Subir o mesmo app em producao com:

- `querobroa.com.br` e `www.querobroa.com.br` abrindo a landing publica da marca
- `/pedido` como captura publica
- `/pedidos` como base operacional no mesmo deploy
- `ops.querobroa.com.br` opcional apontando para o mesmo `web`, abrindo direto em `Pedidos`
- `api.querobroa.com.br` para a API

## Stack recomendada

- Railway `web`: Next.js do monorepo usando [Dockerfile.web](/Users/gui/querobroapp/Dockerfile.web)
- Railway `api`: Nest + Prisma usando [Dockerfile.api](/Users/gui/querobroapp/Dockerfile.api)
- Railway Postgres: banco principal
- Railway Volume na `api`: montar em `/data`

## Dominios

- Publico principal: `querobroa.com.br`
- Alias publico: `www.querobroa.com.br`
- Operacao opcional: `ops.querobroa.com.br`
- API: `api.querobroa.com.br`

## Comportamento do web

- `querobroa.com.br/` abre a landing publica
- `www.querobroa.com.br/` abre a mesma landing publica
- `querobroa.com.br/pedido` e `www.querobroa.com.br/pedido` abrem a captura publica
- `querobroa.com.br/pedidos` e `www.querobroa.com.br/pedidos` abrem a operacao
- `ops.querobroa.com.br/` redireciona para `/pedidos`
- qualquer host continua podendo acessar tanto `/pedido` quanto `/pedidos`

Esse comportamento usa [page.tsx](/Users/gui/querobroapp/apps/web/src/app/page.tsx) e [public-site-config.ts](/Users/gui/querobroapp/apps/web/src/lib/public-site-config.ts).

## Servico web no Railway

Deploy do repositório usando:

- Root Directory: repo root
- Builder: Dockerfile
- Dockerfile Path: `Dockerfile.web`

Variaveis obrigatorias:

- `NODE_ENV=production`
- `NEXT_PUBLIC_APP_URL=https://querobroa.com.br`
- `NEXT_PUBLIC_API_URL=https://api.querobroa.com.br`
- `ORDER_FORM_API_URL=https://api.querobroa.com.br`
- `ORDER_FORM_BRIDGE_TOKEN=<mesmo valor da API>`

Observacao importante para Railway com `Dockerfile`:

- o build do Next precisa receber `NEXT_PUBLIC_APP_URL` e `NEXT_PUBLIC_API_URL` ja na fase de imagem; sem isso, o bundle pode cair em fallback local (`127.0.0.1`)
- o `Dockerfile.web` agora valida essas duas variaveis durante o build e falha cedo se faltarem

Custom domains:

- `querobroa.com.br`
- `www.querobroa.com.br`
- `ops.querobroa.com.br`

## Servico api no Railway

Deploy do repositório usando:

- Root Directory: repo root
- Builder: Dockerfile
- Dockerfile Path: `Dockerfile.api`

Anexar volume:

- Mount path: `/data`

Variaveis obrigatorias:

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `PORT=3001`
- `DATABASE_URL=<Postgres do Railway>`
- `APP_AUTH_ENABLED=true`
- `APP_AUTH_TOKEN=<token forte>`
- `ORDER_FORM_BRIDGE_TOKEN=<mesmo valor do web>`
- `APP_CORS_ORIGINS=https://querobroa.com.br,https://www.querobroa.com.br,https://ops.querobroa.com.br`
- `BUILDER_STORAGE_DIR=/data/builder`
- `PIX_PROVIDER=LOCAL_DEV` no inicio, ate ligar o PIX oficial no runtime
- `PIX_STATIC_KEY=+5511994009584`
- `PIX_RECEIVER_NAME=QUEROBROA`
- `PIX_RECEIVER_CITY=SAO PAULO`
- `BUSINESS_LEGAL_NAME=65.756.685 GUILHERME MARANGON`
- `BUSINESS_CNPJ=65756685000146`
- `BUSINESS_OFFICIAL_PHONE=+55 11 99400-9584`
- `BUSINESS_BANK_NAME=Nu Pagamentos S.A. - Instituicao de Pagamento`
- `BUSINESS_BANK_CODE=260`
- `BUSINESS_BANK_BRANCH=0001`
- `BUSINESS_BANK_ACCOUNT=770733822-0`
- `BANK_SYNC_WEBHOOK_TOKEN=<token forte para a bridge de baixa PIX>`
- `PIX_RECONCILIATION_LOOKBACK_DAYS=45`
- `PIX_RECONCILIATION_ALLOW_UNIQUE_AMOUNT_FALLBACK=false`
- `DELIVERY_MANUAL_FALLBACK_FEE=12`

Custom domain:

- `api.querobroa.com.br`

## DNS no Registro.br

Adicionar os dominios no Railway primeiro. Depois copiar exatamente os registros que o Railway pedir no `DNS` do Registro.br.

Esperado:

- `querobroa.com.br` -> registro do tipo apex/apontamento fornecido pelo Railway
- `www` -> CNAME para o alvo fornecido pelo Railway
- `ops` -> CNAME para o alvo fornecido pelo Railway
- `api` -> CNAME para o alvo fornecido pelo Railway

Nao force valores manualmente antes de ver o alvo emitido pelo Railway.

Checklist rapido de status:

- `dig +short NS querobroa.com.br` deve responder os nameservers delegados
- `dig +short querobroa.com.br` deve responder o alvo/apex publicado
- `dig +short CNAME www.querobroa.com.br` deve responder o alvo do Railway
- `dig +short CNAME api.querobroa.com.br` deve responder o alvo do Railway

## Validacao

1. `https://querobroa.com.br/` deve abrir a landing publica
2. `https://www.querobroa.com.br/` deve abrir a mesma landing publica
3. `https://querobroa.com.br/pedido` deve funcionar
4. `https://querobroa.com.br/pedidos` deve carregar a operacao
5. `https://ops.querobroa.com.br/` deve abrir em `Pedidos`
6. `https://api.querobroa.com.br/health` deve responder `{\"status\":\"ok\"}`
7. O submit de `/pedido` deve cair na mesma base operacional vista em `/pedidos`

Validadores automatizados:

- `pnpm validate:public-deploy`
  - valida `/`, `/pedido`, `/pedidos`, redirect de `ops`, health da API e `POST /api/google-form/preview`
- `pnpm validate:delivery-quote`
  - valida uma cotacao real em `POST /api/delivery-quote` sem criar entrega
- `QBAPP_GOOGLE_FORM_MODE=preview node scripts/test-google-form-bridge.mjs`
  - valida o contrato do Google Forms sem criar pedido
