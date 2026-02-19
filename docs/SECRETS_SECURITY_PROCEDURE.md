# SECRETS_SECURITY_PROCEDURE

## Regra principal

Segredo nunca entra em git.

## Onde guardar segredo

- `.env` local (ignorado)
- secret manager (GitHub/Cloud)

## O que nunca fazer

- Nao subir token, senha, private key, certificado, connection string real.
- Nao usar `NEXT_PUBLIC_*` para segredo.
- Nao deixar segredo em log, screenshot ou exemplo de README.

## Rotina antes de commit

```bash
pnpm security:secrets:staged
pnpm lint
pnpm typecheck
pnpm test
```

## Rotina antes de PR

```bash
pnpm security:secrets
pnpm security:policy:diff
```

## Ferramentas ja no projeto

- Hook pre-commit anti segredo
- Scan de segredos em CI
- Policy gate por diff
- Hardening local e GitHub

## Se vazou segredo

1. Revogar/rotacionar imediatamente.
2. Remover do codigo e do historico quando necessario.
3. Revisar acessos e impacto.
4. Registrar incidente no handoff.

