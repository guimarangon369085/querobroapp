# QUEROBROAPP

QUEROBROAPP e um ERP operacional para a rotina diaria da broa.
O principio atual do produto e simples: `Pedidos` concentra a agenda do dia; o backend segura a complexidade.

## Estado atual verificado

- Web operacional com 4 telas reais: `Pedidos`, `Clientes`, `Produtos`, `Estoque`.
- `Pedidos` e a entrada principal e concentra as visoes `Dia`, `Semana` e `Mes`.
- `/calendario` existe apenas como redirect legado para `/pedidos`.
- `Builder` nao faz mais parte da operacao: `/builder` redireciona para `/pedidos`.
- Todas as integracoes externas foram removidas da base atual; a operacao validada hoje e 100% interna.
- O processo de QA hoje ja tem gate unico, smoke de navegador e E2E critico.

## Fluxo principal do produto

1. `Produtos`: cadastre o que voce vende e mantenha a ficha tecnica.
2. `Clientes`: salve contato e endereco.
3. `Pedidos`: crie, acompanhe, produza, entregue e receba.
4. `Estoque`: confira saldo, D+1, compras e consumo real.

## Reiniciar a maquina e voltar a testar

### Primeira vez nesta maquina

```bash
pnpm install --frozen-lockfile
cp .env.example .env
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
cp apps/mobile/.env.example apps/mobile/.env
pnpm --filter @querobroapp/api prisma:generate:dev
pnpm --filter @querobroapp/api prisma:migrate:dev
pnpm --filter @querobroapp/api prisma:seed
```

### Reboot operacional padrao

```bash
./scripts/stop-all.sh
./scripts/dev-all.sh
```

Notas:

- `./scripts/dev-all.sh` sobe API + Web, limpa cache dev do web, roda migrate dev e abre `http://127.0.0.1:3000/pedidos`.
- Mantenha essa janela aberta. Fechar a janela encerra API e Web.
- Se quiser partir de estado limpo para validacao manual, rode com API/Web ativos (em outro terminal):

```bash
pnpm cleanup:test-data
```

- Atalho para reboot + limpeza executavel em um comando: `./scripts/refresh-and-start.command`.

### Alternativa em 2 terminais

Terminal 1:

```bash
pnpm --filter @querobroapp/api dev
```

Terminal 2:

```bash
pnpm --filter @querobroapp/web dev
```

Observacao:

- `pnpm dev` na raiz usa `turbo` e sobe mais coisa do que o necessario para validar o web. Para teste manual do produto, prefira `./scripts/dev-all.sh`.

## URLs locais

- Web: `http://127.0.0.1:3000/pedidos`
- API health: `http://127.0.0.1:3001/health`
- Runtime config (read-only): `http://127.0.0.1:3001/runtime-config`
- Alias legado de runtime config: `http://127.0.0.1:3001/builder/config`

## Checklist manual apos reboot

1. Abra `http://127.0.0.1:3000/pedidos`.
2. Confirme que a tela abre em `Dia`.
3. Clique em um card qualquer no calendario de `Semana` ou `Mes` e confirme que ele abre a visao `Dia`, mesmo vazio.
4. Crie ou edite um produto em `Produtos`.
5. Crie ou edite um cliente em `Clientes`.
6. Volte a `Pedidos`, crie um pedido e avance o status.
7. Registre um pagamento.
8. Abra `Estoque` e confira saldo e quadro D+1.

Se o navegador estava aberto antes do reboot, faca um hard refresh. Isso evita bundle antigo do `next dev` em memoria.

## QA automatizado

Baseline:

```bash
pnpm qa:trust
```

Gate forte completo:

```bash
QA_TRUST_INCLUDE_LINT=1 \
QA_TRUST_INCLUDE_SMOKE=1 \
QA_TRUST_INCLUDE_BROWSER=1 \
QA_TRUST_INCLUDE_CRITICAL_E2E=1 \
pnpm qa:trust
```

Comandos avulsos:

```bash
pnpm qa:smoke
pnpm qa:browser-smoke
pnpm qa:critical-e2e
pnpm check:prisma-drift
```

O gate `qa:trust` hoje valida:

1. `session:docs:guard`
2. `git diff --check`
3. `typecheck`
4. `test`
5. `build:ci`

E, por flag, adiciona `lint`, `qa:smoke`, `qa:browser-smoke` e `qa:critical-e2e`.

Nota importante:

- `qa:browser-smoke` e `qa:critical-e2e` agora usam dist dirs temporarios isolados do Next. Isso reduz o risco de corromper o `.next` do `next dev` enquanto o ambiente local estiver aberto.
- O CI principal do GitHub agora roda `pnpm check:prisma-drift` + `QA_TRUST_INCLUDE_LINT=1 pnpm qa:trust`, para alinhar o gate remoto ao processo local.
- Os fluxos `qa:browser-smoke` e `qa:critical-e2e` usam o wrapper Playwright em `$HOME/.codex/skills/playwright/scripts/playwright_cli.sh`; valide esse prerequisito em uma maquina nova antes do gate completo.

## Integracoes externas

- O backend atual ja sustenta intake externo canonico (`/orders/intake/customer-form`, `google-form` e `whatsapp-flow`), envio opcional pela WhatsApp Cloud API e alerta operacional por webhook/ntfy.
- Agora tambem existe `POST /whatsapp/webhook`, `POST /payments/pix-settlements/webhook` para baixa PIX por identificador interno e `POST /payments/pix-reconciliations/webhook` para conciliacao segura por nome + valor vinda de bridge externa.
- O trilho bancario foi preparado de forma provider-neutral: a conta oficial hoje e Nubank, mas a integracao de liquidacao entra pelo webhook do ERP para permitir automacao futura via Nubank/Open Finance/bridge externo sem trocar o contrato interno.
- O repo agora inclui `scripts/nubank-pix-bridge.mjs`, que usa a aba autenticada do Nubank PJ no Chrome para ler PIX de entrada visiveis e delegar o matching seguro ao backend.

## Scripts principais

```bash
./scripts/dev-all.sh
./scripts/stop-all.sh
./scripts/preflight-local.sh
pnpm lint
pnpm typecheck
pnpm test
pnpm qa:trust
pnpm qa:browser-smoke
pnpm qa:critical-e2e
pnpm bank:pix:bridge:once
pnpm bank:pix:bridge
```

## Fontes de verdade

- Estado tecnico: `docs/PROJECT_SNAPSHOT.md`
- Contexto atual: `docs/querobroapp-context.md`
- Plano atual: `docs/NEXT_STEP_PLAN.md`
- Reboot e limpeza: `docs/TEST_RESET_PROTOCOL.md`
- Continuidade entre sessoes: `docs/MEMORY_VAULT.md`
- Historico cronologico: `docs/HANDOFF_LOG.md`
