# Alexa + QUEROBROAPP (Conexao Primeiro)

## Objetivo desta fase

Conectar Alexa ao backend para disparar automacoes reais do app com baixa friccao operacional.

## Arquitetura recomendada (baseline)

`Alexa Skill (ASK SDK + AWS Lambda) -> POST /alexa/bridge -> AutomationsService`

Motivos praticos:

- Alexa valida assinatura/timestamp no lado ASK/Lambda.
- QUEROBROAPP recebe payload normalizado + token proprio (`x-alexa-token`).
- Reaproveita automacoes ja existentes (`SUPPLIER_PRICE_SYNC`, `D1_PURCHASE_PLAN`) sem duplicar logica.

## Benchmark de abordagens (conexao)

### 1) Skill endpoint direto no app (sem Lambda intermediaria)
- Latencia: menor salto de rede.
- Complexidade: alta (validacao de assinatura Alexa no proprio app + hardening de endpoint publico).
- Risco operacional: alto para equipe pequena.

### 2) Skill em Lambda + bridge HTTP no app (recomendado)
- Latencia: +1 salto (Lambda -> app), aceitavel para comandos operacionais.
- Complexidade: media.
- Risco operacional: medio/baixo.
- Melhor relacao tempo-para-produzir x seguranca.

### 3) Alexa Routines "Custom Tasks/Triggers"
- Potencial bom para fluxos orientados a rotina.
- Estado atual: preview/beta em partes do ecossistema, com limites de modelagem.
- Bom para fase 2, nao para bootstrap da conexao.

## Benchmarks publicos usados como referencia

1. ASK SDK for Node.js (`alexa/alexa-skills-kit-sdk-for-nodejs`) com adoção ampla (3.1k+ stars), ativo para skills modernas:
   - https://github.com/alexa/alexa-skills-kit-sdk-for-nodejs
2. ASK CLI (`alexa/ask-cli`) ativo e consolidado para deploy/config de skill (172+ stars):
   - https://github.com/alexa/ask-cli
3. SDK legado (`amzn/alexa-skills-kit-js`) descontinuado em favor do novo ASK SDK:
   - https://github.com/amzn/alexa-skills-kit-js
4. Documentacao oficial de endpoint custom skill e fluxo tecnico:
   - https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-a-web-service.html
5. Lambda como endpoint de skill (referencia oficial):
   - https://developer.amazon.com/en-US/docs/alexa/custom-skills/use-a-service-endpoint.html#awslambda
6. Account linking (producao multiusuario):
   - https://developer.amazon.com/en-US/docs/alexa/account-linking/add-account-linking-logic-custom-skill.html
7. Routines kit: pre-built primitives com deprecacao anunciada para 13/05/2026:
   - https://developer.amazon.com/en-US/docs/alexa/alexa-haus/routines-api.html
8. Custom Triggers (preview):
   - https://developer.amazon.com/en-US/docs/alexa/smapi/custom-task-apis.html#create-custom-trigger

## Conexao implementada no app

Endpoint novo: `POST /alexa/bridge`

Headers:
- `x-alexa-token`: token do bridge (recomendado: `ALEXA_BRIDGE_TOKEN`)
- `x-alexa-timestamp`: epoch em segundos
- `x-alexa-signature`: `sha256=<hex>` calculado sobre `${timestamp}.${stableJson(payload)}`

Payload esperado (normalizado pelo Lambda):

```json
{
  "applicationId": "amzn1.ask.skill.xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  "userId": "amzn1.ask.account.xxxxx",
  "locale": "pt-BR",
  "requestType": "IntentRequest",
  "requestId": "EdwRequestId.xxxxx",
  "intentName": "SyncSupplierPricesIntent",
  "slots": {
    "date": "2026-02-27"
  },
  "utterance": "sincronizar fornecedores"
}
```

Intents mapeadas agora:
- `SyncSupplierPricesIntent` -> skill `SUPPLIER_PRICE_SYNC`
- `BuildPurchasePlanIntent` -> skill `D1_PURCHASE_PLAN`
- `LatestAutomationStatusIntent` -> status da ultima run
- Built-ins: `AMAZON.HelpIntent`, `AMAZON.StopIntent`, `AMAZON.CancelIntent`, `AMAZON.FallbackIntent`

## Variaveis de ambiente

- `ALEXA_BRIDGE_TOKEN`
- `ALEXA_BRIDGE_HMAC_SECRET`
- `ALEXA_BRIDGE_REQUIRE_SIGNATURE` (default `true`)
- `ALEXA_BRIDGE_REQUIRE_SKILL_ID_ALLOWLIST` (default `true`)
- `ALEXA_BRIDGE_MAX_SKEW_SECONDS` (default `120`)
- `ALEXA_BRIDGE_REPLAY_TTL_SECONDS` (default `300`)
- `ALEXA_ALLOWED_SKILL_IDS` (lista CSV de `amzn1.ask.skill...`)

## Hardening aplicado no bridge

1. Token dedicado obrigatorio (`x-alexa-token`).
2. Assinatura HMAC obrigatoria com janela de tempo curta.
3. Protecao anti-replay por cache temporal de assinatura.
4. Allowlist de `applicationId` (skill id) controlada por ambiente.
5. Separacao de privilegios: bridge so dispara automacoes mapeadas.

## Fase 2 (apos conexao estabilizada)

1. Account linking OAuth2 entre Alexa e QUEROBROAPP.
2. Intents para operacoes de estoque (entrada/ajuste), com confirmacao por voz.
3. Respostas proativas via notificacao (se estrategia de canal suportar).
4. Observabilidade dedicada: taxa de sucesso por intent + tempo medio por run.
