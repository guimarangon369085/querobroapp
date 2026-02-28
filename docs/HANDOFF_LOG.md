# HANDOFF LOG

Registro cronologico de handoffs entre canais.

## Entrada 001

### 1) Metadados

- Data/hora: 2026-02-12 UTC (equivale a 2026-02-11 -03)
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Online/Cloud
- Repo path: `$HOME/querobroapp`
- Branch: `main`
- Commit base (opcional): nao registrado

### 2) Objetivo da sessao encerrada

- Objetivo: configurar continuidade entre ChatGPT e Codex sem depender de historico automatico.
- Resultado entregue: criados `docs/querobroapp-context.md` e `docs/HANDOFF_TEMPLATE.md`; `README.md` atualizado com secao de continuidade.
- O que ficou pendente: adotar o ritual em todas as proximas sessoes e publicar no remoto quando desejar.

### 3) Mudancas tecnicas

- Arquivos alterados:
  - `docs/querobroapp-context.md`
  - `docs/HANDOFF_TEMPLATE.md`
  - `README.md`
  - `docs/HANDOFF_LOG.md`
- Comportamento novo: existe um fluxo padrao para retomar contexto entre canais com prompt e handoff estruturado.
- Riscos/regressoes: baixo risco (documentacao apenas).

### 4) Validacao

- Comandos executados: leitura e validacao de arquivos locais com `sed`, `nl`, `git status`, `git diff`.
- Testes que passaram: nao aplicavel.
- Testes nao executados (e motivo): testes de codigo nao executados porque nao houve mudanca de comportamento em runtime.

### 5) Contexto para retomada

- Decisoes importantes: `git` e fonte de verdade de codigo; `docs/querobroapp-context.md` e fonte de verdade de contexto; toda sessao deve encerrar com handoff.
- Suposicoes feitas: `$HOME/querobroapp` e o repo principal em uso.
- Bloqueios: nenhum bloqueio tecnico imediato.
- Proximo passo recomendado (1 acao objetiva): preencher este log ao fim da proxima sessao com o template padrao.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Resumo da ultima sessao:
- Fluxo de continuidade entre canais foi padronizado.
- Arquivos criados: docs/querobroapp-context.md e docs/HANDOFF_TEMPLATE.md.
- README atualizado com secao de continuidade.
- Proximo passo: manter handoff em todas as sessoes.
```

## Entrada 002

### 1) Metadados

- Data/hora: 2026-02-11 23:08 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile, Codex Terminal/Cloud
- Repo path: `$HOME/querobroapp`
- Branch: `main`
- Commit base (opcional): `6c02b74`

### 2) Objetivo da sessao encerrada

- Objetivo: criar memoria persistente ampla para retomada sem historico de chat.
- Resultado entregue: criado pacote de memoria com vault consolidado, prompts de bootstrap e script de releitura.
- O que ficou pendente: manter atualizacao continua do `MEMORY_VAULT` e inserir nova entrada de handoff ao fim de cada sessao.

### 3) Mudancas tecnicas

- Arquivos alterados:
  - `docs/MEMORY_VAULT.md` (novo)
  - `docs/BOOTSTRAP_PROMPTS.md` (novo)
  - `scripts/relearn-context.sh` (novo, executavel)
  - `README.md` (secao de continuidade ampliada)
  - `docs/HANDOFF_LOG.md` (esta entrada)
- Comportamento novo: agora existe protocolo de releitura rapida e prompts prontos para retomar contexto em qualquer canal.
- Riscos/regressoes: baixo risco (mudancas documentais e script utilitario).

### 4) Validacao

- Comandos executados: `git status`, leitura de docs, `chmod +x scripts/relearn-context.sh`.
- Testes que passaram: nao aplicavel.
- Testes nao executados (e motivo): sem mudanca de runtime de API/Web/Mobile.

### 5) Contexto para retomada

- Decisoes importantes: memoria persistente deve ficar em arquivos versionados; nao depender de historico implícito da plataforma.
- Suposicoes feitas: `$HOME/querobroapp` permanece como repositorio principal.
- Bloqueios: nenhum bloqueio tecnico imediato.
- Proximo passo recomendado (1 acao objetiva): executar `scripts/relearn-context.sh` no inicio da proxima sessao e seguir com um objetivo unico.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp sem depender de memoria anterior.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 035

### 1) Metadados

- Data/hora: 2026-02-28 15:29 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Materializar a primeira versao funcional do novo app orientado por jornada, sem esperar um rewrite completo de backend.
- Resultado entregue: O web ganhou uma nova casca principal chamada `Broa do Dia`, com navegacao em `Hoje`, `Producao`, `Saidas`, `Caixa` e `Base`. A home agora abre em `Hoje`; `dashboard` e `jornada` viraram redirects para essa tela. As telas antigas (`pedidos`, `estoque`, `clientes`, `produtos`) continuam existindo como detalhe operacional.
- O que ficou pendente: O dominio ainda usa os modulos antigos por baixo. Esta rodada entregou a camada de produto/UX principal, mas nao reescreveu `Pedidos`, `Estoque` e `Caixa` como dominios dedicados do zero.

### 3) Mudancas tecnicas

- Arquivos alterados nesta wave:
- ` A apps/web/src/components/day-ops-view.tsx`
- ` A apps/web/src/app/hoje/page.tsx`
- ` A apps/web/src/app/producao/page.tsx`
- ` A apps/web/src/app/saidas/page.tsx`
- ` A apps/web/src/app/caixa/page.tsx`
- ` A apps/web/src/app/base/page.tsx`
- ` M apps/web/src/lib/navigation-model.ts`
- ` M apps/web/src/lib/operation-flow.ts`
- ` M apps/web/src/app/page.tsx`
- ` M apps/web/src/app/dashboard/page.tsx`
- ` M apps/web/src/app/jornada/page.tsx`
- ` M apps/web/src/app/layout.tsx`
- ` M apps/web/src/components/topbar.tsx`
- ` M apps/web/src/components/flow-dock.tsx`
- ` M docs/PROJECT_SNAPSHOT.md`
- ` M docs/querobroapp-context.md`
- ` M docs/HANDOFF_LOG.md`
- Comportamento novo: Existe agora uma visao operacional por superficie. `Hoje` concentra a leitura do dia; `Producao` mostra a fila de preparo; `Saidas` lista o que ja pode sair; `Caixa` foca no que falta receber; `Base` centraliza clientes, broas e receitas. O `FlowDock` e a navegacao passaram a apontar para essa jornada nova.
- Seguranca aplicada: O corte foi apenas de casca e navegacao. As regras de dominio e as telas antigas continuam acessiveis por baixo, o que reduz risco de regressao enquanto o novo produto amadurece.
- Riscos/regressoes: Ainda existe dualidade entre a casca nova e as telas legadas. O usuario ja entra no app novo, mas parte das acoes ainda aprofunda em `pedidos`, `estoque`, `clientes` e `produtos`.

### 4) Validacao

- Comandos executados: `pnpm --filter @querobroapp/web typecheck`
- Testes que passaram: O `typecheck` do web passou com as novas rotas, a nova navegacao e o componente operacional.
- Testes nao executados (e motivo): Nao houve smoke test visual em browser nesta rodada, entao a validacao foi estrutural por compilacao.

### 5) Contexto para retomada

- Decisoes importantes: Em vez de esperar um rewrite completo, a estrategia foi entregar primeiro o novo produto como casca funcional sobre o dominio existente. Isso permite testar a experiencia real antes de trocar as entranhas.
- Suposicoes feitas: O usuario queria o novo conceito materializado imediatamente, mesmo que a reescrita completa do dominio fique para rodadas seguintes.
- Bloqueios: Nenhum bloqueio tecnico imediato. O proximo limite e decidir se as telas legadas serao reescritas uma a uma ou se parte do backend tambem sera simplificada.
- Proximo passo recomendado (1 acao objetiva): Reescrever a tela de `Hoje` para incluir criacao rapida de compromisso diretamente nela, sem depender de entrar em `Pedidos`.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 037

### 1) Metadados

- Data/hora: 2026-02-28 19:45 -03
- Canal origem: Codex Terminal
- Canal destino: Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `feat/real-local-ops-flow-2026-02-28`
- Commit base (opcional): `2eb2110`

### 2) Objetivo da sessao encerrada

- Objetivo: Fechar as 3 integracoes aprovadas pelo usuario (Meta WhatsApp Cloud API no outbox, Uber Direct live mais robusto e Alexa com intent explicita) sem quebrar o fluxo local real.
- Resultado entregue: O outbox de WhatsApp agora tem dispatcher real pela Cloud API, com auto-dispatch quando houver credenciais e fallback por link quando ainda nao existir Flow publicado. O Uber live foi endurecido para separar `order_id` de `delivery_id`, aceitar o caminho atual por `store_id` e sincronizar tracking com mais robustez. A Alexa passou a priorizar intent explicita para iniciar fornada, deixando o fallback por utterance como opcional por env.
- O que ficou pendente: Falta apenas preencher as credenciais reais (`WHATSAPP_CLOUD_*`, `UBER_DIRECT_*`, `ALEXA_*`) para validar chamadas externas em producao/conta real.

### 3) Mudancas tecnicas

- Arquivos alterados nesta wave:
- ` M apps/api/src/modules/whatsapp/whatsapp.service.ts`
- ` M apps/api/src/modules/whatsapp/whatsapp.controller.ts`
- ` M apps/api/src/modules/deliveries/deliveries.service.ts`
- ` M apps/api/src/modules/alexa/alexa.service.ts`
- ` M apps/api/.env.example`
- ` M apps/web/src/features/orders/orders-api.ts`
- ` M apps/web/src/features/orders/orders-model.ts`
- ` M apps/web/src/features/orders/orders-screen.tsx`
- ` M docs/PROJECT_SNAPSHOT.md`
- ` M docs/querobroapp-context.md`
- ` M docs/HANDOFF_LOG.md`
- Comportamento novo:
- `POST /whatsapp/outbox/dispatch` agora despacha mensagens reais pela Meta Cloud API.
- `POST /whatsapp/flows/order-intake/launch` e `submit` tentam auto-dispatch quando houver `WHATSAPP_CLOUD_*`.
- O convite do WhatsApp Flow usa `interactive flow` se houver `WHATSAPP_FLOW_ORDER_INTAKE_ID`; sem isso, cai para texto com link da sessao.
- O tracking de entrega agora preserva `providerOrderId` e `providerDeliveryId`, e o webhook tenta sincronizar por `resource_href`, `meta.order_id` ou `meta.external_order_id`.
- `UBER_DIRECT_STORE_ID` habilita o caminho live mais atual (`/v1/eats/deliveries/estimates` + `/v1/eats/deliveries/orders`); sem ele, o codigo ainda suporta o caminho legado por `customer_id`.
- A Alexa exige slot de minutos nas intents de forno; o fallback por texto so roda com `ALEXA_TIMER_UTTERANCE_FALLBACK_ENABLED=true`.
- Seguranca aplicada: O outbox continua sendo a trilha de auditoria de WhatsApp. O envio automatico so acontece quando as credenciais existem. O bridge da Alexa manteve token, assinatura e replay protection.
- Riscos/regressoes:
- Sem credenciais, o dispatcher do WhatsApp nao envia e deixa o item em `PENDING`.
- O payload live atual da Uber foi alinhado ao contrato mais recente conhecido, mas ainda depende de validar os campos finais com as credenciais reais da conta.

### 4) Validacao

- Comandos executados:
- `pnpm --filter @querobroapp/api typecheck`
- `pnpm --filter @querobroapp/web typecheck`
- `curl -s -X POST http://127.0.0.1:3001/whatsapp/flows/order-intake/launch ...`
- `curl -s http://127.0.0.1:3001/deliveries/orders/6/tracking`
- Testes que passaram:
- API e Web compilaram sem erro.
- O launch do WhatsApp Flow retornou os novos campos `metaDispatchMode`, `dispatchStatus`, `dispatchTransport` e `dispatchError`.
- Um tracking legado/local continuou legivel e passou a expor `providerOrderId` normalizado sem quebrar o contrato atual.
- Testes nao executados (e motivo):
- Nao houve envio real na Meta nem criacao live na Uber porque as credenciais privadas nao foram preenchidas nesta sessao.

### 5) Contexto para retomada

- Decisoes importantes:
- O app segue funcional localmente mesmo sem provedores externos.
- O caminho live foi acoplado por env e mantido com fallback seguro.
- A Alexa agora trata utterance como fallback legado, nao como caminho principal.
- Proximo passo recomendado (1 acao objetiva): Preencher `WHATSAPP_CLOUD_*`, `UBER_DIRECT_*` e `ALEXA_*` no ambiente local e validar um ciclo real com numero/conta de teste.

## Entrada 037

### 1) Metadados

- Data/hora: 2026-02-28 19:10 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `5b3c138`

### 2) Objetivo da sessao encerrada

- Objetivo: Trocar o fluxo “mock” por um fluxo operacional real e local, ligando pedido, producao, estoque, Alexa e entrega.
- Resultado entregue: O backend agora executa a jornada real: pedido via WhatsApp Flow pode ser confirmado, entra em fila de producao, a fornada baixa estoque no inicio (1 forno, 14 broas por vez), a conclusao da fornada deixa o pedido pronto e dispara entrega com tracking persistente. Sem credenciais Uber, o sistema cai em simulacao local; com credenciais, tenta o caminho live antes do fallback.
- O que ficou pendente: O dispatcher real do outbox para Meta WhatsApp Cloud API ainda nao foi ligado. O caminho live da Uber depende de preencher `UBER_DIRECT_*`. O mobile ainda nao recebeu essa mesma camada de fluxo.

