# QUEROBROAPP_CONTEXT

Ultima atualizacao: 2026-03-04

## Missao do produto

Facilitar a operacao diaria da broa com interface simples, agenda centrada em `Pedidos` e backend robusto.

## Estado atual

- Web operacional com navegacao fixa em `Pedidos`, `Clientes`, `Produtos`, `Estoque`.
- `Pedidos` e a tela-base do app e concentra `Dia`, `Semana` e `Mes`.
- A visao de `Dia` abre por padrao e cobre `08:00` a `21:59` em grade compacta, com criacao de pedido no painel e lista completa de pedidos abaixo do calendario; cards de `Semana`/`Mes` abrem `Dia` na mesma data.
- CTAs contextuais por tela: `Pedidos` usa acao `Criar` no painel, `Clientes/Produtos` usam acao inline/sticky e `Estoque` usa botao flutuante `Nova movimentacao`.
- `/calendario` existe apenas como alias legado com redirect permanente para `/pedidos`.
- O fluxo local continua funcional de ponta a ponta: pedido manual -> confirmacao -> fila de producao -> baixa real de estoque -> entrega local -> pagamento.
- Integracoes externas foram removidas da estrutura atual para que a operacao principal evolua sem dependencias de terceiros.
- O runtime de configuracao segue vivo por `GET /runtime-config`; `/builder` e apenas legado redirecionado.
- O processo de QA agora tem `qa:trust`, `qa:browser-smoke` e `qa:critical-e2e`.
- Os builds temporarios de QA do web agora usam dist dirs isolados, para reduzir o risco de contaminar o `.next` do `next dev`.
- O workflow principal de CI no GitHub agora tambem usa `qa:trust` (com lint) e `check:prisma-drift`, reduzindo divergencia entre validacao local e remota.
- Branding do shell web segue como QUEROBROAPP; a aba usa `broa-mark.svg` via metadata e a sidebar usa o mark vetorial interno.

## Prioridades vigentes

1. Validar o app manualmente apos reboot sem ambiguidades de ambiente.
2. Simplificar mais a tela de `Estoque`, mantendo a jornada `planejar -> comprar -> produzir -> conferir`.
3. Continuar endurecendo testes de dominio e de navegador para reduzir regressao silenciosa.
4. Manter docs de estado, snapshot, reboot e handoff sincronizados no mesmo ciclo.

## Como religar rapido apos reboot

1. Rodar `./scripts/stop-all.sh`.
2. Rodar `./scripts/dev-all.sh`.
3. Se quiser validar do zero, rodar `pnpm cleanup:test-data` com API/Web ativos.
4. Manter a janela aberta e abrir `http://127.0.0.1:3000/pedidos`.
5. Validar `http://127.0.0.1:3001/health`.
6. Se o browser ja estava aberto, fazer hard refresh.

## Como retomar uma sessao de trabalho

1. Para retomar no modo padrao, rode `./scripts/abrir-codex.command`.
2. Para reboot, subida local ou QA, rode `./scripts/abrir-codex.command reboot` (ou `qa`).
3. Para foco em UX, rode `./scripts/abrir-codex.command ux`.
4. Antes de abrir o Codex, o launcher gera `$HOME/.querobroapp/codex-auto-session-snapshot.md` com branch, worktree, commits recentes, servicos locais e frescor dos docs.
5. No modo padrao, o Codex deve ler esse snapshot primeiro, responder com um resumo curto e ficar aguardando em silencio a proxima instrucao.
6. Assuma por padrao que a conversa seguinte tratara de ajustes no app, UX, bugs ou refinamentos operacionais.
7. Se retomar manualmente, leia o snapshot autoatualizado, depois `docs/PROJECT_SNAPSHOT.md`, `docs/NEXT_STEP_PLAN.md` e as ultimas 80 linhas de `docs/HANDOFF_LOG.md`.
8. Leia `README.md` e `docs/TEST_RESET_PROTOCOL.md` so em reboot, subida local, QA ou teste manual.
9. Leia `docs/MEMORY_VAULT.md` quando houver ambiguidade real, necessidade de continuidade mais profunda ou mudanca estrutural.
10. Nao presumir integracoes externas: o codigo atual nao depende de WhatsApp, Uber, Alexa ou conectores de terceiros.

## Integracoes externas

- WhatsApp, Uber, Alexa, receipts e conectores de fornecedores foram removidos do codigo ativo.
- A entrega atual usa apenas o fluxo local interno exposto por `deliveries`.
- Quando a operacao principal estiver 100% estabilizada, qualquer reintegracao deve ser redesenhada do zero, sem reaproveitar contratos antigos por inercia.
