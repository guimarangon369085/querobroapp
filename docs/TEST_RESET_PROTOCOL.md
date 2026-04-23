# TEST_RESET_PROTOCOL

Ultima atualizacao: 2026-03-04

## Objetivo

Garantir que cada rodada de validacao manual ou E2E comece em estado limpo, com ambiente previsivel apos reboot.

## Marcacao de dados de teste

- Fluxos de tutorial (`tutorial=primeira_vez`) marcam dados com a tag `[TESTE_E2E]`.
- A limpeza remove pedidos e clientes com essa tag.
- Os E2Es atuais tambem limpam os dados criados no fim quando o fluxo cobre esse caminho.

## Protocolo padrao apos reboot

1. Derrubar qualquer processo antigo:
   - `./scripts/stop-all.sh`
2. Subir ambiente novamente:
   - opcao recomendada: `./scripts/dev-all.sh`
   - opcao manual em 2 terminais:
   - terminal 1: `pnpm --filter @querobroapp/api dev`
   - terminal 2: `pnpm --filter @querobroapp/web dev`
3. Validar health:
   - `curl -fsS http://127.0.0.1:3001/health`
   - `curl -I http://127.0.0.1:3000/pedido`
   - `curl -I http://127.0.0.1:3003/pedidos`
4. Se quiser validar do zero, limpar dados de teste com API/Web ativos:
   - `pnpm cleanup:test-data`
5. Abrir o app:
   - espelho publicado: `http://127.0.0.1:3000/pedido`
   - operacao local: `http://127.0.0.1:3003/pedidos`
6. Se o navegador ja estava aberto antes do reboot:
   - fazer hard refresh

## Smokes recomendados

Rapido:

```bash
pnpm qa:smoke
pnpm qa:browser-smoke
```

Observacao:

- `qa:browser-smoke` e `qa:critical-e2e` agora usam dist dirs temporarios isolados do Next para nao contaminar o `.next` do `next dev`.
- Esses dois fluxos tambem dependem do wrapper Playwright em `$HOME/.codex/skills/playwright/scripts/playwright_cli.sh`.

Completo:

```bash
pnpm qa:critical-e2e
QA_TRUST_INCLUDE_LINT=1 \
QA_TRUST_INCLUDE_SMOKE=1 \
QA_TRUST_INCLUDE_BROWSER=1 \
QA_TRUST_INCLUDE_CRITICAL_E2E=1 \
pnpm qa:trust
```

## One-liners uteis

Limpeza + restart:

```bash
./scripts/refresh-and-start.command
```

Restart sem limpeza:

```bash
./scripts/stop-all.sh && ./scripts/dev-all.sh
```

## Resultado esperado

- Nenhum pedido de teste residual, se a limpeza foi rodada.
- Nenhum cliente de teste residual, se a limpeza foi rodada.
- API em `http://127.0.0.1:3001/health` com `200`.
- Espelho em `http://127.0.0.1:3000/pedido` carregando normalmente.
- Web operacional em `http://127.0.0.1:3003/pedidos` carregando normalmente.
- `Pedidos` abrindo em `Dia`, sem erro de CORS e sem overlay de runtime.