### 3) Mudancas tecnicas

- Mudanca estrutural principal: `apps/api/src/modules/orders/orders.service.ts` deixou de baixar estoque no momento da criacao/edicao do pedido. A baixa agora ocorre apenas na producao real.
- Novo comportamento real em `apps/api/src/modules/production/production.service.ts`:
- `GET /production/queue`
- `POST /production/batches/start-next`
- `POST /production/batches/:id/complete`
- `POST /production/rebalance-legacy-consumption`
- A producao agora persiste o estado do forno em `IdempotencyRecord` (`scope=PRODUCTION_RUNTIME`) e usa `InventoryMovement` com `source=PRODUCTION_BATCH`.
- `apps/api/src/modules/deliveries/deliveries.service.ts` passou a persistir tracking por pedido em `IdempotencyRecord` (`scope=DELIVERY_TRACKING`) e ganhou:
- `POST /deliveries/orders/:id/uber-direct/dispatch`
- `GET /deliveries/orders/:id/tracking`
- `POST /deliveries/orders/:id/tracking/complete`
- `POST /deliveries/uber-direct/webhook`
- `apps/api/src/modules/alexa/alexa.service.ts` agora detecta intent/utterance com minutos de timer e aciona a proxima fornada real via `ProductionService`.
- `apps/web/src/features/orders/orders-screen.tsx` recebeu:
- leitura do forno em tempo real por polling
- bloco `Operacao real` no detalhe do pedido
- botoes reais para entrar no forno, concluir fornada, enviar entrega e marcar entregue
- troca do “zoom +/-” por seletor direto `Dia | Semana | Mes`
- corte do avanço manual de status nas etapas criticas (producao/entrega)
- `apps/web/src/app/estoque/page.tsx` simplificou a ficha tecnica visivel: campos avancados ficaram recolhidos e a lista passou a mostrar nome, peso, valor e link de compra quando houver oferta recomendada.
- `apps/api/.env.example` ganhou flags novas para despacho/tracking Uber live com fallback local.

### 4) Validacao

- Comandos executados:
- `pnpm --filter @querobroapp/api typecheck`
- `pnpm --filter @querobroapp/web typecheck`
- Smoke/API real validada:
- `PATCH /orders/6/status` -> `CONFIRMADO`
- `GET /production/queue` mostrou o pedido aguardando Alexa/gatilho
- `POST /production/batches/start-next` iniciou a fornada com 7 broas
- `GET /orders/6` passou para `EM_PREPARACAO`
- `POST /production/batches/:id/complete` concluiu a fornada
- `GET /deliveries/orders/6/tracking` criou tracking local persistente
- `POST /deliveries/orders/6/tracking/complete` marcou a entrega
- `GET /orders/6` passou para `ENTREGUE` com pagamento ainda pendente
- `POST /production/rebalance-legacy-consumption` criou 28 movimentos compensatorios para neutralizar a baixa antiga em pedidos ainda abertos/ativos
- Smoke visual:
- `/pedidos` abre com `Dia | Semana | Mes`
- o detalhe do pedido exibe o bloco `Operacao real`

### 5) Contexto para retomada

- Decisao importante: manter o app funcional localmente mesmo sem credenciais externas, via fallback persistente e rastreavel, em vez de deixar a UX bloqueada esperando integracoes externas.
- Suposicao feita: a fila de producao usa a BOM atual para derivar broas por venda; a capacidade do forno foi fixada em 14 broas e o tempo de forno em 50 minutos.
- Risco conhecido: pedidos antigos ja criados no modelo anterior ainda carregavam baixas antigas; a normalizacao compensatoria foi aplicada apenas para pedidos ativos, preservando o historico bruto no banco.
- Proximo passo recomendado (1 acao objetiva): Ligar o dispatcher real do outbox WhatsApp para enviar o convite do Flow pela Meta Cloud API quando as credenciais estiverem disponiveis.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
Ligar o provider real que ainda estiver faltando (Meta WhatsApp Cloud API ou Uber live) sem quebrar o fluxo local.

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 003

### 1) Metadados

- Data/hora: 2026-02-11 23:25 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `$HOME/querobroapp`
- Branch: `main`
- Commit base (opcional): `6a7f49a`

### 2) Objetivo da sessao encerrada

- Objetivo: automatizar salvamento de handoff antes de fechar sessao.
- Resultado entregue: criado `scripts/save-handoff.sh` e atalho `Desktop/Salvar Handoff.command`.
- O que ficou pendente: revisar e commitar as mudancas se desejar publicar no remoto.

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M README.md`
- ` M scripts/dev-all.sh`
- `?? scripts/install-autostart.sh`
- `?? scripts/save-handoff.sh`
- `?? scripts/uninstall-autostart.sh`
- Comportamento novo: geracao automatica de nova entrada no `HANDOFF_LOG` via script.
- Riscos/regressoes: baixo risco (somente automacao de documentacao).

### 4) Validacao

- Comandos executados: criacao do script, criacao do atalho de Desktop e teste de execucao.
- Testes que passaram: `zsh -n scripts/save-handoff.sh` e execucao real com criacao da Entrada 003.
- Testes nao executados (e motivo): testes de API/Web/Mobile nao aplicaveis.

### 5) Contexto para retomada

- Decisoes importantes: usar `Salvar Handoff.command` ao encerrar sessoes para registrar memoria operacional.
- Suposicoes feitas: o encerramento manual por atalho antes de fechar a sessao e aceitavel no fluxo.
- Bloqueios: nenhum bloqueio tecnico imediato.
- Proximo passo recomendado (1 acao objetiva): executar `Desktop/Salvar Handoff.command` no fim da proxima sessao.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 029

### 1) Metadados

- Data/hora: 2026-02-27 20:41 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Remover a sessao Resumo e enxugar a tela de Pedidos, eliminando blocos sem interacao e mantendo apenas avisos e areas acionaveis.
- Resultado entregue: `Resumo` saiu da navegacao; `/dashboard` agora redireciona para `/pedidos`; em `Pedidos` foram removidos os strips e cards apenas informativos (KPIs, faixas de resumo do calendario e resumo estatico do pedido selecionado), preservando filtros, calendario clicavel, detalhe do pedido, avisos e a operacao.
- O que ficou pendente: O build de producao do web nao concluiu neste ambiente por falta de rede para baixar Google Fonts; nao houve erro de typecheck ou lint relacionado a estas mudancas.

### 3) Mudancas tecnicas

- Arquivos alterados nesta rodada:
- `M apps/web/src/lib/navigation-model.ts`
- `M apps/web/src/app/dashboard/page.tsx`
- `M apps/web/src/app/pedidos/page.tsx`
- `M apps/web/src/components/builder-layout.tsx`
- `M docs/HANDOFF_LOG.md`
- Comportamento novo: `Pedidos` virou a visao principal sem atalho para `Resumo`; o calendario e os detalhes continuam acionaveis, mas os blocos puramente estaticos foram removidos para reduzir ruido visual. Cards customizados do builder sem CTA tambem deixaram de renderizar, e os rotulos remanescentes de "resumo" no fluxo de Pedidos foram renomeados.
- Riscos/regressoes: O `Pedidos` ainda tem textos de contexto curtos dentro de blocos interativos (labels, contadores e instrucoes), mas nao restaram areas dedicadas apenas a exibicao fora dos avisos e do proprio contexto funcional. Qualquer card customizado sem acao agora fica oculto por padrao.

### 4) Validacao

- Comandos executados: `pnpm --filter @querobroapp/web typecheck`; `pnpm --filter @querobroapp/web lint`; `pnpm --filter @querobroapp/web build`
- Testes que passaram: `typecheck` e `lint` do `apps/web` passaram sem erros.
- Testes nao executados (e motivo): O `build` nao concluiu porque o ambiente atual esta sem acesso a `fonts.googleapis.com`, e o `next/font` falhou ao buscar `Cormorant Garamond` e `Manrope`.

### 5) Contexto para retomada

- Decisoes importantes: A remocao foi conservadora: cortei blocos inteiros sem acao e mantive somente elementos que participam do fluxo (filtros, botoes, calendario, cards clicaveis, formularios e avisos).
- Suposicoes feitas: O pedido "remova areas e blocos que nao possuem nenhuma interacao" se aplica aos containers estaticos de resumo, nao a labels e textos auxiliares dentro de componentes acionaveis.
- Bloqueios: Nenhum bloqueio funcional local; apenas a restricao de rede para validar `next build`.
- Proximo passo recomendado (1 acao objetiva): Validar visualmente a tela de `Pedidos` em uso real e, se ainda houver ruido, fazer uma segunda passada focada em microtextos e labels dentro das areas interativas.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 004

### 1) Metadados

- Data/hora: 2026-02-12 01:18 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `96f85a9`

### 2) Objetivo da sessao encerrada

- Objetivo: Concluir integracao modular Builder + receipts e validar fluxo ponta a ponta com Atalhos.
- Resultado entregue: Builder modular consolidado (tema/forms/home/integracoes/layout), receipts ligado ao bloco Integracoes, preview de layout em runtime e teste e2e validado com mock OpenAI.
- O que ficou pendente: Executar teste OCR real com OPENAI_API_KEY valida e validar atalho iOS no aparelho em rede local.

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M README.md`
- ` M apps/api/src/app.module.ts`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/receipts/receipts.module.ts`
- ` M apps/api/src/modules/receipts/receipts.service.ts`
- ` M apps/web/src/app/clientes/page.tsx`
- ` M apps/web/src/app/dashboard/page.tsx`
- ` M apps/web/src/app/estoque/page.tsx`
- ` M apps/web/src/app/globals.css`
- ` M apps/web/src/app/layout.tsx`
- ` M apps/web/src/app/page.tsx`
- ` M apps/web/src/app/pedidos/page.tsx`
- ` M apps/web/src/app/produtos/page.tsx`
- ` M apps/web/src/components/nav.tsx`
- ` M apps/web/src/components/topbar.tsx`
- ` M docs/IOS_SHORTCUT_CUPOM.md`
- ` M packages/shared/src/index.ts`
- ` M scripts/dev-all.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? apps/api/src/modules/builder/`
- `?? apps/web/src/app/builder/`
- `?? apps/web/src/components/builder-layout.tsx`
- `?? apps/web/src/components/builder-runtime-theme.tsx`
- `?? apps/web/src/lib/builder-layout.ts`
- `?? apps/web/src/lib/builder.ts`
- Comportamento novo: API de receipts agora respeita configuracoes de Integracoes do Builder e bloqueia parse quando shortcutsEnabled=false; layout pages atualizam em tempo real por evento builder:config-updated.
- Riscos/regressoes: Baixo risco; principal risco e variacao de OCR em cupom real e necessidade de ajuste fino do prompt.

### 4) Validacao

- Comandos executados: pnpm --filter @querobroapp/shared build; pnpm --filter @querobroapp/api typecheck; pnpm --filter @querobroapp/web typecheck; eslint em arquivos alterados; curl e2e com mock OpenAI em :3900 e API em :3101; scripts/stop-all.sh
- Testes que passaram: Build/typecheck/lint passaram; e2e receipts validado (separador e prompt refletidos; bloqueio quando shortcutsEnabled=false; restore de config confirmado).
- Testes nao executados (e motivo): Nao foi executado OCR real com API OpenAI por ausencia de OPENAI_API_KEY no ambiente atual.

### 5) Contexto para retomada

- Decisoes importantes: Persistencia de Builder em data/builder/config.json; receipts usa shortcutsEnabled/receiptsPrompt/receiptsSeparator do Builder; manter token opcional via RECEIPTS_API_TOKEN; mascarar token no script de setup.
- Suposicoes feitas: Assumido que encerramento da sessao inclui parar servidores locais e registrar handoff no log do projeto.
- Bloqueios: Sem bloqueios tecnicos locais; pendencia externa de chave OPENAI e teste no iPhone.
- Proximo passo recomendado (1 acao objetiva): Amanha: configurar OPENAI_API_KEY no ambiente da API e rodar teste real do atalho iOS com foto de cupom, confirmando copia para Numbers.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 005

### 1) Metadados

- Data/hora: 2026-02-12 17:41 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `ca91e10`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (23 itens no git status).
- O que ficou pendente: Publicar baseline tecnico no remoto (`main`)

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .gitignore`
- ` M README.md`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prisma`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/app.controller.ts`
- ` M apps/api/src/app.module.ts`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/builder/builder.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.service.ts`
- ` M docs/IOS_SHORTCUT_CUPOM.md`
- ` M pnpm-lock.yaml`
- ` M scripts/setup-receipts-openai.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? apps/api/prisma/migrations/20260212191335_add_idempotency_records/`
- `?? apps/api/src/security/`
- `?? docs/BENCHMARK_GAP_MAP_2026-02-12.md`
- `?? docs/DEMO_CHECKLIST_GABI.md`
- `?? scripts/install-desktop-launchers.sh`
- `?? scripts/start-desktop-app.sh`
- `?? scripts/stop-desktop-app.sh`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: Desktop/Salvar Handoff.command; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Publicar baseline tecnico no remoto (`main`)

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 006

### 1) Metadados

- Data/hora: 2026-02-12 17:45 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `ca91e10`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (24 itens no git status).
- O que ficou pendente: Publicar baseline tecnico no remoto (`main`)

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .gitignore`
- ` M README.md`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prisma`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/app.controller.ts`
- ` M apps/api/src/app.module.ts`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/builder/builder.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.service.ts`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/IOS_SHORTCUT_CUPOM.md`
- ` M pnpm-lock.yaml`
- ` M scripts/setup-receipts-openai.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? apps/api/prisma/migrations/20260212191335_add_idempotency_records/`
- `?? apps/api/src/security/`
- `?? docs/BENCHMARK_GAP_MAP_2026-02-12.md`
- `?? docs/DEMO_CHECKLIST_GABI.md`
- `?? scripts/install-desktop-launchers.sh`
- `?? scripts/start-desktop-app.sh`
- `?? scripts/stop-desktop-app.sh`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: Desktop/Salvar Handoff.command; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Publicar baseline tecnico no remoto (`main`)

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 007

