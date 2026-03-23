# PROJECT_SNAPSHOT

Ultima atualizacao: 2026-03-23

## Estado atual

- Monorepo ativo com API, Web, Mobile e contratos compartilhados.
- Web consolidado em 3 telas operacionais reais: `Pedidos`, `Clientes` e `Estoque`, com captura publica em `/pedido`.
- A raiz publica do web agora esta preparada para dominio externo: `/` pode operar como landing fullscreen da marca, `/pedido` como captura publica e `/pedidos` como superficie operacional no mesmo app.
- `Pedidos` e a entrada principal; agenda `Dia/Semana/Mes` na mesma tela, com criacao de pedido no proprio painel e lista completa de pedidos logo abaixo do calendario.
- CTAs contextuais por tela: `Pedidos` usa acao `Criar` no painel, `Clientes/Produtos` usam acao inline/sticky e `Estoque` usa botao flutuante `Nova movimentacao`.
- `Calendario`, `Inicio`, `Jornada`, `Resumo` e `Builder` nao existem mais como superficies operacionais.
- Marca lateral usa o mark vetorial interno e o atalho/PWA publico agora usa os icones raster dedicados da marca, com abertura direta em `/pedido`.
- Numeracao exibida de `Clientes` e `Pedidos` agora usa `publicNumber` sequencial, preenchido por ordem cronologica e desacoplado do `id` interno do banco.
- API cobre pedido, pagamento, estoque, BOM, D+1, producao e frete local calculado no backend.
- O processo de qualidade atual inclui `qa:trust`, `qa:browser-smoke`, `qa:critical-e2e`, drift check e testes raiz.
- O workspace agora roda com `pnpm audit` zerado, `Next 15.5.14`, `multer 2.1.1` e stack mobile alinhada em `Expo 55`/`React Native 0.83.2`, sem warnings bloqueantes de peer/deprecated no `pnpm install`.
- O lint do monorepo migrou para `ESLint 9` em flat config e passou a ignorar artefatos temporarios de QA (`.next-qa-*` e `.playwright-cli`), evitando falso negativo apos smoke/E2E.
- Gate operacional de religamento foi validado em 2026-03-11 com `stop-all -> dev-all`, health da API e execucao de smoke + E2E critico.
- `Produtos` deixou de existir como superficie operacional; catalogo e ficha tecnica ficam dentro de `Estoque`.
- Existe agora uma captura publica de pedido em `/pedido`, usando o mesmo intake externo que atende `Google Forms` e a pagina propria.
- O intake externo agora expoe preview seguro para `Google Forms` e `customer-form`, validando payload, frete e total sem criar pedido nem PIX.
- Os dados oficiais da QUEROBROA (telefone, CNPJ, PIX e conta bancaria) agora estao canonizados em contratos compartilhados, painel interno e fluxo publico.
- O backend agora aceita conciliacao segura de PIX por nome + valor em `POST /payments/pix-reconciliations/webhook`, mantendo a baixa canonica por `txid/paymentId` em `pix-settlements`.
- Pedidos de `Entrega` agora podem receber cotacao de frete antes do submit final, com o valor incorporado ao total e ao PIX.
- `/pedido`, `quick create` e a logica de caixas em `Pedidos` passaram a compartilhar o mesmo catalogo de caixas/sabores e as mesmas imagens originais da marca.
- A automacao local `scripts/nubank-pix-bridge.mjs` agora consegue ler PIX de entrada visiveis no Nubank PJ pela aba autenticada do Chrome e delegar o matching seguro ao backend.
- O repo tambem inclui instalador de `launchd` para esse bridge (`bank:pix:bridge:install`), permitindo deixar a conciliacao rodando em segundo plano no Mac operacional.
- Em `/pedido`, quando `Retirada` e selecionada, o ponto de retirada agora e preenchido automaticamente como `Alameda Jau, 731` e fica bloqueado para edicao pelo cliente.
- `/pedido` agora salva localmente os dados do cliente neste aparelho, oferece `Refazer ultimo pedido` e trocou o subtotal/CTA flutuante de mobile por um bloco inline no fluxo, evitando sobreposicao no scroll.
- A home publica `/` nao exibe mais CTA de instalacao/atalho mobile; o fluxo publico foi simplificado para manter a home sem instrucoes extras nem affordance inconsistente entre plataformas.
- A home publica `/` agora trava o viewport visivel real do navegador e bloqueia overflow de `html/body` enquanto a rota esta montada, mantendo `scrollWidth == innerWidth` e `scrollHeight == innerHeight` em desktop e mobile.
- A home publica `/` agora fixa tambem o `body` em `position: fixed` enquanto esta montada, para bloquear bounce/rolagem residual em iPhone e navegadores com barras dinamicas.
- Em `/pedido`, o header sticky compacto e o hero superior com `@QUEROBROA` + galeria foram removidos no desktop; a experiencia passa a abrir direto no formulario/resumo nessa largura.
- Em `/pedido`, os dois blocos introdutorios do topo foram removidos por completo; a pagina agora abre direto em `Dados`, e os rótulos pequenos redundantes das seções tambem sairam.
- O frete do cliente agora segue tabela operacional fixa por raio a partir da Alameda Jau, 731: `R$ 12` ate `5 km` e `R$ 18` acima disso; a cotacao e o calculo acontecem 100% no backend.
- A cotacao agora protege o caso `origem = destino` e usa hash de quote mais fiel ao payload real.
- `/pedido` e o modal de novo pedido em `/pedidos` agora usam o mesmo fluxo em duas etapas para entrega: `Calcular frete` antes de `Finalizar pedido/Criar pedido`.
- `/pedido` passou a preservar o cadastro ao usar `Fazer outro pedido`, limpando apenas a composicao do pedido e rolando de volta ao topo para uma nova montagem.
- A cotacao publica de `/pedido` agora usa a assinatura canonica dos sabores para casar com o intake final e evitar refresh indevido do frete na primeira finalizacao.
- As caixas mistas passaram a usar composicao visual unica no mesmo quadrante, padronizada entre a captura publica e a operacao interna.
- As caixas mistas agora usam corte seco entre as duas imagens, sem a faixa branca intermediaria.
- O desktop de `/pedido` agora usa grids mais elasticas em vez de tracks fixas, evitando colapso de endereco, caixas e `Caixa Sabores` em navegacoes diferentes, inclusive browsers mais sensiveis a `minmax` rigido.
- `/pedido` agora deixa explicito antes do submit que pedido novo nao entra para hoje, mostrando o primeiro horario disponivel na propria area de agendamento e no resumo lateral.
- A `Caixa Sabores` de `/pedido` agora mostra uma composicao com as 5 artes oficiais dos sabores no mesmo envelope visual da imagem anterior.
- A composicao de `Caixa Sabores` agora foi centralizada em arte compartilhada de 5 colunas, evitando que `/pedido` e outros pontos do web recaiam no JPG legado `sabores-caixa.jpg` por fallback generico.
- O autocomplete de endereco em `/pedido` e `/clientes` saiu do widget legado `google.maps.places.Autocomplete` e passou para a API nova programatica do Google Places, preservando os inputs atuais e eliminando o warning de deprecacao no console.
- A linha de quantidade dos cards de caixas em `/pedido` saiu do grid aninhado fragil e passou a usar miolo flexivel com container query por card, evitando que o selo `0 caixas` seja esmagado entre input e botao `+` em Safari/desktop.
- O bloco `Entrega ou retirada` de `/pedido` agora responde ao tamanho real do painel via container query, sem voltar a colapsar `Endereco/Data/Horario` em Chrome/desktop ou em larguras intermediarias.
- O popup de detalhe de pedido em `/pedidos` agora usa os proprios icones de etapa como botoes diretos de status, sem setas laterais; ao selecionar uma etapa, o backend percorre o caminho intermediario automaticamente para preservar os mesmos recalculos e gatilhos operacionais.
- O popup de detalhe de pedido em `/pedidos` removeu o bloco completo de PIX e reorganizou o resumo logo abaixo de `Caixas`, exibindo `Produtos`, `Frete` e `Total` na ordem operacional.
- O backend de estoque agora bloqueia edicao de itens e exclusao de pedido depois que o pedido ja gerou movimentacoes fisicas (`MASS_PREP`, `PRODUCTION_BATCH` ou equivalentes), evitando dessintonia entre composicao do pedido e baixa real.
- O calculo de `D+1`/`production/requirements` agora desconta o que ja foi produzido na runtime de fornadas para o mesmo pedido, em vez de continuar projetando demanda cheia apos a baixa real do batch.
- O ajuste manual de saldo em `Estoque` e no popup de `FAZER MASSA` agora ancora o saldo contado com `ADJUST` absoluto por familia, em vez de simular delta relativo sobre historico antigo.
- O preparo manual de `MASSA PRONTA` agora usa idempotencia por `requestKey` no backend e trava de duplo disparo no frontend, evitando duplicar a primeira baixa de insumos por tap/click repetido.
- O shell operacional mobile agora bloqueia `touch callout`/menu de contexto irrelevante nas superficies interativas do app, reduzindo conflito entre long-press nativo do iPhone e gestos como arrastar pedidos no calendario, sem desabilitar selecao em campos de texto.
- `/pedido` e `/pedidos` agora redirecionam o pos-criacao para `/pedidofinalizado`, com card final isolado, retorno contextual (`Fazer novo pedido` ou `Voltar para pedidos`) e preservacao apenas dos dados cadastrais do cliente no caso publico.
- `/pedidofinalizado` agora roda sem shell operacional, sem menu lateral e sem topbar, isolado como rota publica de conclusao.
- `/dashboard` voltou a existir como rota oculta interna, agora com painel real de analytics first-party do site, vitals e performance financeira/operacional da broa.
- O web passou a instrumentar navegacao, links, funil e web vitals por coleta propria, gravando esses eventos na API para leitura imediata no dashboard.
- `/dashboard` deixou de depender so de obscuridade: agora abre apenas em host operacional/loopback, usa bridge protegido no web e a API exige token de bridge.
- `/dashboard` ganhou uma narrativa editorial mais didatica, reorganizando trafego, funil, performance, financeiro, mix e recebiveis em linguagem mais humana sem alterar a base de dados lida pelo painel.
- Analytics first-party deixou de gravar URLs completas com query/hash e passou a aceitar ingest apenas por bridge same-origin autenticado.
- `Repetir pedido` em `/clientes` e `Novo pedido` em `/pedidos` agora preservam `PICKUP` em vez de forcar `DELIVERY`.
- O modal `Novo pedido` em `/pedidos` foi reequilibrado para mobile, com shell propria e controles compactos mais estaveis no grid de quantidade.
- `/pedidos` agora expoe `Novo pedido` inline no topo em mobile e esconde o FAB flutuante abaixo de `xl`.
- A alocacao de `publicNumber` na API deixou de depender de colisao proposital no contador; o intake externo voltou a criar pedidos sem abortar a transacao do Postgres.
- A criacao de pedido agora dispara alerta operacional assincrono no backend, com `ntfy` como canal gratuito principal para iPhone/PWA e webhook como canal opcional.
- A navegacao operacional foi normalizada: o item principal antes chamado `Agenda` agora se chama `PEDIDOS`, e o menu passou a usar labels em caixa alta de forma consistente.
- `Clientes` nao coleta mais nem exibe email em nenhuma superficie ativa; nas paginas internas a ficha pode ficar incompleta enquanto o atendimento evolui, e o `/pedido` publico manteve as travas de cadastro sem esse campo.

