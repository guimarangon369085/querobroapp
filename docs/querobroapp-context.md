# QUEROBROAPP_CONTEXT

Ultima atualizacao: 2026-04-06

## Missao do produto

Operar a broa no mesmo nucleo entre captura publica, operacao interna e leitura executiva, com interface simples, backend robusto e contexto sempre retomavel.

## Estado atual

- O web hoje se divide em 3 camadas claras: `/` como landing publica, `/pedido` como captura publica e `/pedidos`, `/clientes`, `/estoque`, `/dashboard` como operacao interna autenticada.
- `Pedidos` continua sendo a tela-base da operacao, com agenda `Dia/Semana/Mes`, quick create e detalhe em drawer lateral, sem regressao para modal central.
- `/produtos` deixou de ser superficie principal; virou redirect legado para `/estoque`.
- O dashboard interno hoje e um `board cockpit` com leitura de trafego, funil, origem/referrer, meta mensal, COGS e caixa real.
- O caixa real do dashboard nao depende mais de bridge local do banco; a fonte canonica passou a ser importacao manual do extrato do Nu Empresas em `.eml`, `.csv` ou `.ofx`.
- A operacao interna do web fica protegida por sessao persistente em `/acesso`, e o bridge `/api/internal/*` segue o mesmo modelo.
- O fluxo publico e interno compartilha o mesmo contrato de pedido, incluindo cotacao previa de frete e catalogo centralizado de caixas/sabores.
- O processo de QA atual gira em torno de `pnpm qa:trust`, `pnpm qa:browser-smoke`, `pnpm qa:critical-e2e` e `pnpm check:prisma-drift`.
- Os flows de QA do web usam dist dirs isolados para nao disputar o `.next` do `next dev`.
- O foco padrao da etapa atual do projeto e melhorar interface, lapidar UX, corrigir bugs e encaixar novas funcionalidades sem perder coerencia operacional.

## Prioridades vigentes

1. Fechar o canal externo real sobre `/pedido` e `Google Forms`, incluindo total final correto com frete antes do PIX.
2. Continuar refinando `Pedidos` e `Estoque`, com foco em densidade visual, performance e friccao operacional.
3. Manter o dashboard executivo coerente, rapido e alinhado com a base factual do negocio.
4. Manter bootstrap, snapshot, docs vivos, handoff e runbooks sincronizados no mesmo ciclo de mudanca.

## Como religar rapido apos reboot

1. Rodar `./scripts/stop-all.sh`.
2. Rodar `./scripts/dev-all.sh`.
3. Abrir `http://127.0.0.1:3003/pedidos`.
4. Validar `http://127.0.0.1:3001/health`.
5. Se precisar validar o app sem ambiguidade, rodar `pnpm qa:browser-smoke`.
6. Se a mudanca tocar a jornada critica, rodar `pnpm qa:critical-e2e`.

## Como retomar uma sessao de trabalho

1. Para retomar no modo padrao, rode `./scripts/abrir-codex.command`.
2. Para reboot, subida local ou QA, rode `./scripts/abrir-codex.command reboot` (ou `qa`).
3. Para foco em UX, rode `./scripts/abrir-codex.command ux`.
4. Antes de abrir o Codex, o launcher gera `$HOME/.querobroapp/codex-auto-session-snapshot.md` com branch, worktree, commits recentes, servicos locais e frescor dos docs.
5. No modo padrao, o Codex deve ler esse snapshot primeiro, responder com um resumo curto e ficar aguardando em silencio a proxima instrucao.
6. Assuma por padrao que a conversa seguinte tratara de mudancas esteticas, refinamentos de UX, correcoes de bugs ou novas funcionalidades.
7. Se retomar manualmente, leia o snapshot autoatualizado, depois `docs/PROJECT_SNAPSHOT.md`, `docs/NEXT_STEP_PLAN.md` e as ultimas 80 linhas de `docs/HANDOFF_LOG.md`.
8. Leia `README.md` e `docs/TEST_RESET_PROTOCOL.md` so em reboot, subida local, QA ou teste manual.
9. Leia `docs/MEMORY_VAULT.md` quando houver ambiguidade real, necessidade de continuidade mais profunda ou mudanca estrutural.
10. Se deploy publico, dominio, Google Forms, preview/intake ou validadores remotos entrarem na rodada, alinhe tambem `docs/RAILWAY_DEPLOY.md`.

## Integracoes externas

- O canal externo atual se concentra em `/pedido` e `Google Forms`, ambos apoiados no mesmo contrato canonico de preview/intake.
- O frete segue calculado internamente por raio, com fallback manual acima da area automatizada.
- O app nao depende mais de bridge local continua do banco; a leitura financeira publicada depende do import manual de extrato.
- Nao reintroduzir integracoes legadas por inercia; toda ampliacao externa nova deve respeitar o contrato vivo do app e a documentacao remota correspondente.