### 1) Metadados

- Data/hora: 2026-02-12 17:50 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `ca91e10`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (24 itens no git status).
- O que ficou pendente: Publicar baseline tecnico no remoto (`main`)

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .gitignore`
- ` M README.md`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prisma`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/app.controller.ts`
- ` M apps/api/src/app.module.ts`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/builder/builder.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.service.ts`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/IOS_SHORTCUT_CUPOM.md`
- ` M pnpm-lock.yaml`
- ` M scripts/setup-receipts-openai.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? apps/api/prisma/migrations/20260212191335_add_idempotency_records/`
- `?? apps/api/src/security/`
- `?? docs/BENCHMARK_GAP_MAP_2026-02-12.md`
- `?? docs/DEMO_CHECKLIST_GABI.md`
- `?? scripts/install-desktop-launchers.sh`
- `?? scripts/start-desktop-app.sh`
- `?? scripts/stop-desktop-app.sh`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: Desktop/Salvar Handoff.command; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Publicar baseline tecnico no remoto (`main`)

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 008

### 1) Metadados

- Data/hora: 2026-02-12 17:51 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `ca91e10`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (24 itens no git status).
- O que ficou pendente: Publicar baseline tecnico no remoto (`main`)

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .gitignore`
- ` M README.md`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prisma`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/app.controller.ts`
- ` M apps/api/src/app.module.ts`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/builder/builder.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.service.ts`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/IOS_SHORTCUT_CUPOM.md`
- ` M pnpm-lock.yaml`
- ` M scripts/setup-receipts-openai.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? apps/api/prisma/migrations/20260212191335_add_idempotency_records/`
- `?? apps/api/src/security/`
- `?? docs/BENCHMARK_GAP_MAP_2026-02-12.md`
- `?? docs/DEMO_CHECKLIST_GABI.md`
- `?? scripts/install-desktop-launchers.sh`
- `?? scripts/start-desktop-app.sh`
- `?? scripts/stop-desktop-app.sh`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: Desktop/Salvar Handoff.command; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Publicar baseline tecnico no remoto (`main`)

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 009

### 1) Metadados

- Data/hora: 2026-02-12 17:55 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `ca91e10`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (24 itens no git status).
- O que ficou pendente: Publicar baseline tecnico no remoto (`main`)

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .gitignore`
- ` M README.md`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prisma`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/app.controller.ts`
- ` M apps/api/src/app.module.ts`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/builder/builder.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.service.ts`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/IOS_SHORTCUT_CUPOM.md`
- ` M pnpm-lock.yaml`
- ` M scripts/setup-receipts-openai.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? apps/api/prisma/migrations/20260212191335_add_idempotency_records/`
- `?? apps/api/src/security/`
- `?? docs/BENCHMARK_GAP_MAP_2026-02-12.md`
- `?? docs/DEMO_CHECKLIST_GABI.md`
- `?? scripts/install-desktop-launchers.sh`
- `?? scripts/start-desktop-app.sh`
- `?? scripts/stop-desktop-app.sh`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: Desktop/Salvar Handoff.command; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Publicar baseline tecnico no remoto (`main`)

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 010

### 1) Metadados

- Data/hora: 2026-02-12 17:59 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `ca91e10`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (25 itens no git status).
- O que ficou pendente: Publicar baseline tecnico no remoto (`main`)

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .gitignore`
- ` M README.md`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prisma`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/app.controller.ts`
- ` M apps/api/src/app.module.ts`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/builder/builder.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.service.ts`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/IOS_SHORTCUT_CUPOM.md`
- ` M pnpm-lock.yaml`
- ` M scripts/setup-receipts-openai.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? apps/api/prisma/migrations/20260212191335_add_idempotency_records/`
- `?? apps/api/src/security/`
- `?? docs/BENCHMARK_GAP_MAP_2026-02-12.md`
- `?? docs/DEMO_CHECKLIST_GABI.md`
- `?? scripts/install-desktop-launchers.sh`
- `?? scripts/save-handoff-auto.sh`
- `?? scripts/start-desktop-app.sh`
- `?? scripts/stop-desktop-app.sh`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: scripts/save-handoff-auto.sh; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Publicar baseline tecnico no remoto (`main`)

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 011

### 1) Metadados

- Data/hora: 2026-02-13 11:50 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `12dd045`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada sem mudancas locais pendentes.
- O que ficou pendente: Publicar baseline tecnico no remoto (`main`)

### 3) Mudancas tecnicas

- Arquivos alterados:
- nenhum arquivo alterado no momento
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: scripts/save-handoff-auto.sh; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Publicar baseline tecnico no remoto (`main`)

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 012

### 1) Metadados

- Data/hora: 2026-02-13 11:51 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `12dd045`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (1 itens no git status).
- O que ficou pendente: Publicar baseline tecnico no remoto (`main`)

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M docs/HANDOFF_LOG.md`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: scripts/save-handoff-auto.sh; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Publicar baseline tecnico no remoto (`main`)

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 013

### 1) Metadados

- Data/hora: 2026-02-13 12:43 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `12dd045`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (1 itens no git status).
- O que ficou pendente: Publicar baseline tecnico no remoto (`main`)

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M docs/HANDOFF_LOG.md`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: scripts/save-handoff-auto.sh; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Publicar baseline tecnico no remoto (`main`)

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 014

### 1) Metadados

- Data/hora: 2026-02-13 12:45 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `12dd045`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (1 itens no git status).
- O que ficou pendente: Publicar baseline tecnico no remoto (`main`)

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M docs/HANDOFF_LOG.md`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: scripts/save-handoff-auto.sh; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Publicar baseline tecnico no remoto (`main`)

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 015

### 1) Metadados

- Data/hora: 2026-02-14 02:49 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `12dd045`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (12 itens no git status).
- O que ficou pendente: Publicar baseline tecnico no remoto (`main`)

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M README.md`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/modules/orders/orders.service.ts`
- ` M apps/api/src/modules/payments/payments.service.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/web/src/app/pedidos/page.tsx`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/IOS_SHORTCUT_CUPOM.md`
- ` M docs/PROJECT_SNAPSHOT.md`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? .playwright-cli/`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: scripts/save-handoff-auto.sh; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Publicar baseline tecnico no remoto (`main`)

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 016

### 1) Metadados

- Data/hora: 2026-02-14 02:49 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `12dd045`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (12 itens no git status).
- O que ficou pendente: Publicar baseline tecnico no remoto (`main`)

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M README.md`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/modules/orders/orders.service.ts`
- ` M apps/api/src/modules/payments/payments.service.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/web/src/app/pedidos/page.tsx`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/IOS_SHORTCUT_CUPOM.md`
- ` M docs/PROJECT_SNAPSHOT.md`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? .playwright-cli/`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: scripts/save-handoff-auto.sh; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Publicar baseline tecnico no remoto (`main`)

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 017

### 1) Metadados

- Data/hora: 2026-02-14 02:49 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `12dd045`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (12 itens no git status).
- O que ficou pendente: Publicar baseline tecnico no remoto (`main`)

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M README.md`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/modules/orders/orders.service.ts`
- ` M apps/api/src/modules/payments/payments.service.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/web/src/app/pedidos/page.tsx`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/IOS_SHORTCUT_CUPOM.md`
- ` M docs/PROJECT_SNAPSHOT.md`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? .playwright-cli/`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: scripts/save-handoff-auto.sh; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Publicar baseline tecnico no remoto (`main`)

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 018

### 1) Metadados

- Data/hora: 2026-02-19 18:05 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `12dd045`

### 2) Objetivo da sessao encerrada

- Objetivo: Encerrar sessao com hardening completo e preparar reinicializacao do computador.
- Resultado entregue: Hardening de seguranca aplicado e validado em app/repo/macOS; fluxos de auditoria e policy gate ativos.
- O que ficou pendente: Reiniciar o computador e retomar exclusivamente no conteudo do codigo do app (funcionalidades e interfaces).

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .github/workflows/basic-test.yml`
- ` M .github/workflows/ci.yml`
- ` M .gitignore`
- ` M README.md`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/orders/orders.service.ts`
- ` M apps/api/src/modules/payments/payments.service.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/web/src/app/builder/page.tsx`
- ` M apps/web/src/app/clientes/page.tsx`
- ` M apps/web/src/app/estoque/page.tsx`
- ` M apps/web/src/app/pedidos/page.tsx`
- ` M apps/web/src/app/produtos/page.tsx`
- ` M docs/BOOTSTRAP_PROMPTS.md`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/IOS_SHORTCUT_CUPOM.md`
- ` M docs/MEMORY_VAULT.md`
- ` M docs/PROJECT_SNAPSHOT.md`
- ` M docs/querobroapp-context.md`
- ` M package.json`
- ` M scripts/relearn-context.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? .githooks/`
- `?? .github/dependabot.yml`
- `?? .github/workflows/codeql.yml`
- `?? .github/workflows/dependency-review.yml`
- `?? .github/workflows/secret-policy-gate.yml`
- `?? .github/workflows/secret-scan.yml`
- `?? .nvmrc`
- `?? .playwright-cli/`
- `?? docs/ENGINEERING_HEALTH.md`
- `?? docs/SECRETS_SECURITY_PROCEDURE.md`
- `?? scripts/check-prisma-schema-drift.mjs`
- `?? scripts/install-git-hooks.sh`
- `?? scripts/secrets-vault.mjs`
- `?? scripts/security-github-hardening.mjs`
- `?? scripts/security-host-apply.sh`
- `?? scripts/security-host-audit.sh`
- `?? scripts/security-secret-policy-gate.mjs`
- `?? scripts/security-secrets-guard.mjs`
- `?? tests/prisma-schema-drift.test.mjs`
- Comportamento novo: Novos scripts e workflows de seguranca adicionados; API com bloqueios de startup inseguro em producao; auditorias locais e GitHub formalizadas.
- Riscos/regressoes: baixo risco residual; apenas observacao de unavailable para advanced_security em repo publico (esperado).

### 4) Validacao

- Comandos executados: pnpm security:host:apply; pnpm security:host:audit; pnpm security:github:audit; pnpm security:github:apply; pnpm security:secrets; pnpm security:policy:diff; pnpm --filter @querobroapp/api typecheck; scripts/save-handoff.sh
- Testes que passaram: security:host:audit (PASS 5/FAIL 0), security:github:audit/apply/audit com checks completos, security:secrets e security:policy:diff OK, api typecheck OK
- Testes nao executados (e motivo): nao aplicavel (objetivo principal foi hardening e documentacao de encerramento)

### 5) Contexto para retomada

- Decisoes importantes: Adotar modelo de seguranca por minimo privilegio com gates obrigatorios (secret scan + policy gate), branch protection e hardening de host.
- Suposicoes feitas: Repositorio local em ~/querobroapp e branch main mantidos como base da proxima sessao.
- Bloqueios: nenhum bloqueio tecnico aberto apos validacoes finais
- Proximo passo recomendado (1 acao objetiva): Apos reinicializacao: iniciar etapa focada apenas em funcionalidades e interfaces do app.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 019

### 1) Metadados

- Data/hora: 2026-02-20 09:08 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `f5f8820`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (52 itens no git status).
- O que ficou pendente: Validar app apos reinicializacao e registrar feedback de navegacao.

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .github/workflows/basic-test.yml`
- ` M .github/workflows/ci.yml`
- ` M .gitignore`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/orders/orders.service.ts`
- ` M apps/api/src/modules/payments/payments.service.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/web/src/app/builder/page.tsx`
- ` M apps/web/src/app/dashboard/page.tsx`
- ` M apps/web/src/app/estoque/page.tsx`
- ` M apps/web/src/app/globals.css`
- ` M apps/web/src/app/jornada/page.module.css`
- ` M apps/web/src/app/jornada/page.tsx`
- ` M apps/web/src/app/layout.tsx`
- ` M apps/web/src/app/page.tsx`
- ` M apps/web/src/app/produtos/page.tsx`
- ` M apps/web/src/components/form/FormField.tsx`
- ` M apps/web/src/components/nav.tsx`
- ` M apps/web/src/components/topbar.tsx`
- ` M docs/HANDOFF_LOG.md`
- ` M package.json`
- ` M scripts/relearn-context.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? .githooks/`
- `?? .github/dependabot.yml`
- `?? .github/workflows/codeql.yml`
- `?? .github/workflows/dependency-review.yml`
- `?? .github/workflows/secret-policy-gate.yml`
- `?? .github/workflows/secret-scan.yml`
- `?? .nvmrc`
- `?? .playwright-cli/`
- `?? apps/web/public/querobroa/brand/`
- `?? apps/web/src/components/flow-dock.tsx`
- `?? apps/web/src/hooks/`
- `?? apps/web/src/lib/operation-flow.ts`
- `?? docs/BRAND_ASSET_PIPELINE.md`
- `?? docs/CONSUMER_FLOW_REARCHITECTURE.md`
- `?? output/`
- `?? scripts/check-prisma-schema-drift.mjs`
- `?? scripts/install-git-hooks.sh`
- `?? scripts/secrets-vault.mjs`
- `?? scripts/security-github-hardening.mjs`
- `?? scripts/security-host-apply.sh`
- `?? scripts/security-host-audit.sh`
- `?? scripts/security-secret-policy-gate.mjs`
- `?? scripts/security-secrets-guard.mjs`
- `?? scripts/sync-brand-assets.sh`
- `?? tests/jornada-flow-e2e.test.mjs`
- `?? tests/prisma-schema-drift.test.mjs`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: scripts/save-handoff-auto.sh; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Validar app apos reinicializacao e registrar feedback de navegacao.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 020