## O que um usuario consegue fazer hoje

1. Abrir o app direto em `Pedidos`.
2. Navegar entre `Pedidos`, `Clientes` e `Estoque`.
3. Criar pedido manualmente no web.
4. Confirmar pedido e colocar ele na fila de producao.
5. Iniciar a proxima fornada com baixa real de estoque no momento em que a fornada comeca.
6. Concluir a fornada e deixar o pedido `PRONTO`.
7. Validar se a entrega local esta pronta para iniciar.
8. Iniciar entrega local interna.
9. Marcar entrega concluida e deixar o pedido em `ENTREGUE`.
10. Registrar pagamento parcial ou total.
11. Simular frete de entrega antes de fechar o pedido publico.

## Telas web

- `/pedido`: pagina publica do cliente com submit para o intake canonico, cotacao previa de frete, exibicao do PIX copia e cola e CTA mobile sem barra flutuante sobre o conteudo.
- `/pedido`: CTA principal abaixo do bloco `Resumo`; em `Entrega` ele calcula o frete antes da finalizacao, e em `Retirada` o frete zera.
- `/pedido`: desktop sem colapso nos blocos de agendamento e sabores; a copy de agendamento agora avisa claramente que pedido novo nao entra para hoje.
- `/pedido`: `Caixa Sabores` e fallbacks genericos do catalogo agora usam a mesma composicao oficial em 5 colunas, sem regressao para a arte antiga.
- `/pedido`: autocomplete de endereco segue no input atual, com sugestoes novas do Google Places e sem warning legado no console.
- `/pedido`: o menu de sugestoes do endereco agora usa visual simples de caixa de selecao, sem blur/glass effect, para melhorar legibilidade no fluxo publico.
- `/pedido`: cards de caixas no desktop mantem input e selo de quantidade legiveis lado a lado, sem o bloco `caixas` comprimir ou quebrar em colunas estreitas.
- `/pedido`: o grid de `Endereco/Data/Horario` agora abre 1, 2 ou 3 colunas conforme a largura real do card, em vez de depender de breakpoint de viewport que podia divergir entre browsers.
- `/pedido` e `/pedidos`: caixas mistas agora usam as fotos finais exportadas da marca, em vez da montagem antiga com meia-broa.
- `/`: landing publica fullscreen da marca, preparada para `www.querobroa.com.br`.
- `/`: landing publica fullscreen da marca com CTA de atalho mobile para instalar/acessar `Pedido rapido`.
- `/pedidos`: agenda do dia, criacao de pedido, status, producao, entrega e pagamento.
- `/pedidos`: popup de detalhe agora permite clicar diretamente na etapa desejada do workflow por icone, mantendo anteriores como concluidas e posteriores como pendentes sem quebrar a sequencia canonica do backend.
- `/pedidos`: modal `Novo pedido` alinhado visualmente com `/pedido`, sem miniatura redundante e com CTA de frete abaixo do resumo.
- `/pedidos`: modal `Novo pedido` agora se comporta melhor em mobile, sem deformar popup ou quebrar o bloco de quantidade.
- `/pedidos`: mobile sem CTA flutuante no canto; a acao principal fica inline no proprio painel da agenda.
- `/pedidos`: no mobile, long-press em cards e controles operacionais nao aciona mais menu/contexto nativo que atrapalhava o drag no calendario; inputs seguem com comportamento normal de selecao/edicao.
- `/pedidos`: o drag de eventos no calendario agora tambem bloqueia selecao de texto nos proprios cards e labels durante o gesto, evitando highlight azul acompanhar o arraste no mobile.
- `/pedidos`: o drag de eventos no calendario mobile agora so arma apos `click and hold`; se o gesto virar scroll antes do hold, o arraste e cancelado. Quando o hold completa, o app bloqueia a rolagem ate soltar, evitando conflito entre scroll vertical e remarcacao de horario.
- `/pedidos`: durante esse drag armado no mobile, o app tambem cancela `touchmove` de forma nativa e nao-passiva, para impedir que o mesmo gesto continue sendo interpretado pelo Safari/iPhone como scroll da pagina.
- `/pedidos` e a conclusao publica agora traduzem pagamento quitado como `PIX recebido`, sem alterar o status interno `PAGO` no backend.
- `/clientes`: cadastro e edicao rapida.
- `/clientes`: autocomplete de endereco agora usa a API nova do Google Places e continua promovendo rua, bairro, cidade e UF ao selecionar a sugestao.
- `/clientes`: repetir pedido respeita o modo original de atendimento.
- `/estoque`: saldo, D+1, compras e leitura operacional.
- `/produtos`: redirect legado para `/estoque`.
- `/calendario`: redirect permanente para `/pedidos`.
- `/dashboard`: pagina oculta interna com trafego, navegacao, vitals, funil e financeiro completo, agora em linguagem editorial mais guiada.
- `/dashboard`: agora acessivel pelo proprio app em host publico, com link direto no menu e leitura via bridge same-origin do web.
- `/dashboard`: deixou de ter seletor de periodo; o painel agora consolida trafego, financeiro, COGS e detalhamentos sobre a base inteira ativa.
- Rotas antigas (`/`, `/hoje`, `/jornada`, `/inicio`, `/resumo`, `/base`, `/producao`, `/saidas`, `/caixa`) convergem para `Pedidos`.
- `/builder`: redirect para `/pedidos`; o runtime interno segue exposto por `GET /runtime-config`.

