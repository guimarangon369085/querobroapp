# Railway Deploy

## Objetivo

Subir o mesmo app em producao com:

- `querobroa.com.br` e `www.querobroa.com.br` abrindo o fluxo publico
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

- `querobroa.com.br/` -> `/pedido`
- `www.querobroa.com.br/` -> `/pedido`
- `ops.querobroa.com.br/` -> `/pedidos`
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
- `QUEROBROAPP_DEFAULT_WEB_PATH=/pedido`

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
- `PIX_PROVIDER=LOCAL_DEV` no inicio, ate trocar por provedor real
- `PIX_STATIC_KEY=<chave PIX real ou temporaria>`
- `PIX_RECEIVER_NAME=QUERO BROA`
- `PIX_RECEIVER_CITY=BELO HORIZONTE`
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

## Validacao

1. `https://querobroa.com.br/` deve abrir no pedido publico
2. `https://querobroa.com.br/pedido` deve funcionar
3. `https://querobroa.com.br/pedidos` deve carregar a operacao
4. `https://ops.querobroa.com.br/` deve abrir em `Pedidos`
5. `https://api.querobroa.com.br/health` deve responder `{\"status\":\"ok\"}`
6. O submit de `/pedido` deve cair na mesma base operacional vista em `/pedidos`