### 1) Metadados

- Data/hora: 2026-02-20 14:22 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `f5f8820`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (50 itens no git status).
- O que ficou pendente: Validar app apos reinicializacao e registrar feedback de navegacao.

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .github/workflows/basic-test.yml`
- ` M .github/workflows/ci.yml`
- ` M .gitignore`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/orders/orders.service.ts`
- ` M apps/api/src/modules/payments/payments.service.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/web/src/app/builder/page.tsx`
- ` M apps/web/src/app/dashboard/page.tsx`
- ` M apps/web/src/app/estoque/page.tsx`
- ` M apps/web/src/app/globals.css`
- ` M apps/web/src/app/jornada/page.module.css`
- ` M apps/web/src/app/jornada/page.tsx`
- ` M apps/web/src/app/layout.tsx`
- ` M apps/web/src/app/page.tsx`
- ` M apps/web/src/app/produtos/page.tsx`
- ` M apps/web/src/components/form/FormField.tsx`
- ` M apps/web/src/components/nav.tsx`
- ` M apps/web/src/components/topbar.tsx`
- ` M docs/HANDOFF_LOG.md`
- ` M package.json`
- ` M scripts/relearn-context.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? .githooks/`
- `?? .github/dependabot.yml`
- `?? .github/workflows/codeql.yml`
- `?? .github/workflows/dependency-review.yml`
- `?? .github/workflows/secret-policy-gate.yml`
- `?? .github/workflows/secret-scan.yml`
- `?? .nvmrc`
- `?? apps/web/public/querobroa/brand/`
- `?? apps/web/src/components/flow-dock.tsx`
- `?? apps/web/src/hooks/`
- `?? apps/web/src/lib/operation-flow.ts`
- `?? docs/BRAND_ASSET_PIPELINE.md`
- `?? docs/CONSUMER_FLOW_REARCHITECTURE.md`
- `?? scripts/check-prisma-schema-drift.mjs`
- `?? scripts/install-git-hooks.sh`
- `?? scripts/secrets-vault.mjs`
- `?? scripts/security-github-hardening.mjs`
- `?? scripts/security-host-apply.sh`
- `?? scripts/security-host-audit.sh`
- `?? scripts/security-secret-policy-gate.mjs`
- `?? scripts/security-secrets-guard.mjs`
- `?? scripts/sync-brand-assets.sh`
- `?? tests/jornada-flow-e2e.test.mjs`
- `?? tests/prisma-schema-drift.test.mjs`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: scripts/save-handoff-auto.sh; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Validar app apos reinicializacao e registrar feedback de navegacao.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 021

### 1) Metadados

- Data/hora: 2026-02-20 15:09 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `f5f8820`

### 2) Objetivo da sessao encerrada

- Objetivo: Aprofundar e executar plano de UX operacional com foco em estoque e jornada real da QUEROBROA
- Resultado entregue: Pesquisa aplicada documentada e nova hierarquia da tela /estoque implementada (painel do dia, lista de compras D+1 e planejador de fornadas).
- O que ficou pendente: Validacao assistida com a Gabi em uso real (desktop/mobile) e evolucao para controle de fornadas com estados/timers.

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .github/workflows/basic-test.yml`
- ` M .github/workflows/ci.yml`
- ` M .gitignore`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/orders/orders.service.ts`
- ` M apps/api/src/modules/payments/payments.service.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/web/src/app/builder/page.tsx`
- ` M apps/web/src/app/dashboard/page.tsx`
- ` M apps/web/src/app/estoque/page.tsx`
- ` M apps/web/src/app/globals.css`
- ` M apps/web/src/app/jornada/page.module.css`
- ` M apps/web/src/app/jornada/page.tsx`
- ` M apps/web/src/app/layout.tsx`
- ` M apps/web/src/app/page.tsx`
- ` M apps/web/src/app/produtos/page.tsx`
- ` M apps/web/src/components/form/FormField.tsx`
- ` M apps/web/src/components/nav.tsx`
- ` M apps/web/src/components/topbar.tsx`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/NEXT_STEP_PLAN.md`
- ` M package.json`
- ` M packages/shared/src/index.ts`
- ` M scripts/relearn-context.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? .githooks/`
- `?? .github/dependabot.yml`
- `?? .github/workflows/codeql.yml`
- `?? .github/workflows/dependency-review.yml`
- `?? .github/workflows/secret-policy-gate.yml`
- `?? .github/workflows/secret-scan.yml`
- `?? .nvmrc`
- `?? apps/web/public/querobroa/brand/`
- `?? apps/web/src/components/flow-dock.tsx`
- `?? apps/web/src/hooks/`
- `?? apps/web/src/lib/operation-flow.ts`
- `?? docs/BRAND_ASSET_PIPELINE.md`
- `?? docs/CONSUMER_FLOW_REARCHITECTURE.md`
- `?? docs/ESTOQUE_UX_OPERACIONAL_PLAN_2026-02-20.md`
- `?? scripts/check-prisma-schema-drift.mjs`
- `?? scripts/install-git-hooks.sh`
- `?? scripts/secrets-vault.mjs`
- `?? scripts/security-github-hardening.mjs`
- `?? scripts/security-host-apply.sh`
- `?? scripts/security-host-audit.sh`
- `?? scripts/security-secret-policy-gate.mjs`
- `?? scripts/security-secrets-guard.mjs`
- `?? scripts/sync-brand-assets.sh`
- `?? tests/jornada-flow-e2e.test.mjs`
- `?? tests/prisma-schema-drift.test.mjs`
- Comportamento novo: Tela /estoque agora abre com foco operacional (fila, broas alvo, fornadas e faltas) antes dos blocos tecnicos.
- Riscos/regressoes: Baixo a medio; calculo de fila usa createdAt+1 por falta de campo de entrega prometida no dominio.

### 4) Validacao

- Comandos executados: pnpm --filter @querobroapp/shared build; pnpm --filter @querobroapp/web typecheck; pnpm --filter @querobroapp/web lint; curl /estoque e /health
- Testes que passaram: Typecheck web OK; lint web OK; API/web responderam HTTP 200.
- Testes nao executados (e motivo): Playwright CLI nao concluiu no ambiente (execucao travada), sem validacao headed completa.

### 5) Contexto para retomada

- Decisoes importantes: Separar operacao diaria da base tecnica e usar D+1 como gatilho principal de compra/producao.
- Suposicoes feitas: Fluxo D+1 segue baseado em pedido+1 dia ate existir campo de data/hora prometida no pedido.
- Bloqueios: Wrapper Playwright travou no ambiente; validacao visual ficou limitada ao HTML servido + lint/typecheck.
- Proximo passo recomendado (1 acao objetiva): Rodar teste guiado com a Gabi por 1 ciclo completo (planejar, comprar, produzir, expedir) e registrar 5 maiores friccoes.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 022

### 1) Metadados

- Data/hora: 2026-02-20 18:31 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Registrar handoff automatico no encerramento da sessao.
- Resultado entregue: Entrada automatica registrada com estado atual do repositorio (51 itens no git status).
- O que ficou pendente: Validar app apos reinicializacao e registrar feedback de navegacao.

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .github/workflows/basic-test.yml`
- ` M .github/workflows/ci.yml`
- ` M .gitignore`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/orders/orders.service.ts`
- ` M apps/api/src/modules/payments/payments.service.ts`
- ` M apps/web/src/app/builder/page.tsx`
- ` M apps/web/src/app/dashboard/page.tsx`
- ` M apps/web/src/app/jornada/page.module.css`
- ` M apps/web/src/app/layout.tsx`
- ` M apps/web/src/app/page.tsx`
- ` M apps/web/src/app/produtos/page.tsx`
- ` M apps/web/src/components/form/FormField.tsx`
- ` M apps/web/src/components/nav.tsx`
- ` M apps/web/src/components/topbar.tsx`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/NEXT_STEP_PLAN.md`
- ` M package.json`
- ` M packages/shared/src/index.ts`
- ` M scripts/relearn-context.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? .githooks/`
- `?? .github/dependabot.yml`
- `?? .github/workflows/codeql.yml`
- `?? .github/workflows/dependency-review.yml`
- `?? .github/workflows/secret-policy-gate.yml`
- `?? .github/workflows/secret-scan.yml`
- `?? .nvmrc`
- `?? .playwright-cli/`
- `?? apps/web/public/querobroa/brand/`
- `?? apps/web/src/components/flow-dock.tsx`
- `?? apps/web/src/hooks/`
- `?? apps/web/src/lib/operation-flow.ts`
- `?? docs/BRAND_ASSET_PIPELINE.md`
- `?? docs/CONSUMER_FLOW_REARCHITECTURE.md`
- `?? docs/ESTOQUE_UX_OPERACIONAL_PLAN_2026-02-20.md`
- `?? output/`
- `?? scripts/check-prisma-schema-drift.mjs`
- `?? scripts/install-git-hooks.sh`
- `?? scripts/secrets-vault.mjs`
- `?? scripts/security-github-hardening.mjs`
- `?? scripts/security-host-apply.sh`
- `?? scripts/security-host-audit.sh`
- `?? scripts/security-secret-policy-gate.mjs`
- `?? scripts/security-secrets-guard.mjs`
- `?? scripts/sync-brand-assets.sh`
- `?? tests/jornada-flow-e2e.test.mjs`
- `?? tests/prisma-schema-drift.test.mjs`
- Comportamento novo: Sem alteracao funcional nesta execucao; somente atualizacao documental automatica.
- Riscos/regressoes: baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado.

### 4) Validacao

- Comandos executados: scripts/save-handoff-auto.sh; scripts/save-handoff.sh
- Testes que passaram: nao aplicavel
- Testes nao executados (e motivo): nao aplicavel (encerramento documental)

### 5) Contexto para retomada

- Decisoes importantes: Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat.
- Suposicoes feitas: Repositorio local em ~/querobroapp com docs atualizados.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Validar app apos reinicializacao e registrar feedback de navegacao.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 023

### 1) Metadados