## API (blocos)

- Cadastro: `customers`, `inventory-products`
- Operacao: `orders`, `payments`, `deliveries`, `production`
- Estoque: `inventory`, `inventory-products`, `bom`
- Intake externo: `orders/intake`, `orders/intake/customer-form`, `orders/intake/google-form`
- Cotacao de frete: `deliveries/quotes` + proxy interno do web em `/api/delivery-quote`
- Proxy de `Google Forms`: web exposto em `/api/google-form` para receber o Apps Script sem abrir a API inteira publicamente
- Preview do intake externo: `/api/google-form/preview`, `/api/customer-form/preview`, `orders/intake/google-form/preview` e `orders/intake/customer-form/preview`
- Analytics first-party: `analytics/events` na API + proxy interno do web em `/api/analytics/track`
- Dashboard: `dashboard/summary` para trafego, vitals, financeiro, mix de produtos e recebiveis
- Suporte interno: `runtime-config` (read-only) e redirects legados controlados no web

## Qualidade tecnica

- `pnpm qa:trust`: gate unico de docs, diff, typecheck, testes e build.
- `pnpm qa:browser-smoke`: smoke de navegador real nas 4 telas principais.
- `pnpm qa:critical-e2e`: jornada critica de produto -> cliente -> pedido -> status.
- `pnpm check:prisma-drift`: guard de drift dev/prod.
- `pnpm validate:public-deploy`: valida dominio publico, redirect de `ops`, health da API, preview do Google Forms e quote de frete sem criar pedido.
- `pnpm validate:delivery-quote`: valida cotacao real em producao sem criar entrega.
- Os flows de QA que sobem um web temporario agora usam dist dirs dedicados do Next, para nao disputar o `.next` do `next dev`.
- O workflow principal de CI no GitHub agora roda `check:prisma-drift` e `qa:trust` com lint habilitado.
- O browser smoke garante o redirect legado de `/produtos` e cobre as telas operacionais principais.
- O app agora produz analytics first-party sem GA4 previa, usando o proprio banco para sessao, page view, link click e web vitals.
- O PWA/atalho mobile agora usa icones raster dedicados da marca (`apple-touch-icon` + `manifest` 192/512).
- O web agora sincroniza `visualViewport` globalmente no layout e usa essa metrica real em modais, toasts, backdrops, FABs e barras sticky, reduzindo overflow causado por barras dinamicas do navegador fora da home.
- Os previews sociais das rotas publicas (`/` e `/pedido`) agora usam a descricao curta `Sua vida + broa :) 🙂`, evitando copy tecnica no compartilhamento.
- A home desktop agora usa 3 colunas simultaneas no fundo, com rotacao distribuida sem repeticao entre as imagens visiveis, em vez de estourar uma unica foto widescreen.
- A transicao da home desktop agora acontece em timings diferentes por coluna, com crossfade proprio em cada painel, evitando apagao/preto simultaneo na troca.
- A navegacao desktop ganhou botoes maiores na sidebar, e o fade escuro da home foi reduzido em mobile e desktop para deixar as fotos entrarem com mais brilho no primeiro impacto.
- A home publica passou a usar a mesma cadencia de `2s` em qualquer viewport para a troca automatica de imagens, evitando regressao para `6s` em mobile por bifurcacao de viewport.

