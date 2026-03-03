# MEMORY_VAULT

Ultima atualizacao: 2026-03-03

## Para que serve

Manter continuidade entre sessoes sem depender de memoria de chat.

## Fonte de verdade

1. Codigo no repositorio.
2. `README.md` para runbook de reboot, subida local e QA.
3. `docs/querobroapp-context.md`.
4. `docs/PROJECT_SNAPSHOT.md`.
5. `docs/NEXT_STEP_PLAN.md`.
6. `docs/TEST_RESET_PROTOCOL.md` para limpeza e reboot de teste.
7. `docs/HANDOFF_LOG.md` apenas como trilha historica, nunca como snapshot atual isolado.
8. `docs/BOOTSTRAP_PROMPTS.md` e `docs/prompts/*.txt` para o comportamento real do launcher.

## Contexto tecnico estavel

- Repo principal: `$HOME/querobroapp`
- Stack: NestJS + Next.js + Expo + Prisma
- Fluxo principal: Produtos -> Clientes -> Pedidos -> Estoque
- Entrada operacional do web: `http://127.0.0.1:3000/pedidos`

## Regras de continuidade

1. O launcher padrao `./scripts/abrir-codex.command` usa o modo `quick`: `docs/PROJECT_SNAPSHOT.md`, `docs/NEXT_STEP_PLAN.md`, `git status --short --branch` e ultimas 80 linhas do handoff.
2. Use `./scripts/abrir-codex.command reboot` (ou `qa`) quando a sessao envolver reboot, subida local ou QA; nesse modo, `README.md` e `docs/TEST_RESET_PROTOCOL.md` entram no bootstrap.
3. Use `./scripts/abrir-codex.command ux` quando o foco for simplificacao de interface com minimo de cliques.
4. `docs/MEMORY_VAULT.md` e `docs/querobroapp-context.md` entram quando houver ambiguidade real, mudanca estrutural ou necessidade de continuidade mais profunda.
5. O modo `quick` nao faz perguntas iniciais; sem objetivo explicito, ele executa diretamente a Prioridade 1 (agora) de `docs/NEXT_STEP_PLAN.md`.
6. Toda sessao termina com handoff novo.
7. Se comportamento mudar, atualizar contexto, snapshot e plano no mesmo ciclo.
8. Se o fluxo de reboot, teste ou QA mudar, atualizar `README.md`, `docs/TEST_RESET_PROTOCOL.md`, `docs/BOOTSTRAP_PROMPTS.md` e o template `.txt` correspondente no mesmo ciclo.

## Riscos que devem ficar visiveis

- Drift entre schema dev e prod.
- Cobertura de testes de dominio ainda parcial, apesar do gate atual estar bem mais forte.
- Worktree pode conter mudancas em andamento.
- Integracoes externas foram removidas da base atual; nao presumir contratos, rotas ou variaveis legadas.
- Branding atual do shell web usa `broa-mark.svg` na metadata e mark vetorial na sidebar; se trocar o logo, alinhar metadata e sidebar.