- Data/hora: 2026-02-25 18:57 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Implementar fluxo tutorial de primeira vez, atalho Enter em mensagens e rotina de limpeza de dados de teste.
- Resultado entregue: Tutorial 1a vez adicionado (home/clientes/pedidos), Enter agora confirma modais e aciona toast de acao, script de limpeza de dados de teste criado e executado, docs de reset atualizadas e ambiente reiniciado.
- O que ficou pendente: Validacao em uso real com voce e Gabi para ajustar microcopy/ordem de passos do tutorial.

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .github/workflows/basic-test.yml`
- ` M .github/workflows/ci.yml`
- ` M .gitignore`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/orders/orders.service.ts`
- ` M apps/api/src/modules/payments/payments.service.ts`
- ` M apps/web/src/app/builder/page.tsx`
- ` M apps/web/src/app/clientes/page.tsx`
- ` M apps/web/src/app/dashboard/page.tsx`
- ` M apps/web/src/app/estoque/page.tsx`
- ` M apps/web/src/app/globals.css`
- ` M apps/web/src/app/jornada/page.module.css`
- ` M apps/web/src/app/jornada/page.tsx`
- ` M apps/web/src/app/layout.tsx`
- ` M apps/web/src/app/page.tsx`
- ` M apps/web/src/app/pedidos/page.tsx`
- ` M apps/web/src/app/produtos/page.tsx`
- ` M apps/web/src/components/feedback-provider.tsx`
- ` M apps/web/src/components/form/FormField.tsx`
- ` M apps/web/src/components/nav.tsx`
- ` M apps/web/src/components/topbar.tsx`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/NEXT_STEP_PLAN.md`
- ` M package.json`
- ` M packages/shared/src/index.ts`
- ` M scripts/relearn-context.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? .githooks/`
- `?? .github/dependabot.yml`
- `?? .github/workflows/codeql.yml`
- `?? .github/workflows/dependency-review.yml`
- `?? .github/workflows/secret-policy-gate.yml`
- `?? .github/workflows/secret-scan.yml`
- `?? .nvmrc`
- `?? .playwright-cli/`
- `?? apps/web/public/querobroa/brand/`
- `?? apps/web/src/components/flow-dock.tsx`
- `?? apps/web/src/hooks/`
- `?? apps/web/src/lib/navigation-model.ts`
- `?? apps/web/src/lib/operation-flow.ts`
- `?? docs/BRAND_ASSET_PIPELINE.md`
- `?? docs/CONSUMER_FLOW_REARCHITECTURE.md`
- `?? docs/ESTOQUE_UX_OPERACIONAL_PLAN_2026-02-20.md`
- `?? docs/TEST_RESET_PROTOCOL.md`
- `?? output/`
- `?? packages/ui/dist/`
- `?? scripts/check-prisma-schema-drift.mjs`
- `?? scripts/cleanup-test-data.mjs`
- `?? scripts/install-git-hooks.sh`
- `?? scripts/preflight-local.sh`
- `?? scripts/secrets-vault.mjs`
- `?? scripts/security-github-hardening.mjs`
- `?? scripts/security-host-apply.sh`
- `?? scripts/security-host-audit.sh`
- `?? scripts/security-secret-policy-gate.mjs`
- `?? scripts/security-secrets-guard.mjs`
- `?? scripts/sync-brand-assets.sh`
- `?? tests/jornada-flow-e2e.test.mjs`
- `?? tests/prisma-schema-drift.test.mjs`
- Comportamento novo: Novo fluxo guiado de primeira vez, limpeza de teste no frontend e por script, e suporte de teclado Enter/Escape para confirmacoes/toasts.
- Riscos/regressoes: baixo a medio risco; em modo tutorial os registros recebem tag de teste e podem ser removidos pela rotina de limpeza.

### 4) Validacao

- Comandos executados: pnpm --filter @querobroapp/web typecheck; pnpm --filter @querobroapp/web lint; pnpm cleanup:test-data; ./scripts/stop-all.sh; ./scripts/dev-all.sh
- Testes que passaram: Typecheck e lint do web sem erros; limpeza de teste executada com sucesso.
- Testes nao executados (e motivo): Nao executei Playwright/manual E2E nesta rodada (foco em implementacao + reboot).

### 5) Contexto para retomada

- Decisoes importantes: Padrao de marcacao de teste definido como [TESTE_E2E]; limpeza por script pnpm cleanup:test-data; modo tutorial via query param tutorial=primeira_vez; Enter/Escape tratados no feedback-provider.
- Suposicoes feitas: Ambiente local de dev com API Web em 127.0.0.1 e fluxo de teste operando sobre dados marcados por tag.
- Bloqueios: nenhum
- Proximo passo recomendado (1 acao objetiva): Rodar um ciclo completo do tutorial 1a vez (cliente -> pedido -> pagamento) e registrar friccoes.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 024

### 1) Metadados

- Data/hora: 2026-02-25 19:57 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Implementar a proxima onda das recomendacoes do email OpenAI Dev News (agentic automations, compaction/prompt cache e voice ops realtime).
- Resultado entregue: Modulo de automacoes long-running com skills + compaction + shell allowlist, OCR com cache/compaction/telemetria configuraveis, e novo modulo de voz com sessao realtime e parser de comando operacional com opcao de autoexecucao.
- O que ficou pendente: UI web dedicada para operacao de automations/voice (hoje disponivel por endpoint API).

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M apps/api/.env.example`
- ` M apps/api/src/app.module.ts`
- ` M apps/api/src/modules/production/production.module.ts`
- ` M apps/api/src/modules/receipts/receipts.module.ts`
- ` M apps/api/src/modules/receipts/receipts.service.ts`
- ` M apps/web/src/app/builder/page.tsx`
- ` M docs/HANDOFF_LOG.md`
- ` M packages/shared/src/index.ts`
- `?? apps/api/src/modules/automations/automations.controller.ts`
- `?? apps/api/src/modules/automations/automations.module.ts`
- `?? apps/api/src/modules/automations/automations.service.ts`
- `?? apps/api/src/modules/voice/voice.controller.ts`
- `?? apps/api/src/modules/voice/voice.module.ts`
- `?? apps/api/src/modules/voice/voice.service.ts`
- `?? docs/OPENAI_DEV_NEWS_2026-02-25_ACTION_REPORT.md`
- Comportamento novo:
- API `automations`: runs assinc, skills (`D1_PURCHASE_PLAN`, `SUPPLIER_PRICE_SYNC`, `RECEIPTS_BATCH_INGEST`, `RUNBOOK_SHELL`), historico de eventos com compaction e persistencia em `data/automations/runs.json`.
- API `voice`: `POST /voice/realtime/session` (token efemero realtime), `POST /voice/command` (interpretacao de transcricao em acao com `autoExecute`).
- OCR receipts: cache de inferencia por hash + TTL, compaction de contexto do Builder, logs estruturados `receipts_ai_call`.
- Riscos/regressoes: baixo a medio; shell skill continua desabilitada por padrao e exige habilitacao/token explicitos.

### 4) Validacao

- Comandos executados:
- `pnpm --filter @querobroapp/shared build`
- `pnpm --filter @querobroapp/api typecheck`
- `pnpm --filter @querobroapp/api lint`
- `pnpm --filter @querobroapp/api build`
- `pnpm --filter @querobroapp/web typecheck`
- `pnpm --filter @querobroapp/web lint`
- `OPENAI_RECEIPTS_API_MODE=responses_websocket pnpm eval:receipts`
- smoke runtime `voice`: `POST /voice/command` (acao detectada) e `POST /voice/realtime/session` (client secret retornado)
- Testes que passaram: todos os comandos acima sem erro; eval de receipts passou em 3/3 cenarios.
- Testes nao executados (e motivo): E2E Playwright de UI de automations/voice nao aplicavel nesta rodada (sem tela dedicada ainda).

### 5) Contexto para retomada

- Decisoes importantes: manter automations/voice primeiro em API para acelerar entrega e validar operacao antes de investir em UI dedicada.
- Suposicoes feitas: ambiente com `OPENAI_API_KEY` disponivel para endpoints de voz e OCR.
- Bloqueios: nenhum tecnico no backend.
- Proximo passo recomendado (1 acao objetiva): Criar pagina web de Operacoes IA para listar/iniciar runs de automations e acionar comandos de voz em fluxo guiado.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 025

### 1) Metadados

- Data/hora: 2026-02-25 20:25 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Auditoria rigorosa de seguranca + bugs + jornada de navegacao/interacao com correcoes imediatas.
- Resultado entregue: hardening de automations/voice/receipts/builder, upgrade de dependencias web para linha corrigida de Next, reducao de CVEs do workspace, validacao de navegacao com Playwright e simplificacao do modo padrao da UI para operacao.
- O que ficou pendente: CVEs remanescentes na cadeia mobile (Expo/RN CLI) exigem upgrade dedicado do app mobile.

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M apps/api/.env.example`
- ` M apps/api/src/modules/automations/automations.controller.ts`
- ` M apps/api/src/modules/automations/automations.service.ts`
- ` M apps/api/src/modules/builder/builder.service.ts`
- ` M apps/api/src/modules/receipts/receipts.service.ts`
- ` M apps/api/src/modules/voice/voice.controller.ts`
- ` M apps/api/src/modules/voice/voice.service.ts`
- ` M apps/web/package.json`
- ` M apps/web/src/app/builder/page.tsx`
- ` M apps/web/src/app/estoque/page.tsx`
- ` M apps/web/src/hooks/use-surface-mode.ts`
- ` M package.json`
- ` M pnpm-lock.yaml`
- `?? docs/security_best_practices_report.md`
- Comportamento novo:
- `/automations` e `/voice` agora aceitam hardening por token dedicado (`x-automations-token` e `x-voice-token`) e exigem perfis `admin/operator`.
- scraping de preco no receipts com defesa SSRF (bloqueio de hosts/IPs privados e redirects inseguros).
- remocao de imagem no Builder com validacao de nome/path seguro.
- links externos de oferta no Estoque com sanitizacao de URL http(s).
- modo default de superficie em paginas operacionais alterado para `operation` (menos carga cognitiva inicial).
- Riscos/regressoes: upgrade para Next 15 exigiu ajuste do script `dev` com `NEXT_DISABLE_DEVTOOLS=1` para estabilidade no ambiente local.

### 4) Validacao

- Comandos executados:
- `pnpm security:secrets`
- `pnpm audit --prod`
- `pnpm --filter @querobroapp/shared build`
- `pnpm --filter @querobroapp/api typecheck && pnpm --filter @querobroapp/api lint && pnpm --filter @querobroapp/api build`
- `pnpm --filter @querobroapp/web lint && pnpm --filter @querobroapp/web build && pnpm --filter @querobroapp/web typecheck`
- `pnpm qa:smoke`
- `pnpm test`
- `OPENAI_RECEIPTS_API_MODE=responses_websocket pnpm eval:receipts`
- smoke Playwright (/, clientes, produtos, pedidos, estoque, dashboard, builder) sem erros de rede/console
- smoke runtime de tokens em API temporaria (porta 3015)
- Testes que passaram: todos os comandos acima passaram; CVEs de Next/backend foram eliminadas.
- Testes nao executados (e motivo): suite mobile dedicada nao executada nesta rodada (escopo principal web+api).

### 5) Contexto para retomada

- Decisoes importantes: manter foco de producao em web+api com hardening forte e tratar mobile como trilha de upgrade separada para limpar CVEs restantes.
- Suposicoes feitas: deploy de producao usa web+api e nao depende de toolchain Expo CLI em runtime.
- Bloqueios: nenhum bloqueio tecnico em web+api.
- Proximo passo recomendado (1 acao objetiva): abrir ciclo dedicado de upgrade `apps/mobile` (Expo/RN) ate eliminar `fast-xml-parser/tar` do audit.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 026

### 1) Metadados

- Data/hora: 2026-02-27 20:07 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Remover Inicio/Jornada, tornar Pedidos a visao principal, adicionar agenda de pedido com exportacao Uber e endurecer automacao de handoff/launcher.
- Resultado entregue: Pedidos virou entrada padrao, Jornada redireciona para Pedidos, pedidos agora aceitam/atualizam data e horario, o deeplink da Uber foi reforcado com endereco completo e resumo copiavel, e os atalhos/docs ganharam preflight e guardas locais.
- O que ficou pendente: Integracao 100% automatica com a Uber ainda exigiria API oficial; o macOS ainda requer concessao manual de Full Disk Access.

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .github/workflows/basic-test.yml`
- ` M .github/workflows/ci.yml`
- ` M .gitignore`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prisma`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/app.module.ts`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/builder/builder.service.ts`
- ` M apps/api/src/modules/orders/orders.service.ts`
- ` M apps/api/src/modules/payments/payments.service.ts`
- ` M apps/api/src/modules/production/production.module.ts`
- ` M apps/api/src/modules/production/production.service.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.module.ts`
- ` M apps/api/src/modules/receipts/receipts.service.ts`
- ` M apps/web/next-env.d.ts`
- ` M apps/web/package.json`
- ` M apps/web/src/app/builder/page.tsx`
- ` M apps/web/src/app/clientes/page.tsx`
- ` M apps/web/src/app/dashboard/page.tsx`
- ` M apps/web/src/app/estoque/page.tsx`
- ` M apps/web/src/app/globals.css`
- ` D apps/web/src/app/jornada/page.module.css`
- ` M apps/web/src/app/jornada/page.tsx`
- ` M apps/web/src/app/layout.tsx`
- ` M apps/web/src/app/page.tsx`
- ` M apps/web/src/app/pedidos/page.tsx`
- ` M apps/web/src/app/produtos/page.tsx`
- ` M apps/web/src/components/builder-layout.tsx`
- ` M apps/web/src/components/feedback-provider.tsx`
- ` M apps/web/src/components/form/FormField.tsx`
- ` M apps/web/src/components/nav.tsx`
- ` M apps/web/src/components/topbar.tsx`
- ` M apps/web/src/lib/format.ts`
- ` M apps/web/tailwind.config.ts`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/IOS_SHORTCUT_CUPOM.md`
- ` M docs/NEXT_STEP_PLAN.md`
- ` M package.json`
- ` M packages/shared/src/index.ts`
- ` M pnpm-lock.yaml`
- ` M scripts/install-desktop-launchers.sh`
- ` M scripts/relearn-context.sh`
- ` M scripts/save-handoff-auto.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? .githooks/`
- `?? .github/dependabot.yml`
- `?? .github/workflows/codeql.yml`
- `?? .github/workflows/dependency-review.yml`
- `?? .github/workflows/secret-policy-gate.yml`
- `?? .github/workflows/secret-scan.yml`
- `?? .nvmrc`
- `?? .playwright-cli/`
- `?? apps/api/prisma/migrations/20260227120000_add_order_scheduled_at/`
- `?? apps/api/src/modules/alexa/`
- `?? apps/api/src/modules/automations/`
- `?? apps/api/src/modules/voice/`
- `?? apps/web/public/querobroa/brand/`
- `?? apps/web/src/components/flow-dock.tsx`
- `?? apps/web/src/components/onboarding-tour-card.tsx`
- `?? apps/web/src/hooks/`
- `?? apps/web/src/lib/navigation-model.ts`
- `?? apps/web/src/lib/operation-flow.ts`
- `?? docs/ALEXA_CONNECTION_BENCHMARK.md`
- `?? docs/ALEXA_DEPLOY_CHECKLIST.md`
- `?? docs/APP_END_TO_END_GUIDE.md`
- `?? docs/BRAND_ASSET_PIPELINE.md`
- `?? docs/CONSUMER_FLOW_REARCHITECTURE.md`
- `?? docs/ESTOQUE_UX_OPERACIONAL_PLAN_2026-02-20.md`
- `?? docs/OPENAI_DEV_NEWS_2026-02-25_ACTION_REPORT.md`
- `?? docs/TEST_RESET_PROTOCOL.md`
- `?? docs/examples/`
- `?? docs/security_best_practices_report.md`
- `?? integrations/`
- `?? output/`
- `?? packages/ui/dist/`
- `?? scripts/alexa-bridge-setup.sh`
- `?? scripts/check-prisma-schema-drift.mjs`
- `?? scripts/check-session-docs.sh`
- `?? scripts/cleanup-test-data.mjs`
- `?? scripts/install-git-hooks.sh`
- `?? scripts/package-alexa-lambda.sh`
- `?? scripts/preflight-local.sh`
- `?? scripts/receipts-eval.mjs`
- `?? scripts/secrets-vault.mjs`
- `?? scripts/security-github-hardening.mjs`
- `?? scripts/security-host-apply.sh`
- `?? scripts/security-host-audit.sh`
- `?? scripts/security-secret-policy-gate.mjs`
- `?? scripts/security-secrets-guard.mjs`
- `?? scripts/start-desktop-shortcut.sh`
- `?? scripts/sync-brand-assets.sh`
- `?? tests/fixtures/`
- `?? tests/jornada-flow-e2e.test.mjs`
- `?? tests/prisma-schema-drift.test.mjs`
- Comportamento novo: Inicio e Jornada saem da navegacao; / e /jornada redirecionam para /pedidos; pedidos passam a ter scheduledAt editavel; D+1 usa deliveryDate quando houver; launcher do desktop abre preflight de Full Access; pre-commit passa a cobrar docs de continuidade.
- Riscos/regressoes: O macOS nao concede Full Access por script e o deeplink da Uber continua best-effort; sincronizacao total com Uber depende de integracao oficial.