## Validacao operacional mais recente

- Data: 2026-03-23
- Ciclo executado: `pnpm install`, `pnpm audit --json`, `pnpm lint`, `pnpm --filter @querobroapp/shared build`, `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`, `pnpm --filter @querobroapp/mobile typecheck`, `pnpm --filter @querobroapp/mobile build`, `node --test tests/order-created-alerts.test.mjs tests/order-intake-preview.test.mjs tests/customer-dedupe-and-intake.test.mjs`, `pnpm qa:browser-smoke`, `pnpm qa:critical-e2e`
- Resultado: cadeia de dependencias e toolchain ficaram limpas (`audit=0`, sem warning bloqueante de install), o web/API/mobile seguiram buildando, e os dois gates de navegador passaram apos endurecer o QA critico contra copy acentuada em `/estoque`.
- Data: 2026-03-22
- Ciclo executado: `pnpm --filter @querobroapp/shared build`, `pnpm --filter @querobroapp/api exec prisma generate`, `pnpm --filter @querobroapp/api exec prisma generate --schema prisma/schema.prod.prisma`, `pnpm --filter @querobroapp/api typecheck`, `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`, `rg -n "email|activeEmailKey" apps/api/src apps/web/src packages/shared/src tests -g'*.ts' -g'*.tsx' -g'*.mjs'`
- Resultado: cliente deixou de ter `email` no contrato e no banco ativo; `/clientes` passou a aceitar cadastro interno incompleto exigindo apenas nome, enquanto o fluxo publico preservou as validacoes de preenchimento sem esse campo.
- Data: 2026-03-21
- Ciclo executado: `node --test --test-concurrency=1 tests/delivery-provider-hybrid-fallback.test.mjs tests/delivery-pickup-origin.test.mjs tests/order-schedule-capacity.test.mjs tests/external-order-schedule-guard.test.mjs`, `pnpm --filter @querobroapp/shared build`, `pnpm --filter @querobroapp/api typecheck`, `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web build`, `pnpm qa:browser-smoke`, `pnpm qa:critical-e2e`, `pnpm validate:public-deploy`, `pnpm validate:delivery-quote`
- Resultado: frete fixo por raio entrou em producao sem rastros ativos de Uber/Loggi, `/pedidos` manteve liberdade de edicao interna e o dominio publico respondeu `200` em `/`, `/pedido` e `/pedidos`, com quote publico validado em `R$ 12` e cenario manual acima de `5 km` retornando `R$ 18`.
- Data: 2026-03-20
- Ciclo executado: `pnpm --filter @querobroapp/api typecheck`, `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/api lint`, `pnpm --filter @querobroapp/web lint`, `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web build`, `node --test --test-concurrency=1 tests/inventory-overview-effective-balance.test.mjs tests/mass-prep-batch-priority.test.mjs`
- Resultado: estoque manual passou a usar `ADJUST` absoluto, o popup de `FAZER MASSA` ficou blindado contra duplo disparo, e foi aplicada no ledger local a correcao calculada para neutralizar a duplicidade historica da conversao manual de 13/03/2026 19:42:27.
- Data: 2026-03-20
- Ciclo executado: `pnpm --filter @querobroapp/web lint`, `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`
- Data: 2026-03-20
- Ciclo executado: `pnpm --filter @querobroapp/api typecheck`, `pnpm --filter @querobroapp/api lint`, `pnpm --filter @querobroapp/api build`, `node --test tests/production-quantity-semantics.test.mjs tests/order-mass-prep-automation.test.mjs tests/order-packaging-grouping.test.mjs tests/production-broa-operational-rules.test.mjs tests/customer-order-delete-status.test.mjs`
- Resultado: pedidos deixam de aceitar mutacao/exclusao apos baixa fisica de estoque, e o `D+1` passa a refletir corretamente o saldo ja produzido quando uma fornada foi iniciada.
- Data: 2026-03-19
- Ciclo executado: `pnpm --filter @querobroapp/shared build`, `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web lint`, `pnpm --filter @querobroapp/web build`, `pnpm --filter @querobroapp/web typecheck`, `node --test tests/delivery-pickup-origin.test.mjs tests/pix-settlement-webhook.test.mjs tests/pix-static-config-priority.test.mjs`, `git diff --check`
- Validacao adicional: browser real em `next start` para `/pedidofinalizado`, confirmando remocao do bloco textual de dados oficiais, exibicao isolada do `PIX copia e cola` e retorno contextual para `/pedido`.
- Validacao adicional: `pnpm --filter @querobroapp/api typecheck`, `pnpm --filter @querobroapp/api lint`, `pnpm --filter @querobroapp/web lint`, `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web build` e `node --test tests/pix-reconciliation-webhook.test.mjs tests/pix-settlement-webhook.test.mjs`.
- Resultado: o BR Code passou a priorizar o perfil oficial da QUEROBROA mesmo com `PIX_*` legado no runtime, o pos-pedido do fluxo publico e do dashboard passou a sair para uma rota final dedicada, e o card final deixou de ficar inline em `/pedido` ou como modal residual em `/pedidos`.

