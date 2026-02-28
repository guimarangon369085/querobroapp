# QUEROBROAPP Alexa Lambda

Este diretório contém o handler de produção para a skill Alexa privada do QUEROBROAPP.

## Variáveis de ambiente

- `APP_BRIDGE_URL`
- `APP_BRIDGE_TOKEN`
- `APP_BRIDGE_HMAC_SECRET`

## Empacotamento

Use o script do repositório:

```bash
./scripts/package-alexa-lambda.sh
```

Ele gera um `.zip` em `output/alexa/` pronto para upload na AWS Lambda.