### 4) Validacao

- Comandos executados: pnpm --filter @querobroapp/api prisma:generate; pnpm --filter @querobroapp/api prisma:migrate:dev; bash scripts/install-desktop-launchers.sh; pnpm --filter @querobroapp/shared build; pnpm --filter @querobroapp/api typecheck; pnpm --filter @querobroapp/api lint; pnpm --filter @querobroapp/api build; pnpm --filter @querobroapp/web typecheck; pnpm --filter @querobroapp/web lint; pnpm --filter @querobroapp/web build; node --test tests/jornada-flow-e2e.test.mjs
- Testes que passaram: shared build, api typecheck/lint/build, web typecheck/lint/build e migration local passaram.
- Testes nao executados (e motivo): E2E de jornada foi executado, mas ficou skipped porque a API local estava offline em http://127.0.0.1:3001.

### 5) Contexto para retomada

- Decisoes importantes: Manter scheduledAt separado de createdAt para preservar auditoria e usar a agenda como base da visao de pedidos e do D+1 quando existir.
- Suposicoes feitas: O usuario quer Pedidos como centro operacional e aceita um fallback local para limites de Full Access/Uber, com sincronizacao reforcada via docs locais.
- Bloqueios: nenhum bloqueio tecnico local; limites externos do macOS e da Uber permanecem.
- Proximo passo recomendado (1 acao objetiva): Validar o fluxo real em uso: editar horario em Pedidos, abrir/copy export Uber e confirmar se a operacao atende desktop e mobile.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 027

### 1) Metadados

- Data/hora: 2026-02-27 20:25 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Validar em navegador real o fluxo de Pedidos com data/hora e exportacao Uber apos as alteracoes desta sessao.
- Resultado entregue: Fluxo validado em browser real: foi possivel criar o Pedido #3 pela UI com cliente/produto de teste, o horario apareceu no calendario e no detalhe, e o deeplink da Uber passou a levar endereco completo quando o cliente tem endereco completo. Tambem foi confirmado que o horario pode ser editado e persistido.
- O que ficou pendente: O ambiente next dev continua apresentando instabilidade intermitente apos restart (404 de _next/static e um erro transitorio de modulo), embora o fluxo tenha estabilizado apos reinicio e recompilacao.

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .github/workflows/basic-test.yml`
- ` M .github/workflows/ci.yml`
- ` M .gitignore`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prisma`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/app.module.ts`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/builder/builder.service.ts`
- ` M apps/api/src/modules/orders/orders.service.ts`
- ` M apps/api/src/modules/payments/payments.service.ts`
- ` M apps/api/src/modules/production/production.module.ts`
- ` M apps/api/src/modules/production/production.service.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.module.ts`
- ` M apps/api/src/modules/receipts/receipts.service.ts`
- ` M apps/web/next-env.d.ts`
- ` M apps/web/package.json`
- ` M apps/web/src/app/builder/page.tsx`
- ` M apps/web/src/app/clientes/page.tsx`
- ` M apps/web/src/app/dashboard/page.tsx`
- ` M apps/web/src/app/estoque/page.tsx`
- ` M apps/web/src/app/globals.css`
- ` D apps/web/src/app/jornada/page.module.css`
- ` M apps/web/src/app/jornada/page.tsx`
- ` M apps/web/src/app/layout.tsx`
- ` M apps/web/src/app/page.tsx`
- ` M apps/web/src/app/pedidos/page.tsx`
- ` M apps/web/src/app/produtos/page.tsx`
- ` M apps/web/src/components/builder-layout.tsx`
- ` M apps/web/src/components/feedback-provider.tsx`
- ` M apps/web/src/components/form/FormField.tsx`
- ` M apps/web/src/components/nav.tsx`
- ` M apps/web/src/components/topbar.tsx`
- ` M apps/web/src/lib/format.ts`
- ` M apps/web/tailwind.config.ts`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/IOS_SHORTCUT_CUPOM.md`
- ` M docs/NEXT_STEP_PLAN.md`
- ` M package.json`
- ` M packages/shared/src/index.ts`
- ` M pnpm-lock.yaml`
- ` M scripts/install-desktop-launchers.sh`
- ` M scripts/relearn-context.sh`
- ` M scripts/save-handoff-auto.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- `?? .githooks/`
- `?? .github/dependabot.yml`
- `?? .github/workflows/codeql.yml`
- `?? .github/workflows/dependency-review.yml`
- `?? .github/workflows/secret-policy-gate.yml`
- `?? .github/workflows/secret-scan.yml`
- `?? .nvmrc`
- `?? .playwright-cli/`
- `?? apps/api/prisma/migrations/20260227120000_add_order_scheduled_at/`
- `?? apps/api/src/modules/alexa/`
- `?? apps/api/src/modules/automations/`
- `?? apps/api/src/modules/voice/`
- `?? apps/web/public/querobroa/brand/`
- `?? apps/web/src/components/flow-dock.tsx`
- `?? apps/web/src/components/onboarding-tour-card.tsx`
- `?? apps/web/src/hooks/`
- `?? apps/web/src/lib/navigation-model.ts`
- `?? apps/web/src/lib/operation-flow.ts`
- `?? docs/ALEXA_CONNECTION_BENCHMARK.md`
- `?? docs/ALEXA_DEPLOY_CHECKLIST.md`
- `?? docs/APP_END_TO_END_GUIDE.md`
- `?? docs/BRAND_ASSET_PIPELINE.md`
- `?? docs/CONSUMER_FLOW_REARCHITECTURE.md`
- `?? docs/ESTOQUE_UX_OPERACIONAL_PLAN_2026-02-20.md`
- `?? docs/OPENAI_DEV_NEWS_2026-02-25_ACTION_REPORT.md`
- `?? docs/TEST_RESET_PROTOCOL.md`
- `?? docs/examples/`
- `?? docs/security_best_practices_report.md`
- `?? integrations/`
- `?? output/`
- `?? packages/ui/dist/`
- `?? scripts/alexa-bridge-setup.sh`
- `?? scripts/check-prisma-schema-drift.mjs`
- `?? scripts/check-session-docs.sh`
- `?? scripts/cleanup-test-data.mjs`
- `?? scripts/install-git-hooks.sh`
- `?? scripts/package-alexa-lambda.sh`
- `?? scripts/preflight-local.sh`
- `?? scripts/receipts-eval.mjs`
- `?? scripts/secrets-vault.mjs`
- `?? scripts/security-github-hardening.mjs`
- `?? scripts/security-host-apply.sh`
- `?? scripts/security-host-audit.sh`
- `?? scripts/security-secret-policy-gate.mjs`
- `?? scripts/security-secrets-guard.mjs`
- `?? scripts/start-desktop-shortcut.sh`
- `?? scripts/sync-brand-assets.sh`
- `?? tests/fixtures/`
- `?? tests/jornada-flow-e2e.test.mjs`
- `?? tests/prisma-schema-drift.test.mjs`
- Comportamento novo: Pedido #3 criado pela UI em 2026-02-28 09:30 e depois editado para 11:45 com persistencia confirmada; em cliente com endereco completo o botao Abrir Uber passou a montar formatted_address completo.
- Riscos/regressoes: A automacao mostrou que salvar imediatamente apos preencher datetime-local pode reenviar o valor antigo se a acao for disparada rapido demais; em uso normal isso nao bloqueou, mas vale considerar debounce/confirmacao visual.

### 4) Validacao

- Comandos executados: Playwright CLI (open, snapshot, run-code, network, kill-all); curl local para verificar /orders/3; restart por ./scripts/stop-desktop-app.sh e ./scripts/start-desktop-app.sh.
- Testes que passaram: Validacao manual automatizada via Playwright da criacao e edicao do pedido #3 e verificacao de persistencia via API local passaram.
- Testes nao executados (e motivo): Nao foi rodada suite automatizada adicional nesta rodada; foco em validacao funcional interativa.

### 5) Contexto para retomada

- Decisoes importantes: Manter Pedidos como centro da validacao operacional e tratar a instabilidade do next dev como bug separado do fluxo funcional de negocio.
- Suposicoes feitas: Cliente com endereco completo deve produzir deeplink Uber completo; cliente com dados incompletos continua gerando deeplink incompleto por limitacao dos dados.
- Bloqueios: nenhum bloqueio funcional no fluxo principal; apenas instabilidade ocasional do ambiente de desenvolvimento web.
- Proximo passo recomendado (1 acao objetiva): Investigar e estabilizar o runtime do apps/web em next dev para eliminar 404 intermitente de assets e o erro Cannot find module no /pedidos.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 028

### 1) Metadados

- Data/hora: 2026-02-27 20:31 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Estabilizar o runtime de desenvolvimento do apps/web em next dev, eliminando o boot prematuro que gerava 404/ENOENT em .next.
- Resultado entregue: Os scripts de start agora limpam o cache local do web e esperam os manifests do Next antes do primeiro request. O start desktop passou a abrir direto em /pedidos. Depois da mudanca, o log novo do web subiu limpo e serviu /pedidos sem repetir os erros de manifest observados antes.
- O que ficou pendente: Continuar monitorando se o erro volta em cenarios de hot reload pesado durante muitas edicoes consecutivas; a principal corrida de boot foi tratada.

### 3) Mudancas tecnicas

- Arquivos alterados:
- ` M .github/workflows/basic-test.yml`
- ` M .github/workflows/ci.yml`
- ` M .gitignore`
- ` M apps/api/.env.example`
- ` M apps/api/package.json`
- ` M apps/api/prisma/schema.prisma`
- ` M apps/api/prisma/schema.prod.prisma`
- ` M apps/api/src/app.module.ts`
- ` M apps/api/src/main.ts`
- ` M apps/api/src/modules/builder/builder.service.ts`
- ` M apps/api/src/modules/orders/orders.service.ts`
- ` M apps/api/src/modules/payments/payments.service.ts`
- ` M apps/api/src/modules/production/production.module.ts`
- ` M apps/api/src/modules/production/production.service.ts`
- ` M apps/api/src/modules/receipts/receipts.controller.ts`
- ` M apps/api/src/modules/receipts/receipts.module.ts`
- ` M apps/api/src/modules/receipts/receipts.service.ts`
- ` M apps/web/next-env.d.ts`
- ` M apps/web/package.json`
- ` M apps/web/src/app/builder/page.tsx`
- ` M apps/web/src/app/clientes/page.tsx`
- ` M apps/web/src/app/dashboard/page.tsx`
- ` M apps/web/src/app/estoque/page.tsx`
- ` M apps/web/src/app/globals.css`
- ` D apps/web/src/app/jornada/page.module.css`
- ` M apps/web/src/app/jornada/page.tsx`
- ` M apps/web/src/app/layout.tsx`
- ` M apps/web/src/app/page.tsx`
- ` M apps/web/src/app/pedidos/page.tsx`
- ` M apps/web/src/app/produtos/page.tsx`
- ` M apps/web/src/components/builder-layout.tsx`
- ` M apps/web/src/components/feedback-provider.tsx`
- ` M apps/web/src/components/form/FormField.tsx`
- ` M apps/web/src/components/nav.tsx`
- ` M apps/web/src/components/topbar.tsx`
- ` M apps/web/src/lib/format.ts`
- ` M apps/web/tailwind.config.ts`
- ` M docs/HANDOFF_LOG.md`
- ` M docs/IOS_SHORTCUT_CUPOM.md`
- ` M docs/NEXT_STEP_PLAN.md`
- ` M package.json`
- ` M packages/shared/src/index.ts`
- ` M pnpm-lock.yaml`
- ` M scripts/dev-all.sh`
- ` M scripts/install-desktop-launchers.sh`
- ` M scripts/qa.sh`
- ` M scripts/relearn-context.sh`
- ` M scripts/save-handoff-auto.sh`
- ` M scripts/shortcut-receipts-setup.sh`
- ` M scripts/start-desktop-app.sh`
- `?? .githooks/`
- `?? .github/dependabot.yml`
- `?? .github/workflows/codeql.yml`
- `?? .github/workflows/dependency-review.yml`
- `?? .github/workflows/secret-policy-gate.yml`
- `?? .github/workflows/secret-scan.yml`
- `?? .nvmrc`
- `?? .playwright-cli/`
- `?? apps/api/prisma/migrations/20260227120000_add_order_scheduled_at/`
- `?? apps/api/src/modules/alexa/`
- `?? apps/api/src/modules/automations/`
- `?? apps/api/src/modules/voice/`
- `?? apps/web/public/querobroa/brand/`
- `?? apps/web/src/components/flow-dock.tsx`
- `?? apps/web/src/components/onboarding-tour-card.tsx`
- `?? apps/web/src/hooks/`
- `?? apps/web/src/lib/navigation-model.ts`
- `?? apps/web/src/lib/operation-flow.ts`
- `?? docs/ALEXA_CONNECTION_BENCHMARK.md`
- `?? docs/ALEXA_DEPLOY_CHECKLIST.md`
- `?? docs/APP_END_TO_END_GUIDE.md`
- `?? docs/BRAND_ASSET_PIPELINE.md`
- `?? docs/CONSUMER_FLOW_REARCHITECTURE.md`
- `?? docs/ESTOQUE_UX_OPERACIONAL_PLAN_2026-02-20.md`
- `?? docs/OPENAI_DEV_NEWS_2026-02-25_ACTION_REPORT.md`
- `?? docs/TEST_RESET_PROTOCOL.md`
- `?? docs/examples/`
- `?? docs/security_best_practices_report.md`
- `?? integrations/`
- `?? output/`
- `?? packages/ui/dist/`
- `?? scripts/alexa-bridge-setup.sh`
- `?? scripts/check-prisma-schema-drift.mjs`
- `?? scripts/check-session-docs.sh`
- `?? scripts/cleanup-test-data.mjs`
- `?? scripts/install-git-hooks.sh`
- `?? scripts/package-alexa-lambda.sh`
- `?? scripts/preflight-local.sh`
- `?? scripts/receipts-eval.mjs`
- `?? scripts/reset-web-dev-cache.sh`
- `?? scripts/secrets-vault.mjs`
- `?? scripts/security-github-hardening.mjs`
- `?? scripts/security-host-apply.sh`
- `?? scripts/security-host-audit.sh`
- `?? scripts/security-secret-policy-gate.mjs`
- `?? scripts/security-secrets-guard.mjs`
- `?? scripts/start-desktop-shortcut.sh`
- `?? scripts/sync-brand-assets.sh`
- `?? scripts/wait-web-dev-ready.sh`
- `?? tests/fixtures/`
- `?? tests/jornada-flow-e2e.test.mjs`
- `?? tests/prisma-schema-drift.test.mjs`
- Comportamento novo: Criados reset-web-dev-cache.sh e wait-web-dev-ready.sh; start-desktop-app/dev-all/qa agora limpam cache do web antes de subir; start-desktop-app truncou logs antes do bootstrap; web abre e valida em /pedidos em vez de /.
- Riscos/regressoes: Limpar .next a cada start aumenta um pouco o tempo do primeiro compile, mas reduz o risco de boot quebrado e assets inconsistentes.

