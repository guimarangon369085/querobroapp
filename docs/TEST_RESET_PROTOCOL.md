# TEST_RESET_PROTOCOL

Ultima atualizacao: 2026-02-25

## Objetivo

Garantir que cada rodada de validacao E2E comece em estado limpo, sem clientes/pedidos de teste residuais.

## Marcacao de dados de teste

- Fluxos de tutorial (`tutorial=primeira_vez`) marcam dados com a tag `[TESTE_E2E]`.
- A limpeza remove pedidos e clientes com essa tag.

## Protocolo de reboot para teste

1. Limpar dados de teste:
   - `pnpm cleanup:test-data`
2. Derrubar ambiente atual:
   - `./scripts/stop-all.sh`
3. Subir ambiente novamente (escolha 1 forma):
   - opcao A (1 comando): `./scripts/dev-all.sh`
   - opcao B (2 terminais):
     - terminal 1: `pnpm --filter @querobroapp/api dev`
     - terminal 2: `pnpm --filter @querobroapp/web dev`
4. Validar health:
   - `curl -fsS http://127.0.0.1:3001/health`
   - `curl -I http://127.0.0.1:3000`
5. (Opcional) Smoke rapido:
   - `pnpm qa:smoke`

## One-liner rapido (limpeza + restart)

```bash
pnpm cleanup:test-data && ./scripts/stop-all.sh && ./scripts/dev-all.sh
```

## Resultado esperado

- Nenhum pedido de teste restante.
- Nenhum cliente de teste restante.
- API em `http://127.0.0.1:3001/health` com `200`.
- WEB em `http://127.0.0.1:3000` carregando normalmente.
