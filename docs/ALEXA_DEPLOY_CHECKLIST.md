# Alexa Deploy Checklist (Seguro)

## 1. Backend QUEROBROAPP

Configure em `apps/api/.env`:

- `ALEXA_BRIDGE_TOKEN`
- `ALEXA_BRIDGE_HMAC_SECRET`
- `ALEXA_ALLOWED_SKILL_IDS`
- `ALEXA_BRIDGE_REQUIRE_SIGNATURE=true`
- `ALEXA_BRIDGE_REQUIRE_SKILL_ID_ALLOWLIST=true`
- `ALEXA_OAUTH_CLIENT_ID`
- `ALEXA_OAUTH_CLIENT_SECRET`
- `ALEXA_OAUTH_LINK_TOKEN`
- `ALEXA_OAUTH_REDIRECT_URI_ALLOWLIST`
- `ALEXA_OAUTH_REQUIRE_PKCE=true`
- `ALEXA_REQUIRE_ACCOUNT_LINKING=true`

## 2. Publicação HTTPS

Exponha o backend com HTTPS:

- `https://SEU_HOST/alexa/bridge`
- `https://SEU_HOST/alexa/oauth/authorize`
- `https://SEU_HOST/alexa/oauth/token`

Preferência:

1. domínio próprio + proxy reverso
2. Cloudflare Tunnel
3. ngrok (apenas homologação)

## 3. AWS Lambda

1. Rode `./scripts/package-alexa-lambda.sh`
2. Faça upload do zip gerado em `output/alexa/querobroapp-alexa-lambda.zip`
3. Configure runtime `Node.js 20.x`
4. Configure handler: `index.handler`
5. Defina env vars:
   - `APP_BRIDGE_URL`
   - `APP_BRIDGE_TOKEN`
   - `APP_BRIDGE_HMAC_SECRET`

## 4. Alexa Developer Console

1. Importe o interaction model:
   - [pt-BR.json](/Users/gui/querobroapp/integrations/alexa/skill-package/interactionModels/custom/pt-BR.json)
2. Revise invocation name: `quero broa`
3. Configure endpoint da skill para AWS Lambda
4. Habilite Account Linking:
   - Authorization Code Grant
   - Authorization URI: `https://SEU_HOST/alexa/oauth/authorize`
   - Access Token URI: `https://SEU_HOST/alexa/oauth/token`
   - Client ID / Secret iguais ao backend
   - PKCE ativo
   - Scope: `alexa:bridge`

## 5. Smoke Test

1. Vincule a conta na Alexa App
2. Teste:
   - “Alexa, abrir quero broa”
   - “Alexa, pedir ao quero broa para sincronizar fornecedores”
   - “Alexa, pedir ao quero broa para gerar plano de compras para hoje”
3. Verifique as runs em `/automations/runs`

## 6. Hardening Extra Recomendado

1. Rotacionar `ALEXA_BRIDGE_TOKEN`, `ALEXA_BRIDGE_HMAC_SECRET` e `ALEXA_OAUTH_LINK_TOKEN`
2. Colocar WAF/rate limiting no endpoint público
3. Monitorar logs de `400`/`401` no bridge e OAuth
4. Usar skill privada/internal enquanto a superfície estiver em maturação