### 4) Validacao

- Comandos executados: bash scripts/reset-web-dev-cache.sh; ./scripts/stop-desktop-app.sh; ./scripts/start-desktop-app.sh; bash -n scripts/reset-web-dev-cache.sh scripts/wait-web-dev-ready.sh scripts/start-desktop-app.sh scripts/dev-all.sh scripts/qa.sh
- Testes que passaram: Reinicio completo do ambiente com o novo readiness guard passou; sintaxe shell dos scripts alterados passou; o log novo do web registrou apenas compile/GET 200 de /pedidos.
- Testes nao executados (e motivo): Nao houve suite automatizada adicional de frontend nesta rodada; foco em scripts operacionais e validacao de boot.

### 5) Contexto para retomada

- Decisoes importantes: Tratar a instabilidade como race de boot do Next dev apos limpeza de .next, e nao como bug funcional de Pedidos. A solucao foi sincronizar a readiness por manifests e endpoint principal.
- Suposicoes feitas: O principal gatilho dos erros era o primeiro request chegar antes de .next gerar manifests minimos apos cache reset.
- Bloqueios: nenhum bloqueio ativo.
- Proximo passo recomendado (1 acao objetiva): Se o problema voltar sob hot reload intenso, investigar se ha necessidade de trocar o comando de dev do Next ou de isolar mais a pasta .next por sessao.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 030

### 1) Metadados

- Data/hora: 2026-02-28 13:59 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Consolidar a remocao operacional do Builder sem quebrar o app, fechar a lacuna do OCR de cupom que deixava o item LEITE para tras e registrar tudo com historico suficiente para continuidade segura.
- Resultado entregue: O fluxo de receipts agora combina `rawText` do Atalhos com OCR local da imagem antes de cair no fallback, o que reduz o risco de perder itens como `LEITE`. O Builder saiu da navegacao visivel, `/builder` passou a redirecionar para `/pedidos` e o backend exposto do Builder ficou reduzido a leitura (`GET /builder/config`), mantendo apenas o runtime interno necessario para receipts/layout.
- O que ficou pendente: A remocao estrutural completa do Builder ainda nao foi feita; `BuilderService`, `BuilderModule`, `data/builder/config.json` e o serving de uploads continuam por dependencia interna e exigem extracao de um servico neutro de runtime config antes de desaparecerem sem regressao.

### 3) Mudancas tecnicas

- Arquivos alterados nesta wave:
- ` M apps/api/src/modules/receipts/receipts.service.ts`
- ` M apps/api/src/modules/builder/builder.controller.ts`
- ` M apps/web/src/app/builder/page.tsx`
- `?? apps/web/src/lib/navigation-model.ts`
- ` M apps/web/src/lib/builder.ts`
- ` M docs/PROJECT_SNAPSHOT.md`
- ` M docs/querobroapp-context.md`
- ` M docs/HANDOFF_LOG.md`
- Comportamento novo: `ReceiptsService` passou a parsear `input.rawText` e o OCR da imagem, mesclar os resultados locais e so depois decidir o retorno; isso evita que um parse parcial do Atalhos esconda itens visiveis na nota. O menu `Builder` sumiu da operacao web e a rota `/builder` apenas redireciona. No backend, os endpoints mutaveis do Builder (`PUT/PATCH/POST/DELETE`) foram removidos do controller; ficou exposto somente `GET /builder/config`, reduzindo a superficie de escrita sem mexer no runtime que ainda abastece receipts/layout.
- Seguranca aplicada: A reducao foi feita por corte de superficie exposta, nao por remocao abrupta de dependencias internas. Assim, os pontos publicos de mutacao do Builder deixam de existir, mas a configuracao legada segue acessivel apenas para leitura onde o app ainda depende dela.
- Riscos/regressoes: Qualquer fluxo externo antigo que tentasse usar `PUT /builder/config`, `PATCH /builder/config/:block`, `POST /builder/home-images` ou `DELETE /builder/home-images/:id` vai falhar por design a partir desta sessao. A remocao total do modulo Builder continua sensivel e nao deve ser feita sem antes separar a configuracao de runtime usada por receipts/layout.

### 4) Validacao

- Comandos executados: `pnpm --filter @querobroapp/api typecheck`; `pnpm --filter @querobroapp/web typecheck`
- Testes que passaram: Typecheck da API passou apos a remocao dos endpoints mutaveis do Builder; typecheck do web passou apos a limpeza dos helpers mortos em `apps/web/src/lib/builder.ts`.
- Testes nao executados (e motivo): Nao houve smoke test manual do fluxo de Atalhos/estoque nesta rodada; a correcao do OCR foi validada por inspeção do texto extraido e pela consistencia do parse, mas nao por uma nova execucao completa via interface iOS.

### 5) Contexto para retomada

- Decisoes importantes: Tratar o Builder como infraestrutura interna legada e nao mais como superficie operacional. A estrategia segura foi esconder a UX, manter apenas leitura publica da config e preservar o que ainda sustenta receipts/layout.
- Suposicoes feitas: `GET /builder/config` continua necessario para `builder-runtime-theme` e `builder-layout`; por isso ele nao foi removido nesta passada.
- Bloqueios: nenhum bloqueio tecnico imediato, mas a remocao completa do Builder exige refatoracao de dependencia compartilhada antes.
- Proximo passo recomendado (1 acao objetiva): Extrair a configuracao de runtime usada por receipts/layout para um modulo neutro e, so depois disso, remover `BuilderModule` de `AppModule` e `ReceiptsModule`.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 031

### 1) Metadados

- Data/hora: 2026-02-28 14:36 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Concluir a extracao segura da configuracao interna para remover de vez o backend legado do Builder, mantendo receipts/layout funcionando e validando novamente o caso real do item LEITE.
- Resultado entregue: O app passou a usar `RuntimeConfigModule`/`RuntimeConfigService` como fonte neutra da configuracao legada. `ReceiptsService`, `AppModule`, `main.ts` e o helper web foram migrados para esse runtime-config. O endpoint principal agora e `GET /runtime-config`, com alias legado mantido em `GET /builder/config`, e os arquivos antigos de backend do Builder foram removidos.
- O que ficou pendente: Ainda restam nomes legados no frontend (`builder.ts`, `builder-layout`, `builder-runtime-theme`) por compatibilidade interna de nomenclatura; funcionalmente, eles ja leem o runtime-config neutro.

### 3) Mudancas tecnicas

- Arquivos alterados nesta wave:
- ` A apps/api/src/modules/runtime-config/runtime-config.service.ts`
- ` A apps/api/src/modules/runtime-config/runtime-config.controller.ts`
- ` A apps/api/src/modules/runtime-config/runtime-config.module.ts`
- ` M apps/api/src/modules/receipts/receipts.service.ts`
- ` M apps/api/src/modules/receipts/receipts.module.ts`
- ` M apps/api/src/app.module.ts`
- ` M apps/api/src/main.ts`
- ` D apps/api/src/modules/builder/builder.controller.ts`
- ` D apps/api/src/modules/builder/builder.module.ts`
- ` D apps/api/src/modules/builder/builder.service.ts`
- ` M apps/web/src/lib/builder.ts`
- ` M docs/PROJECT_SNAPSHOT.md`
- ` M docs/querobroapp-context.md`
- ` M docs/HANDOFF_LOG.md`
- Comportamento novo: `RuntimeConfigController` serve `GET /runtime-config` e tambem o alias legado `GET /builder/config`, ambos apontando para o mesmo `RuntimeConfigService` que le/escreve `data/builder/config.json`. O web tenta primeiro `/runtime-config` e cai no alias apenas como fallback. `ReceiptsService` nao depende mais de `BuilderService`.
- Seguranca aplicada: A reducao de superficie publica foi mantida e a dependencia legada foi eliminada do backend ativo, reduzindo codigo morto e pontos de confusao sem perder compatibilidade externa no endpoint legado.
- Riscos/regressoes: A nomenclatura interna do frontend ainda carrega prefixo `builder`, o que pode confundir manutencao futura, mas nao afeta o runtime. Documentos antigos de auditoria podem citar arquivos removidos do backend legado.

### 4) Validacao

- Comandos executados: `pnpm --filter @querobroapp/api typecheck`; `pnpm --filter @querobroapp/web typecheck`; `curl http://127.0.0.1:3001/runtime-config`; `curl http://127.0.0.1:3001/builder/config`; preview local em `POST /receipts/parse` com a foto `IMG_1541` e `rawText` parcial.
- Testes que passaram: API e web passaram em typecheck. `GET /runtime-config` e `GET /builder/config` responderam `200`. O preview de `receipts` continuou retornando `LEITE` (`hasLeite: true`) mesmo com `rawText` parcial, confirmando que a extracao do runtime nao quebrou a correção do OCR.
- Testes nao executados (e motivo): Nao houve nova ingestao real no estoque nem execucao direta no iPhone; a validacao foi feita em modo preview para evitar movimentacao duplicada.

### 5) Contexto para retomada

- Decisoes importantes: O backend legado do Builder foi removido de fato; a compatibilidade foi preservada no contrato HTTP, nao no modulo antigo. Isso reduz complexidade sem exigir mudanca imediata no frontend.
- Suposicoes feitas: Manter o alias `GET /builder/config` ainda ajuda qualquer cliente ou cache antigo enquanto o frontend transiciona totalmente para `runtime-config`.
- Bloqueios: nenhum bloqueio tecnico imediato.
- Proximo passo recomendado (1 acao objetiva): Renomear os artefatos legados do frontend (`builder.ts`, `builder-layout`, `builder-runtime-theme`) para nomes neutros, apenas como limpeza sem mudanca funcional.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 032

### 1) Metadados

- Data/hora: 2026-02-28 14:48 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Remover controles de UX que so aumentavam complexidade (tutorial e alternancia de telas) e simplificar o fluxo atual de Uber sem prometer um embed que a plataforma nao suporta no web.
- Resultado entregue: O app ficou travado no modo operacional, sem botoes de `painel do dia`, `painel avancado`, `Abrir tutorial` e sem o botao `Copiar dados Uber`. O tutorial foi desligado por hook. Em `Pedidos`, a Uber virou um bloco interno de revisao de entrega dentro do detalhe do pedido, com resumo e um unico CTA para abrir a Uber quando houver endereco valido.
- O que ficou pendente: A Uber continua sendo handoff externo no fim do fluxo. Um embed real dentro do app web nao foi implementado porque `m.uber.com` bloqueia iframe e a rota correta para algo realmente interno passa por integracao oficial de backend (ex.: Uber Direct API/credenciais de parceiro).

### 3) Mudancas tecnicas