## Gaps abertos

1. `Google Forms` ja e viavel como canal temporario, mas ainda falta configuracao real do Apps Script e URL publica final.
2. O dominio publico ja esta publicado e validado em `querobroa.com.br`, `www`, `ops` e `api`; o gap agora e operacionalizar o canal externo real (`Google Forms`) sobre os endpoints de preview/intake ja expostos.
3. O foco do canal externo segue em `Google Forms` e pagina publica, sem mensageria de terceiros acoplada ao intake.
4. Ainda vale validar o frete fixo por raio em producao com cenarios reais de endereco, para confirmar consistencia do calculo e da exibicao publica.
5. Mobile segue atras do web no fluxo operacional novo.
6. Ainda vale ampliar cobertura de testes alem dos gates atuais, principalmente em cenarios de edge case de dominio.
7. O dashboard interno de analytics parte do zero sem historico legado; ele comeca a refletir navegacao nova a partir desta instrumentacao first-party.
8. O dashboard ainda faz leituras pesadas e pode pedir agregacao/caching dedicado antes do go-live pleno.
9. O alerta imediato de novo pedido agora suporta `ntfy`, mas o iPhone ainda precisa assinar o topico configurado para comecar a receber os pushes.

## Como religar e validar rapido

1. `./scripts/stop-all.sh`
2. `./scripts/dev-all.sh`
3. Abrir `http://127.0.0.1:3000/pedidos`
4. Validar `http://127.0.0.1:3001/health`
5. Rodar `pnpm qa:browser-smoke`
6. Rodar `pnpm qa:critical-e2e`

## Arquivos chave

- API entrypoint: `apps/api/src/main.ts`
- API modules: `apps/api/src/modules`
- Schema: `apps/api/prisma/schema.prisma`
- Web pages: `apps/web/src/app`
- Shared schemas: `packages/shared/src/index.ts`
