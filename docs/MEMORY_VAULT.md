# MEMORY_VAULT

Ultima atualizacao: 2026-04-22

## Para que serve

Manter continuidade entre sessoes sem depender de memoria de chat.

## Fonte de verdade

1. Codigo no repositorio.
2. `$HOME/.querobroapp/codex-auto-session-snapshot.md` como snapshot factual autoatualizado da sessao atual.
3. `docs/PROJECT_SNAPSHOT.md` para o estado vivo do produto e do app.
4. `docs/NEXT_STEP_PLAN.md` para a prioridade atual e a ordem de execucao.
5. `docs/querobroapp-context.md` para continuidade manual e leitura humana curta.
6. `README.md` e `docs/TEST_RESET_PROTOCOL.md` para reboot, subida local, QA e reset de teste.
7. `docs/BOOTSTRAP_PROMPTS.md` e `docs/prompts/*.txt` para o comportamento real do launcher.
8. `docs/RAILWAY_DEPLOY.md` para deploy publico, dominio, validadores remotos e canal externo.
9. `docs/HANDOFF_LOG.md` apenas como trilha historica, nunca como snapshot atual isolado.

## Contexto tecnico estavel

- Repo principal: `$HOME/querobroapp`
- Stack: NestJS + Next.js + Expo + Prisma
- Superficies principais do web: `/` publico, `/pedido` publico, `/pedidos`, `/clientes`, `/estoque` e `/dashboard` internos
- Espelho local oficial do publicado: `http://127.0.0.1:3000/pedido`
- Laboratorio futuro isolado: `http://127.0.0.1:3002/pedido`
- O fluxo operacional completo (`/pedidos`, `/clientes`, `/estoque`) continua existindo via `./scripts/dev-all.sh`, mas esse reboot reutiliza a porta `3000` para o web local interno e nao deve ser confundido com o espelho publico
- `/produtos` e legado com redirect para `/estoque`
- O dashboard financeiro atual usa importacao manual de extrato (`.eml`, `.csv`, `.ofx`) e nao depende mais de bridge local autenticada do Nubank
- A proxima rodada padrao de trabalho tende a cair em mudancas esteticas, refinamentos de UX, correcoes de bugs e novas funcionalidades

## Regras de continuidade

1. O launcher padrao `./scripts/abrir-codex.command` atualiza primeiro `$HOME/.querobroapp/codex-auto-session-snapshot.md` com fatos do repo, portas observadas, arquivos canonicos e comandos operacionais basicos.
2. Depois disso, o modo `quick` usa esse snapshot factual junto de `docs/PROJECT_SNAPSHOT.md`, `docs/NEXT_STEP_PLAN.md` e ultimas 80 linhas do handoff.
3. Use `./scripts/abrir-codex.command reboot` (ou `qa`) quando a sessao envolver reboot, subida local ou QA; nesse modo, `README.md` e `docs/TEST_RESET_PROTOCOL.md` entram no bootstrap.
4. Use `./scripts/abrir-codex.command ux` quando o foco for simplificacao de interface com minimo de cliques.
5. `docs/MEMORY_VAULT.md` e `docs/querobroapp-context.md` entram quando houver ambiguidade real, mudanca estrutural ou necessidade de continuidade mais profunda.
6. O modo `quick` nao faz perguntas iniciais; sem objetivo explicito, ele sincroniza contexto, entrega resumo curto e fica aguardando silenciosamente a proxima instrucao.
7. O modo `quick` assume por padrao que a sessao seguira com mudancas esteticas, refinamentos de UX, correcoes de bugs e novas funcionalidades no app.
8. Toda sessao termina com handoff novo.
9. Se comportamento funcional mudou, atualizar `docs/PROJECT_SNAPSHOT.md`, `docs/NEXT_STEP_PLAN.md` e/ou `docs/querobroapp-context.md` no mesmo ciclo.
10. Se o fluxo de reboot, subida local, teste ou QA mudar, atualizar `README.md` e `docs/TEST_RESET_PROTOCOL.md` no mesmo ciclo.
11. Se o launcher, bootstrap ou snapshot mudar, atualizar `docs/BOOTSTRAP_PROMPTS.md`, o template `.txt` correspondente e, se preciso, `scripts/refresh-codex-context.sh`.
12. Se deploy publico, validadores remotos, dominio, Google Forms ou canal externo mudarem, atualizar `docs/RAILWAY_DEPLOY.md` no mesmo ciclo.
13. `docs/HANDOFF_LOG.md` nao substitui docs vivos; ele so registra historico verificado.

## Riscos que devem ficar visiveis

- Drift entre schema dev e prod.
- Cobertura de testes de dominio ainda parcial, apesar do gate atual estar bem mais forte.
- Worktree pode conter mudancas em andamento.
- Nao presumir contratos, rotas ou variaveis legadas; validar sempre pelo snapshot factual e pelo codigo vivo.
- Branding atual do shell web usa `broa-mark.svg` na metadata e mark vetorial na sidebar; se trocar o logo, alinhar metadata e sidebar.