- Arquivos alterados nesta wave:
- ` M apps/web/src/hooks/use-surface-mode.ts`
- ` M apps/web/src/hooks/use-tutorial-spotlight.ts`
- ` M apps/web/src/app/produtos/page.tsx`
- ` M apps/web/src/app/clientes/page.tsx`
- ` M apps/web/src/app/estoque/page.tsx`
- ` M apps/web/src/app/pedidos/page.tsx`
- ` M docs/HANDOFF_LOG.md`
- Comportamento novo: `useSurfaceMode` agora fixa o modo `operation`, eliminando alternancia de superficie. `useTutorialSpotlight` retorna tutorial desligado. As telas principais nao exibem mais os toggles de modo. Em `Pedidos`, a area de Uber foi internalizada como um card de conferência com destino, horario, resumo do pedido e o link final `Abrir Uber`.
- Seguranca aplicada: A decisao de nao embutir `m.uber.com` foi tecnica e segura. O endpoint externo da Uber responde com `X-Frame-Options: SAMEORIGIN`, o que impede iframe de terceiro; insistir nisso quebraria a UX e criaria uma falsa integracao.
- Riscos/regressoes: Campos que antes so apareciam no modo `full` permanecem no codigo, mas deixam de aparecer na interface enquanto a operacao simplificada estiver ativa. Se algum campo avancado voltar a ser necessario, o ideal e reincorporar somente esse campo no fluxo principal, e nao reabrir o modo inteiro.

### 4) Validacao

- Comandos executados: `pnpm --filter @querobroapp/web typecheck`; `rg -n "Abrir tutorial|painel do dia|painel avancado|Copiar dados Uber" apps/web/src/app apps/web/src/hooks apps/web/src/components`; `curl -I https://m.uber.com/`
- Testes que passaram: O `typecheck` do web passou. A busca por `Abrir tutorial`, `painel do dia`, `painel avancado` e `Copiar dados Uber` nao encontrou mais ocorrencias no codigo ativo. A checagem HTTP da Uber confirmou `X-Frame-Options: SAMEORIGIN`.
- Testes nao executados (e motivo): Nao houve navegacao visual em browser real nesta rodada para comparar layout final; a validacao foi estrutural por compilacao e inspeção de codigo.

### 5) Contexto para retomada

- Decisoes importantes: Em web, a Uber atual deve ser tratada como preparacao interna + handoff externo. Para algo realmente interno, a proxima etapa certa e desenhar integracao server-to-server com o produto correto da Uber, nao tentar iframe.
- Suposicoes feitas: O pedido do usuario foi simplificar agressivamente a operacao, aceitando esconder a alternancia de modos e o onboarding.
- Bloqueios: nenhum bloqueio tecnico imediato.
- Proximo passo recomendado (1 acao objetiva): Se a meta for Uber “dentro do app” de verdade, modelar um fluxo de cotacao/criacao via backend com credenciais oficiais da Uber e salvar o estado da entrega no proprio QUEROBROAPP.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 033

### 1) Metadados

- Data/hora: 2026-02-28 15:00 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Dar o primeiro passo concreto para Uber “dentro do app”, sem depender de iframe e sem criar corrida real sem controle.
- Resultado entregue: Foi criado um fluxo interno de readiness de Uber Direct. O backend agora expoe `GET /deliveries/orders/:id/uber-direct/readiness`, que monta o draft da entrega, valida dados do pedido/cliente, lista o que falta no cadastro e acusa quais credenciais oficiais ainda estao ausentes. A tela de `Pedidos` passou a consumir isso com o botao `Validar entrega Uber`, deixando o link externo apenas como fallback manual.
- O que ficou pendente: Ainda nao existe cotacao real nem criacao de entrega via API da Uber. Para isso, faltam credenciais (`UBER_DIRECT_*`) e a proxima etapa e implementar chamadas server-to-server do produto oficial escolhido.

### 3) Mudancas tecnicas

- Arquivos alterados nesta wave:
- ` A apps/api/src/modules/deliveries/deliveries.service.ts`
- ` A apps/api/src/modules/deliveries/deliveries.controller.ts`
- ` A apps/api/src/modules/deliveries/deliveries.module.ts`
- ` M apps/api/src/app.module.ts`
- ` M apps/api/.env.example`
- ` M apps/web/src/app/pedidos/page.tsx`
- ` M docs/PROJECT_SNAPSHOT.md`
- ` M docs/querobroapp-context.md`
- ` M docs/HANDOFF_LOG.md`
- Comportamento novo: O app agora consegue validar internamente se um pedido esta pronto para Uber Direct sem sair da tela. A resposta inclui `missingRequirements`, `missingConfiguration`, `manualHandoffUrl` e um `draft` com coleta, destino, telefone, resumo e total.
- Seguranca aplicada: Em vez de simular um embed quebrado ou disparar uma entrega real sem guarda de idempotencia, o fluxo novo e somente leitura/validacao. Isso reduz risco operacional e ainda prepara a integracao correta.
- Riscos/regressoes: O fluxo ainda nao cria entrega; ele so diagnostica prontidao. O botao manual continua necessario como fallback enquanto as credenciais e a integracao oficial nao entram.

### 4) Validacao

- Comandos executados: `pnpm --filter @querobroapp/api typecheck`; `pnpm --filter @querobroapp/web typecheck`; `curl http://127.0.0.1:3001/deliveries/orders/4/uber-direct/readiness`
- Testes que passaram: API e web passaram em typecheck. O endpoint de readiness respondeu `200` para o pedido `#4`, retornando o draft do pedido e a lista esperada de configuracoes ausentes (`UBER_DIRECT_*` e dados de coleta).
- Testes nao executados (e motivo): Nao houve navegacao visual no browser nem integracao real com a API da Uber, porque o projeto ainda nao possui credenciais oficiais configuradas.

### 5) Contexto para retomada

- Decisoes importantes: O caminho escolhido foi Uber Direct via backend, nao iframe. O readiness interno e a camada de preparacao antes de qualquer cotacao ou criacao real.
- Suposicoes feitas: Sem credenciais e sem idempotencia persistida, criar entrega de verdade nesta rodada seria mais arriscado do que util.
- Bloqueios: faltam credenciais oficiais da Uber (`customer_id`, `client_id`, `client_secret`) e os dados de coleta da loja.
- Proximo passo recomendado (1 acao objetiva): Implementar a rota de cotacao real da Uber Direct assim que as variaveis `UBER_DIRECT_*` forem definidas no ambiente da API.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 034

### 1) Metadados

- Data/hora: 2026-02-28 15:09 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Sair do readiness e adicionar a primeira cotacao real de Uber Direct dentro do QUEROBROAPP, sem criar entrega de verdade.
- Resultado entregue: O backend agora expoe `POST /deliveries/orders/:id/uber-direct/quote`, autenticando por `client_credentials`, pedindo `delivery_quotes` e retornando a taxa/ETA/expiracao quando a configuracao estiver pronta. A tela de `Pedidos` ganhou o botao `Cotar entrega Uber`, travado ate o readiness ficar pronto, com feedback inline do quote quando houver resposta.
- O que ficou pendente: Ainda nao existe criacao real de entrega, cancelamento, polling de status nem persistencia de `quote_id`. Isso deve entrar so depois de credenciais reais e idempotencia persistida.

### 3) Mudancas tecnicas

- Arquivos alterados nesta wave:
- ` M apps/api/src/modules/deliveries/deliveries.service.ts`
- ` M apps/api/src/modules/deliveries/deliveries.controller.ts`
- ` M apps/api/.env.example`
- ` M apps/web/src/app/pedidos/page.tsx`
- ` M docs/PROJECT_SNAPSHOT.md`
- ` M docs/querobroapp-context.md`
- ` M docs/HANDOFF_LOG.md`
- Comportamento novo: `DeliveriesService` agora tem `getUberDirectQuote(orderId)`. Ele reaproveita o readiness, bloqueia quando faltam dados, busca token OAuth da Uber com cache curto em memoria, faz `POST` para o endpoint de `delivery_quotes` e devolve `fee`, `currencyCode`, `expiresAt`, `dropoffEta` e `providerQuoteId`. No frontend, a cotacao so habilita depois de `uberReadiness.ready === true`.
- Seguranca aplicada: A integracao continua sem criar corrida. O fluxo so consulta quote, usa timeout configuravel, nao loga segredo, falha cedo quando falta configuracao e mantem o fallback manual da Uber.
- Riscos/regressoes: Sem `UBER_DIRECT_*` reais, o botao de cotacao fica bloqueado apos o readiness acusar pendencias. Mesmo com credenciais, ainda nao ha persistencia do `quote_id`, entao a resposta e apenas operacional/visual nesta rodada.

### 4) Validacao

- Comandos executados: `pnpm --filter @querobroapp/api typecheck`; `pnpm --filter @querobroapp/web typecheck`; `curl -X POST http://127.0.0.1:3001/deliveries/orders/4/uber-direct/quote`
- Testes que passaram: API e web passaram em typecheck. O endpoint novo respondeu `400` de forma controlada para o pedido `#4`, listando exatamente as configuracoes ausentes, o que confirma o bloqueio seguro antes de chamar a Uber sem credenciais.
- Testes nao executados (e motivo): Nao houve quote real contra a Uber porque o ambiente atual segue sem `UBER_DIRECT_CUSTOMER_ID`, `UBER_DIRECT_CLIENT_ID`, `UBER_DIRECT_CLIENT_SECRET` e dados completos de coleta.

### 5) Contexto para retomada

- Decisoes importantes: A rota de cotacao foi feita para o fluxo `delivery_quotes` porque ele encaixa no modelo atual com `customer_id` ja previsto no ambiente. O embed continua descartado no web.
- Suposicoes feitas: O produto oficial da Uber pode evoluir, entao a base URL, token URL, scope e timeout ficaram parametrizaveis por env (`UBER_DIRECT_API_BASE_URL`, `UBER_DIRECT_TOKEN_URL`, `UBER_DIRECT_SCOPE`, `UBER_DIRECT_REQUEST_TIMEOUT_MS`).
- Bloqueios: faltam credenciais oficiais da Uber e os dados reais de coleta da loja para validar o caminho positivo.
- Proximo passo recomendado (1 acao objetiva): Preencher `UBER_DIRECT_*` reais no ambiente da API e, em seguida, implementar criacao de entrega com persistencia segura do `quote_id`.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```

## Entrada 036

### 1) Metadados

- Data/hora: 2026-02-28 16:05 -03
- Canal origem: Codex Terminal
- Canal destino: ChatGPT Online/Mobile e Codex Terminal/Cloud
- Repo path: `/Users/gui/querobroapp`
- Branch: `main`
- Commit base (opcional): `8a4f1ec`

### 2) Objetivo da sessao encerrada

- Objetivo: Iniciar a Fase 1 da reconstrucao de `Pedidos`, trocando a pagina gigante por uma estrutura de feature sem quebrar o fluxo atual.
- Resultado entregue: A rota `/pedidos` agora virou uma casca fina em `apps/web/src/app/pedidos/page.tsx`, enquanto a implementacao foi movida para `apps/web/src/features/orders/orders-screen.tsx`. Tambem nasceram os primeiros modulos de feature: `orders-model.ts`, `orders-api.ts` e `order-filters.tsx`.
- O que ficou pendente: A tela ainda nao foi reescrita visualmente bloco a bloco; nesta rodada a mudanca foi estrutural. O comportamento principal continua o mesmo, mas a base agora permite separar `quick create`, lista, detalhe e pagamentos em rodadas menores.

### 3) Mudancas tecnicas

- Arquivos alterados nesta wave:
- ` M apps/web/src/app/pedidos/page.tsx`
- ` A apps/web/src/features/orders/orders-screen.tsx`
- ` A apps/web/src/features/orders/orders-model.ts`
- ` A apps/web/src/features/orders/orders-api.ts`
- ` A apps/web/src/features/orders/order-filters.tsx`
- ` M docs/PROJECT_SNAPSHOT.md`
- ` M docs/querobroapp-context.md`
- ` M docs/HANDOFF_LOG.md`
- Comportamento novo: Nao houve mudanca funcional relevante para o usuario final. A mudanca principal foi organizacional: `Pedidos` entrou em arquitetura de feature e o bloco de filtros da lista ja foi extraido para um componente proprio.
- Seguranca aplicada: Em vez de tentar um rewrite grande de uma vez, a tela foi migrada por encapsulamento. Isso reduz risco e permite reescrever o fluxo por partes mantendo o que ja funciona.
- Riscos/regressoes: A tela `orders-screen.tsx` ainda e muito grande. O ganho desta rodada e preparatorio; a reducao real de complexidade depende das proximas extracoes.

### 4) Validacao

- Comandos executados: `pnpm --filter @querobroapp/web typecheck`
- Testes que passaram: O `typecheck` do web passou apos mover a tela para `features/orders` e introduzir os modulos novos.
- Testes nao executados (e motivo): Nao houve smoke test visual no browser; a validacao desta rodada foi estrutural por compilacao.

### 5) Contexto para retomada

- Decisoes importantes: A estrategia escolhida foi mover primeiro o arquivo monolitico para uma feature e iniciar a separacao pelos pontos mais seguros (`model`, `api`, `filters`) antes de reescrever UX ou comportamento.
- Suposicoes feitas: O usuario quer a reconstrucao real de `Pedidos`, entao vale mais ganhar estrutura agora do que tentar refazer a tela inteira num salto arriscado.
- Bloqueios: Nenhum bloqueio tecnico imediato.
- Proximo passo recomendado (1 acao objetiva): Extrair o bloco `Novo pedido` para `order-quick-create.tsx` e deixar `orders-screen.tsx` concentrado em orquestracao e estado.

### 6) Prompt pronto para proximo canal

```txt
Continuar o projeto querobroapp com base neste handoff.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Objetivo da sessao:
[descreva em 1 linha]

No fim, registrar nova entrada no HANDOFF_LOG.
```
