# PROJECT_SNAPSHOT

Ultima atualizacao: 2026-04-26

## Estado atual

- 2026-04-26: as `AMIGAS DA BROA` publicadas voltaram a exibir descricao propria na gaveta do `/pedido` mesmo quando `drawerNote` vem nulo do catalogo. O fallback canonico agora cobre textos por item no `shared`, na API e no runtime do web, eliminando a copia generica `Toque fora da gaveta ou no botão fechar para voltar ao catálogo.`. Deploys publicados e validados: API `f888f261-2f9a-4f85-b18b-fdee1c4b2be5` e web `0d74d3e8-f5f5-41f5-b2a1-84bdf670be0d`, com `pnpm validate:public-deploy` verde e `6` itens de `Amigas da Broa` respondendo `drawerNote` preenchido em `https://querobroa.com.br/api/order-catalog`.

- 2026-04-25: os cards de pagamento do `/pedido` publicado foram enxugados de novo. O card `PIX` passou a mostrar apenas `PIX`, enquanto o card `CARTÃO` manteve apenas a frase `as taxas do cartão são repassadas ao final do pedido`, removendo os rótulos intermediários `Copia e cola` e `DÉBITO ou CRÉDITO`. Deploy web publicado no Railway: `3c406b00-b472-470e-9e94-0bf13942c164`, com validação pública verde (`/` 200, `/pedido` 200, `/pedidos` protegido, `apiHealth=ok`, preview `PIX_PENDING` e quote `LOCAL / MANUAL_FALLBACK`).

- 2026-04-25: o `/pedido` publicado voltou a servir as artes corretas de `AMIGAS DA BROA` a partir de assets canonicos versionados no proprio repositorio (`apps/web/public/querobroa-brand/amigas-da-broa/*`). A causa real da quebra era dependencia de `imageUrl` mutavel/nulo vindo do catalogo; agora a API aplica fallback canonico para `Amigas da Broa` quando `imageUrl` estiver vazio e o web tambem preserva esse fallback no runtime. No mesmo ciclo, os cards de pagamento foram simplificados para `PIX / Copia e cola` e `CARTÃO / DÉBITO ou CRÉDITO / as taxas do cartão são repassadas ao final do pedido`, sem o texto antigo de `Checkout SumUp`. Deploys publicados e validados: API `2e2cbb8c-2801-4f31-bc02-57b8b3f611a6` e web `9a3e6a70-7a19-4e42-953d-c03b03c45606`.

- 2026-04-24: o `/pedido` publicado passou a oferecer `PIX` e `Cartão` com checkout hospedado da SumUp. O fluxo cria o pedido no app, preserva idempotencia no intake externo, grava `paymentMethod`, gera checkout hospedado para cartão, expõe sync/webhook públicos e redireciona o cliente para a SumUp a partir da tela final do pedido. As variáveis `SUMUP_API_KEY` e `SUMUP_MERCHANT_CODE` foram gravadas em `querobroAPI` e `querobroAPP` no Railway, com `merchant_code = M16V7P5B` validado pela API oficial da SumUp.

- 2026-04-24: a correção mobile de `/confirmacoes` ficou formalizada no código local. `queue-screen.tsx` deixou de depender da tabela desktop no celular e passou a renderizar cards móveis com endereço quebrando corretamente (`break-words` + `leading-6`), reduzindo o truncamento visual em scroll rápido no Safari/iPhone.

- 2026-04-22: o feed `meta-catalog.csv` e os assets públicos do sabor `Romeu e Julieta` foram recompostos para manter o catálogo do WhatsApp alinhado ao web. `romeu-e-julieta.jpg` foi reexportado na resolução publicada, `sabores-caixa.jpg` foi regenerado com a coluna atual do `RJ`, a `Caixa Mista de Romeu e Julieta` ganhou a arte quadrada `mista-romeu-e-julieta-meta-square-v2.jpg` no mesmo padrão diagonal full bleed das demais mistas, sem moldura clara, e o web voltou a usar também a composição vertical `mista-romeu-e-julieta.jpg` nos pontos internos do catálogo.

- 2026-04-16: o `/pedido` publicado incorporou o pacote `AMIGAS DA BROA` no trilho principal, com cards/gavetas proprios, estoque direto por produto, auto-inativacao quando o saldo zera, reativacao automatica apos reposicao e cupom incidindo apenas sobre o total das Broas. A operacao em `/pedidos` tambem passou a permitir incluir `AMIGAS` no quick create sem misturar esse grupo nas contagens de caixas/broas.

- 2026-04-16: o fluxo de frete ficou consistente entre preview e submit em `/pedido` e `/pedidos`, incluindo endereco alternativo, cupom e itens de `AMIGAS DA BROA`, eliminando o erro `Frete atualizado. Revise o valor antes de enviar novamente.` no fechamento de pedidos.

- 2026-04-16: o feed publico `https://querobroa.com.br/meta-catalog.csv` passou a refletir o catalogo publicado da web, com `18` linhas (`12` itens de Broas e `6` itens de `AMIGAS DA BROA`), incluindo `Caixa Mista de Romeu e Julieta` e labels de agrupamento (`custom_label_0` / `custom_label_1`) para facilitar um conjunto separado de `AMIGAS` no Commerce Manager / WhatsApp.

- 2026-03-31: a conciliacao financeira deixou de depender da bridge local do Nubank. O dashboard agora aceita importacao manual do extrato semanal do Nu Empresas em `.eml`, `.csv` ou `.ofx`, persiste as movimentacoes no backend, reconcilia automaticamente os PIX de entrada com pedidos pendentes e recalcula caixa real, custos operacionais e fluxo liquido assim que o operador clica em `ATUALIZAR EXTRATO`.

- 2026-03-31: `/dashboard` foi refeito de novo para reduzir poluicao visual e aumentar capacidade analitica real. O comparador temporal agora usa granularidade automatica (`diaria` abaixo de `120` dias e `mensal` acima disso), o historico passou a consolidar receita/recebimento/COGS sobre a mesma base temporal por `createdAt`, e a leitura executiva foi reorganizada em `Cockpit do board`, `Tendencia e decisao`, atribuicao por `origem/referrer`, `Meta mensal e ritmo`, `Economia unitária e caixa`, `Drivers de custo e mix` e `Saúde digital`. O web tambem passou a expor o plano de meta mensal com run rate dos ultimos `30` dias, e a API agora entrega atribuicao de canal com `share`, `chegou /pedido`, `envio` e indice relativo por origem.

- 2026-03-31: `/dashboard` foi promovido para um cockpit executivo real. A API normalizou os KPIs `all time` mesmo nos recortes de `24h/7d/30d`, separou o funil em `Home -> /pedido`, `Pedido -> envio` e `Quote -> envio`, e passou a carregar a serie diaria com sessoes de home, pedido, quote e envio. No web, a antiga leitura mensal fraca foi substituida por `Cockpit do board`, comparador mensal de ate `2 KPIs`, tabela historica consolidada e bloco de `Fontes e integrações` para deixar clara a origem operacional de cada numero.

- 2026-03-31: a operacao interna deixou de ser publica por URL direta. O web agora exige autenticacao persistente por cookie HTTP-only assinado para `/pedidos`, `/clientes`, `/estoque`, `/dashboard` e para o bridge `/api/internal/*`, com tela publica `/acesso` e sessao estavel ate logout/limpeza de cookies. No analytics, `/pedidos` deixou de cair como `public` por colisao com o prefixo `/pedido`.

- 2026-03-30: a imagem canônica da home para favoritos, `apple-touch-icon`, `manifest`, favicon e preview social passou a ser a foto das broas empilhadas sobre fundo verde-claro. Os PNGs de ícone foram regenerados a partir de `stack.jpg` com crop quadrado centralizado e levemente deslocado para cima, sem padding lateral, e a home/`/pedido` ganharam um preview largo dedicado (`stack-wide.jpg`) para substituir a thumb antiga que ainda aparecia em favoritos do Safari e compartilhamento.

- 2026-03-30: `/pedidos` deixou de recarregar a workspace inteira ao apenas selecionar um pedido. O detalhe agora abre sem disparar novo `fetchOrdersWorkspace()` por troca de `selectedOrder`, removendo o micro-loop visual que acontecia ao clicar em cards. Na mesma varredura, `Clientes`, `Estoque` e `Dashboard` nao mostraram o mesmo anti-padrao de loader recriado por item selecionado.

- 2026-03-30: `/pedidos` deixou de usar popup central fragil em mobile e passou a abrir `Novo pedido` e `Detalhe do pedido` como drawer lateral sobreposto, com scroll interno no painel, altura travada ao viewport real e fechamento mais estavel em navegacao touch. No mesmo ciclo, o app passou a desabilitar pinch zoom globalmente (`maximumScale: 1`, `userScalable: false`) e a restringir o gesto principal a rolagem vertical.

- 2026-03-30: o calendario de `/pedidos` agora entra em modo compacto quando varios pedidos compartilham a mesma faixa e o card fica comprimido, exibindo apenas o nome do cliente em mobile em vez de sumir com o texto. O fluxo interno tambem passou a exibir explicitamente as 3 faixas publicas de `/pedido` (`9h - 12h`, `12h - 16h`, `16h - 20h`) no quick create, na edicao e nos metadados do pedido, para conferência operacional sem reimpor a trava publica sobre a agenda interna.

- 2026-03-30: `/pedido` deixou de resetar a data escolhida pelo cliente para a proxima faixa disponivel. A sincronizacao da agenda publica agora consulta sempre a selecao atual do formulario e ignora respostas stale fora de ordem, preservando `date/timeWindow` enquanto o usuario navega no calendario.

- 2026-03-28: `/pedidos` removeu o helper textual do campo de desconto (`Campo livre de 0% a 100%` e o preview em reais) tanto na criacao quanto na edicao de pedidos. O input continua livre de `0` a `100`, mas a interface ficou mais limpa.

- 2026-03-27: `/pedido` deixou de expor codigos de sabores ao cliente (`(T)`, `(G)` etc.). A caixa customizada foi renomeada de `Caixa Sabores` para `Monte Sua Caixa`, com subtitulo `Monte sua caixa com 7 broas como quiser!`, preco visivel no proprio bloco, resumo lateral e alertas/erros alinhados, sem mexer em `content IDs`, `legacyCode` ou nos calculos de subtotal/frete. O texto auxiliar do cupom sobre impacto no frete tambem foi removido.

- 2026-03-27: `/pedidos` deixou de renderizar qualquer card intermediario entre o calendario e a secao `PEDIDOS`; o bloco de overflow do dia foi removido e o fluxo visual agora segue direto para `Resumo do dia` e lista. No mesmo ciclo, a paleta oficial do web foi levemente iluminada, com tons e gradientes mais brilhantes em `globals.css`, ícones, dashboard, `/pedido`, `/pedido/feito` e cards de caixas, preservando a mesma família cromática e hierarquia.

- 2026-03-27: a identidade visual do web foi reancorada na paleta oficial da QUEROBROA para superficies internas e publicas. `globals.css` passou a centralizar tokens em creme, blush, sálvia, dourado, oliva e tostado; dashboard, pedidos, clientes, `/pedido`, `/pedido/feito`, cards de caixas e ícones foram harmonizados para operar na mesma família cromática, preservando contraste, hierarquia e gradientes suaves.

- 2026-03-27: `/pedidos` removeu o card solto acima do calendario e levou o `Novo pedido` para o toolbar em mobile. O `Resumo do dia` agora reordena clientes com pedidos pendentes no topo e muda o tom do card conforme o progresso (`a fazer`, `parcial`, `pronto`).

- 2026-03-27: pedidos internos com `100%` de desconto passaram a zerar tambem o frete no valor a receber. O frete continua sendo cotado para operacao, mas entra como `Investimento de marketing: AMOSTRAS` no backend/KPI, sem gerar cobranca residual para o cliente.

- 2026-03-27: `/pedidos` passou a editar os dados completos do cliente diretamente no pedido em qualquer status, usando um snapshot proprio do pedido (`nome`, `telefone`, `endereco`, `complemento`, `bairro`, `cidade`, `UF`, `CEP`, observacoes de entrega) sem depender do cadastro principal. O backend ganhou snapshot persistido no `Order`, tabela `CustomerAddress` para multiplos enderecos por cliente, endpoint `POST /customers/:id/addresses` e seletor de enderecos salvos no novo pedido interno sem perder o vinculo com o `customerId`.

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
- O backend agora usa importacao de extrato como fonte canonica de caixa real do dashboard, conciliando PIX de entrada por nome + valor no momento da importacao do arquivo.
- Pedidos de `Entrega` agora podem receber cotacao de frete antes do submit final, com o valor incorporado ao total e ao PIX.
- `/pedido`, `quick create` e a logica de caixas em `Pedidos` passaram a compartilhar o mesmo catalogo de caixas/sabores e as mesmas imagens originais da marca.
- O fluxo bancario oficial passou a ser o upload do email de extrato (`.eml`) ou dos anexos (`.csv`/`.ofx`) direto no dashboard, sem depender de Chrome autenticado, AppleScript ou agente local.
- As superficies internas do web voltaram a abrir sem prompt de navegador; o endurecimento ficou concentrado na API direta e no proxy server-to-server do app.
- A API agora roda com `APP_AUTH_ENABLED=true` em producao; leituras operacionais anonimas como `/orders`, `/customers`, `/payments`, `/dashboard/summary` e `/runtime-config` passaram a responder `401`.
- O tema publico do builder/home passou a ser servido por `/api/runtime-theme`, que usa token server-to-server sem reabrir `runtime-config` completo ao navegador.
- Os alertas de `ntfy` foram saneados para nao carregar telefone, endereco completo nem observacoes do cliente; o texto operacional ficou reduzido a nome curto, sabores, agenda, modo, frete, total, PIX e link interno.
- Em `/pedido`, quando `Retirada` e selecionada, o ponto de retirada agora e preenchido automaticamente como `Alameda Jau, 731` e fica bloqueado para edicao pelo cliente.
- `/pedido` agora salva localmente os dados do cliente neste aparelho, oferece `Refazer ultimo pedido` e trocou o subtotal/CTA flutuante de mobile por um bloco inline no fluxo, evitando sobreposicao no scroll.
- A home publica `/` nao exibe mais CTA de instalacao/atalho mobile; o fluxo publico foi simplificado para manter a home sem instrucoes extras nem affordance inconsistente entre plataformas.
- A home publica `/` agora trava o viewport visivel real do navegador e bloqueia overflow de `html/body` enquanto a rota esta montada, mantendo `scrollWidth == innerWidth` e `scrollHeight == innerHeight` em desktop e mobile.
- A home publica `/` agora fixa tambem o `body` em `position: fixed` enquanto esta montada, para bloquear bounce/rolagem residual em iPhone e navegadores com barras dinamicas.
- Em `/pedido`, o header sticky compacto e o hero superior com `@QUEROBROA` + galeria foram removidos no desktop; a experiencia passa a abrir direto no formulario/resumo nessa largura.
- Em `/pedido`, os dois blocos introdutorios do topo foram removidos por completo; a pagina agora abre direto em `Dados`, e os rótulos pequenos redundantes das seções tambem sairam.
- O frete do cliente segue tabela operacional por raio a partir da Alameda Jau, 731: `R$ 12` ate `5 km`, `R$ 20` de `6-10 km`, `R$ 22` de `11-15 km`, `R$ 25` de `16-20 km`, `R$ 30` de `21-25 km` e `R$ 35` de `26-30 km`; acima de `30 km` o cliente recebe `FORA DA ÁREA DE ENTREGA`. A cotacao e o calculo acontecem 100% no backend e a tabela agora pode ser editada internamente em `/frete`, refletindo imediatamente nos novos quotes.
- A cotacao agora protege o caso `origem = destino` e usa hash de quote mais fiel ao payload real.
- `/pedido` e o modal de novo pedido em `/pedidos` agora usam o mesmo fluxo em duas etapas para entrega: `Calcular frete` antes de `Finalizar pedido/Criar pedido`.
- `/pedido` passou a preservar o cadastro ao usar `Fazer outro pedido`, limpando apenas a composicao do pedido e rolando de volta ao topo para uma nova montagem.
- A cotacao publica de `/pedido` agora usa a assinatura canonica dos sabores para casar com o intake final e evitar refresh indevido do frete na primeira finalizacao.
- As caixas mistas passaram a usar composicao visual unica no mesmo quadrante, padronizada entre a captura publica e a operacao interna.
- As caixas mistas agora usam corte seco entre as duas imagens, sem a faixa branca intermediaria.
- O desktop de `/pedido` agora usa grids mais elasticas em vez de tracks fixas, evitando colapso de endereco, caixas e `Caixa Sabores` em navegacoes diferentes, inclusive browsers mais sensiveis a `minmax` rigido.
- `/pedido` agora deixa explicito antes do submit que pedido novo nao entra para hoje, mostrando o primeiro horario disponivel na propria area de agendamento e no resumo lateral.
- A `Caixa Sabores` de `/pedido` agora mostra uma composicao com as artes oficiais dos sabores ativos do catalogo no mesmo envelope visual da imagem anterior.
- A composicao de `Caixa Sabores` agora foi centralizada em arte compartilhada alinhada aos sabores ativos do catalogo, evitando que `/pedido` e outros pontos do web recaiam no JPG legado `sabores-caixa.jpg` por fallback generico.
- O asset publico `sabores-caixa.jpg` tambem foi atualizado para a mesma composicao vertical full bleed alinhada ao catalogo atual, incluindo `Romeu e Julieta`, mantendo site e catalogos sincronizados.
- O autocomplete de endereco em `/pedido` e `/clientes` saiu do widget legado `google.maps.places.Autocomplete` e passou para a API nova programatica do Google Places, preservando os inputs atuais e eliminando o warning de deprecacao no console.
- A linha de quantidade dos cards de caixas em `/pedido` saiu do grid aninhado fragil e passou a usar miolo flexivel com container query por card, evitando que o selo `0 caixas` seja esmagado entre input e botao `+` em Safari/desktop.
- O bloco `Entrega ou retirada` de `/pedido` agora responde ao tamanho real do painel via container query, sem voltar a colapsar `Endereco/Data/Horario` em Chrome/desktop ou em larguras intermediarias.
- O popup de detalhe de pedido em `/pedidos` agora usa os proprios icones de etapa como botoes diretos de status, sem setas laterais; ao selecionar uma etapa, o backend percorre o caminho intermediario automaticamente para preservar os mesmos recalculos e gatilhos operacionais.
- O popup de detalhe de pedido em `/pedidos` removeu o bloco completo de PIX e reorganizou o resumo logo abaixo de `Caixas`, exibindo `Produtos`, `Frete` e `Total` na ordem operacional.
- O backend de estoque agora bloqueia edicao de itens e exclusao de pedido depois que o pedido ja gerou movimentacoes fisicas (`PRODUCTION_BATCH` ou equivalentes), evitando dessintonia entre composicao do pedido e baixa real.
- O calculo de `D+1`/`production/requirements` agora desconta o que ja foi produzido na runtime de fornadas para o mesmo pedido, em vez de continuar projetando demanda cheia apos a baixa real do batch.
- O ajuste manual de saldo em `Estoque` agora ancora o saldo contado com `ADJUST` absoluto por familia, em vez de simular delta relativo sobre historico antigo.
- `/pedidos` deixou de renderizar eventos auxiliares de `FAZER MASSA`; a agenda agora mostra apenas pedidos reais, sem popup/manual extra para preparo, preservando apenas as baixas de ingredientes que o proprio pedido gera.
- O shell operacional mobile agora bloqueia `touch callout`/menu de contexto irrelevante nas superficies interativas do app, reduzindo conflito entre long-press nativo do iPhone e gestos como arrastar pedidos no calendario, sem desabilitar selecao em campos de texto.
- `/pedido` e `/pedidos` agora redirecionam o pos-criacao para `/pedidofinalizado`, com card final isolado, retorno contextual (`Fazer novo pedido` ou `Voltar para pedidos`) e preservacao apenas dos dados cadastrais do cliente no caso publico.
- `/pedidofinalizado` agora roda sem shell operacional, sem menu lateral e sem topbar, isolado como rota publica de conclusao.
- `/dashboard` voltou a existir como rota oculta interna, agora com painel real de analytics first-party do site, vitals e performance financeira/operacional da broa.
- O estoque ganhou historico de preco por item/familia em unidade real de compra, com baseline dedicada desde o primeiro pedido e painel novo `Preços` dentro de `/estoque`.
- O COGS do `/dashboard` deixou de usar apenas o custo corrente do insumo e passou a escolher o preco vigente na data de cada pedido, com fallback para a media historica pesquisada quando faltam pontos antigos.
- O COGS do `/dashboard` agora tambem respeita a semantica real do pedido em broas, nao em caixas: a ficha tecnica oficial publicada foi recalibrada para rendimento de `36 broas`, com sacola a cada `2 caixas`, base historica dos `433` pedidos recalculada e margem bruta consolidada novamente em patamar plausivel.
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
- O dashboard operacional agora expoe o rail `Extrato bancario`, com cobertura do ultimo arquivo importado, quantidade de linhas, conciliacoes realizadas e entradas ainda sem match.
- O fluxo de cupons agora registra tentativa invalida no backend com motivo (`sem cupons ativos`, `cupom inativo` ou `codigo nao encontrado`) e devolve mensagem explicita ao publico, para nao ficar ambiguo quando um cupom ainda nao foi cadastrado em producao.

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
- `/pedido`: `Caixa Sabores` e fallbacks genericos do catalogo agora usam a mesma composicao oficial alinhada aos sabores ativos do catalogo, sem regressao para a arte antiga.
- `/pedido`: autocomplete de endereco segue no input atual, com sugestoes novas do Google Places e sem warning legado no console.
- `/pedido`: o menu de sugestoes do endereco agora usa visual simples de caixa de selecao, sem blur/glass effect, para melhorar legibilidade no fluxo publico.
- `/pedido`: cards de caixas no desktop mantem input e selo de quantidade legiveis lado a lado, sem o bloco `caixas` comprimir ou quebrar em colunas estreitas.
- `/pedido`: o grid de `Endereco/Data/Horario` agora abre 1, 2 ou 3 colunas conforme a largura real do card, em vez de depender de breakpoint de viewport que podia divergir entre browsers.
- `/pedido` e `/pedidos`: caixas mistas agora usam as fotos finais exportadas da marca, em vez da montagem antiga com meia-broa.
- `/`: landing publica fullscreen da marca, preparada para `www.querobroa.com.br`.
- `/`: landing publica fullscreen da marca com CTA principal para `Fazer pedido`, sem CTA de instalacao/atalho mobile.
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
- Historico de preco: `inventory-price-board`, `inventory-items/:id/purchase-price`, `inventory-items/research-price-baseline` e gravacao em `InventoryPriceEntry`
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

- Data: 2026-03-30
- Ciclo executado: `pnpm --filter @querobroapp/web build`
- Resultado: a home e `/pedido` passaram a anunciar `stack-wide.jpg` como preview largo, enquanto `icon.png`, `apple-touch-icon.png`, `querobroa-icon-192.png` e `querobroa-icon-512.png` foram regenerados a partir de `stack.jpg` com crop quadrado centralizado e um leve deslocamento para cima, alinhando favoritos, atalho e cards do Safari com a foto atual da marca sem bordas laterais nem desequilíbrio vertical.

- Data: 2026-03-30
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`
- Resultado: clicar em cards de `/pedidos` deixou de disparar um recarregamento inteiro da workspace; a tela abre o drawer de detalhe direto, sem o loop curto de carregamento. A varredura nas outras telas operacionais nao encontrou o mesmo padrao de refetch acoplado a selecao local.

- Data: 2026-03-30
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`
- Resultado: `/pedidos` passou a operar com drawer lateral no lugar do modal central, o viewport do app ficou travado sem pinch zoom e o calendario mobile preserva ao menos o nome do cliente quando os cards ficam comprimidos por sobreposicao.

- Data: 2026-03-30
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`, `npx --yes @railway/cli up -d -s querobroapp -m "fix(web): preserve public order date selection"`, `pnpm validate:public-deploy`
- Resultado: o formulario publico de `/pedido` deixou de voltar sozinho para a proxima data disponivel ao trocar o calendario; o deploy do web foi publicado no Railway e a validacao publica voltou verde com `200` em `/`, `/pedido` e `/pedidos`, `apiHealth=ok`, preview `PIX_PENDING` e quote `LOCAL / MANUAL_FALLBACK`.

- Data: 2026-03-25
- Ciclo executado: `pnpm --filter @querobroapp/web build`
- Resultado: o `Resumo do dia` em `/pedidos` passou a listar cada sabor em uma linha, no formato `7 Tradicional`, removendo o codigo entre parenteses e melhorando a leitura sequencial para a escolha das fornadas.
- Data: 2026-03-25
- Ciclo executado: `pnpm --filter @querobroapp/api build`, `node --test tests/order-created-alerts.test.mjs`
- Resultado: os alertas de `order.created` enviados via `ntfy` passaram a incluir um resumo compacto dos sabores do pedido no formato `Sabores: Tradicional - 7 • Goiabada - 7`, e o webhook operacional agora carrega o mesmo resumo estruturado.
- Data: 2026-03-25
- Ciclo executado: `pnpm --filter @querobroapp/web build`
- Resultado: `/pedidos` ganhou no box `PEDIDOS` um card `Resumo do dia` abaixo do total, consolidando por cliente os sabores e quantidades do dia selecionado para orientar rapidamente as fornadas.
- Data: 2026-03-25
- Ciclo executado: `pnpm --filter @querobroapp/web build`
- Resultado: a régua de período do `/dashboard` passou a usar o mesmo padrão visual de `app-button-primary` e `app-button-ghost` do restante do app, corrigindo contraste e legibilidade dos botões.
- Data: 2026-03-25
- Ciclo executado: `pnpm --filter @querobroapp/web build`
- Resultado: o `/dashboard` passou a ignorar falhas transitórias de refresh quando já existem dados carregados, evitando o banner bloqueante `Service Unavailable` sobre métricas já resolvidas ao trocar o período.
- Data: 2026-03-26
- Ciclo executado: `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`, probes HTTP anonimos/autenticados em `querobroa.com.br` e `api.querobroa.com.br`, deploy Railway da API com auth ligada.
- Resultado: bridges dedicados de dashboard/cupom foram removidos, o web interno passou a usar `/api/internal` com token server-to-server, a API operacional fechou leituras anonimas com `401`, `mass-prep-events` saiu do roteamento real e o build da API passou a limpar `dist` antes do `tsc`; o prompt de Basic Auth do navegador foi revertido em seguida para devolver acesso publico as telas internas.
- Data: 2026-03-26
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`, probes em `/pedidos` e `/api/internal/orders` apos o revert do Basic Auth.
- Resultado: o proxy `/api/internal` passou a devolver `Cache-Control: no-store` explicito e o `apiFetch` ganhou retry curto em falha de rede nos `GETs`, reduzindo o risco de o Safari ficar preso em `Load failed` ou em resposta operacional stale logo apos troca de deploy/auth.
- Data: 2026-03-26
- Ciclo executado: inspeção do payload real de `/api/internal/orders` e ajuste do proxy interno.
- Resultado: o bridge interno passou a reconstruir a resposta com corpo proprio e apenas headers seguros (`content-type` + `no-store`), sem herdar metadados HTTP do upstream; isso corrige o `Load failed` de Safari ao carregar `Pedidos` depois da troca de auth/deploy.
- Data: 2026-03-25
- Ciclo executado: `pnpm --filter @querobroapp/web build`, `pnpm --filter @querobroapp/web typecheck`
- Resultado: `/dashboard` passou a operar com um unico contexto de periodo, com `Periodo total` na mesma regua de selecao de `24h/7d/30d`; o bloco consolidado duplicado saiu, o botao `Atualizar` foi removido e a troca de periodo agora se reflete automaticamente ao clicar.
- Data: 2026-03-23
- Ciclo executado: `pnpm --filter @querobroapp/api build`, `node --test tests/dashboard-cogs-summary.test.mjs tests/order-mass-prep-automation.test.mjs tests/mass-prep-batch-priority.test.mjs`, deploy Railway `passionate-nourishment` (`fc55e5e7-c2d3-46af-b505-5db59296d59e`), recalibracao das BOMs publicadas via `PUT /boms/:id` para os produtos `3,4,5,6,7,297` e leitura autenticada de `dashboard/summary`.
- Resultado: a receita oficial de `36 broas` entrou de ponta a ponta, `qtyPerUnit` virou a base canonica do COGS, os recheios ficaram unificados em `8g` por broa, e o dashboard publicado caiu de `R$ 42.199,34` para `R$ 7.108,59` de COGS sobre `433` pedidos, sem warnings.
- Data: 2026-03-23
- Ciclo executado: `pnpm --filter @querobroapp/shared build`, `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`, `node --test tests/dashboard-cogs-summary.test.mjs`
- Resultado: historico de preco entrou no estoque e no dashboard; o COGS passou a respeitar a data de cada pedido e o harness de API agora sincroniza o schema temporario antes dos testes.
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
- Resultado: estoque manual passou a usar `ADJUST` absoluto, e foi aplicada no ledger local a correcao calculada para neutralizar a duplicidade historica da conversao manual de 13/03/2026 19:42:27; o popup de `FAZER MASSA` foi posteriormente removido da operacao.
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

## Atualizacoes recentes

- Data: 2026-03-26
- Ciclo executado: `pnpm --filter @querobroapp/shared build`, `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`
- Resultado: o horario inicial do fluxo publico `/pedido` deixou de abrir `08:00` e passou a abrir `09:00`, usando a mesma regra compartilhada de disponibilidade para web e API.

- Data: 2026-03-26
- Ciclo executado: `pnpm --filter @querobroapp/web build`, criacao de `apps/web/public/meta-catalog.csv`, inspeção do Commerce Manager autenticado e download do feed manual atual do catalogo da Meta.
- Resultado: ficou confirmado que o item `Caixa Sabores` do WhatsApp Business nao consome a arte do site automaticamente; o catalogo depende de um feed CSV manual da Meta. O repositorio passou a carregar um `meta-catalog.csv` publico com `image_link` novo para `QUEROBROA-S`, usando a arte vertical atual de `sabores-caixa.jpg`.

- Data: 2026-03-27
- Ciclo executado: `pnpm --filter @querobroapp/shared build`, `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`, `node --test tests/order-discount-pct-marketing.test.mjs`
- Resultado: o novo pedido interno em `/pedidos` passou a aceitar desconto em percentual, o financeiro passou a tratar esse abatimento manual como investimento de marketing em amostras, o dashboard ganhou a metrica dedicada e pedidos com `100%` de desconto deixaram de gerar cobranca PIX pendente.

- Data: 2026-03-27
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`
- Resultado: o campo de desconto do novo pedido em `/pedidos` foi endurecido como campo livre de `0%` a `100%`, com hint explicito e normalizacao visual do valor digitado para nao deixar a interface mostrar percentuais acima do limite.

- Data: 2026-03-27
- Ciclo executado: `pnpm --filter @querobroapp/shared build`, `pnpm --filter @querobroapp/api exec prisma generate`, `pnpm --filter @querobroapp/api exec prisma generate --schema prisma/schema.prod.prisma`, `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`, `node --test tests/coupon-management-and-public-preview.test.mjs`
- Resultado: cupons passaram a suportar limite de uso por cliente com trava efetiva no resolve publico e no intake final, os pedidos passaram a persistir `couponCode`, o detalhe de `/clientes` passou a mostrar `Cupons utilizados`, o endereco do cliente passou a incluir `Complemento` nas exibicoes relevantes e o autofill/salvamento deixou de aceitar `bairro` com numeros. O aviso publico do `/pedido` para cupom rejeitado foi padronizado para `CUPOM NÃO VÁLIDO / JÁ UTILIZADO`.

- Data: 2026-03-27
- Ciclo executado: `pnpm --filter @querobroapp/shared build`, `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`
- Resultado: o sabor `Romeu e Julieta (RJ)` passou a ser reconhecido no catalogo publico do `/pedido`, no prefill por `catalog=RJ`, nas contagens operacionais de estoque e no consumo automatico de recheios (`goiabada + requeijao de corte`). O feed unico `apps/web/public/meta-catalog.csv` ganhou a linha `QUEROBROA-RJ`, `sabores-caixa.jpg` foi recomposta com 6 colunas e entrou a arte publica nova `romeu-e-julieta.jpg`. A origem do gargalo de deploy tambem ficou estabilizada usando assets versionados do proprio repositorio, sem depender de upload efemero de `/uploads/products`.

- Data: 2026-03-27
- Ciclo executado: `pnpm --filter @querobroapp/shared build`, `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`, `node --test tests/order-schedule-capacity.test.mjs`
- Resultado: o agendamento de pedidos passou a respeitar a capacidade real do forno em janelas de producao, usando `14 broas por hora` como limite operacional. Cada pedido agora ocupa no calendario uma faixa que comeca antes do horario pronto/entrega, com duracao calculada por `ceil(totalBroas / 14) * 60 min`, e novos agendamentos so entram quando nao colidem com essa janela de forno.

- Data: 2026-03-27
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`
- Resultado: o CEP deixou de aparecer nos cards de clientes e pedidos, inclusive quando estava embutido no endereco bruto ja salvo. O campo continua existindo normalmente apenas no cadastro/edicao do cliente.

- Data: 2026-03-27
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`
- Resultado: o calendario de `/pedidos` passou a exibir uma linha vermelha do horario atual nas visoes `DIA` e `SEMANA`, atualizada automaticamente como nos apps de agenda, sem interferir nos cards de pedido nem na visao mensal.

- Data: 2026-03-27
- Ciclo executado: `pnpm --filter @querobroapp/api build`, `node --test tests/order-schedule-capacity.test.mjs`
- Resultado: a trava de capacidade do forno foi isolada ao fluxo publico de `/pedido` e ao endpoint publico de disponibilidade. O fluxo interno de `/pedidos` voltou a permitir criar, mover e editar pedidos em horarios sobrepostos, sem perder o calculo visual de duracao no calendario.

- Data: 2026-03-27
- Ciclo executado: `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`, `node --test tests/order-discount-pct-marketing.test.mjs`
- Resultado: o modal de edicao de pedido em `/pedidos` passou a permitir incluir, alterar e remover desconto percentual, usando o mesmo padrao do novo pedido. O update do backend passou a recalcular o total e a sincronizar a metadata de `Investimento de marketing: AMOSTRAS` quando o desconto e ajustado no fluxo interno.

- Data: 2026-03-28
- Ciclo executado: `pnpm --filter @querobroapp/shared build`, `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`, `node --test tests/order-schedule-capacity.test.mjs`
- Resultado: o `/pedido` deixou de expor horarios exatos ao cliente e passou a trabalhar com 3 faixas publicas (`9h - 12h`, `12h - 16h`, `16h - 20h`). O backend resolve internamente o primeiro horario viavel dentro da faixa escolhida, preservando a logica de duracao por quantidade de broas e a capacidade do forno. O `/pedidos` interno segue livre de sobreposicao forçada pela trava publica, e o fluxo de edicao interna deixou de depender da persistencia de quote de frete dentro da transacao.

- Data: 2026-04-08
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`, restart local do `next dev` em `127.0.0.1:3000`, validacao manual mobile de `/pedido`, `npx --yes @railway/cli up -d -s querobroapp -m "fix(web): stabilize mobile custom box layout and RJ mixed art"`, `pnpm validate:public-deploy`
- Resultado: a `Monte Sua Caixa` em `/pedido` deixou de quebrar os controles de quantidade no mobile e passou a usar um grid estavel para sabor + `- / quantidade / +`, sem a cascata observada no iPhone. A `Mista Romeu e Julieta` deixou de montar a arte especial em 3 colunas e passou a reutilizar o mesmo split dinamico das outras mistas, usando a foto atual do sabor `RJ` automaticamente quando ele estiver ativo no catalogo. O web publicado no Railway foi revalidado com `200` em `/` e `/pedido`, redirect protegido de `/pedidos`, `apiHealth=ok`, preview `PIX_PENDING` e quote `LOCAL / MANUAL_FALLBACK`. No mesmo ciclo, o app ganhou `apps/web/src/app/not-found.tsx` para eliminar a quebra de build de `/_not-found` que estava bloqueando a publicacao do web.

- Data: 2026-04-08
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, validacao visual mobile em `https://querobroa.com.br/pedido`, `npx --yes @railway/cli up -d -s querobroapp -m "fix(web): restore cover art in caixas and keep contain in amigas"`, `pnpm validate:public-deploy`
- Resultado: o renderer de arte do `/pedido` passou a distinguir uploads gerenciados por contexto. No catalogo principal (`Caixas`, `Monte Sua Caixa` e mistas), as imagens voltaram ao comportamento de `cover`, preenchendo totalmente o quadro como os demais sabores. Em `AMIGAS DA BROA`, os cards e a gaveta seguem com `contain`, preservando a imagem inteira dentro do frame sem reaplicar esse racional ao restante do catalogo. O deploy publicado foi revalidado com `200` em `/pedido`, `apiHealth=ok` e checagem visual mobile no dominio publico.

- Data: 2026-04-08
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, `npx --yes @railway/cli up -d -s querobroapp -m "fix(web): hide amigas da broa on public pedido"`, `pnpm validate:public-deploy`
- Resultado: a sessao `AMIGAS DA BROA` do `/pedido` passou a ficar disponivel apenas no ambiente local. O `page.tsx` agora detecta `localhost/127.0.0.1` no host para manter `showCompanionProducts=true` localmente, enquanto o dominio publicado recebe a secao como oculta (`hidden` + `aria-hidden=true`) e sem itens companheiros entrando em resumo, total ou payload do pedido. O deploy publico voltou com `200` em `/pedido` e `apiHealth=ok`.

- Data: 2026-04-08
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, `npx --yes @railway/cli up -d -s querobroapp -m "fix(web): disable amigas UI in production pedido"`, `pnpm validate:public-deploy`
- Resultado: o totalizador `Amigas` tambem saiu do painel publico de `/pedido`. A regra de exibicao foi endurecida para `process.env.NODE_ENV !== 'production'`, garantindo que a UI de `AMIGAS DA BROA` continue disponivel apenas em dev/local. No HTML publicado, o card `Amigas` deixou de existir no painel lateral, enquanto a secao principal segue entregue como `hidden` para nao impactar visualmente nem os totais/payloads do pedido publico.

- Data: 2026-04-09
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, validacao local de `POST /api/delivery-quote` em `127.0.0.1:3000`
- Resultado: o fluxo publico de cotacao de frete em `/pedido` ganhou protecao contra requests penduradas e respostas antigas. O bridge `apps/web/src/app/api/delivery-quote/route.ts` agora aborta a chamada upstream apos 12s e devolve `504` com mensagem amigavel; a tela `apps/web/src/app/pedido/public-order-page.tsx` passou a cancelar cotacoes anteriores quando endereco/data/itens mudam, descartar respostas stale e limpar o estado de `CALCULANDO FRETE...` mesmo quando a request trava ou expira.

- Data: 2026-04-09
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, `npx --yes @railway/cli up -d -s querobroapp -m "fix(web): harden /pedido freight quote flow"`, `pnpm validate:public-deploy`
- Resultado: a correção do frete em `/pedido` foi publicada no Railway. O domínio público voltou validado com `200` em `/pedido`, proteção de `/pedidos` por `/acesso`, `apiHealth=ok`, quote pública `LOCAL / MANUAL_FALLBACK / fee=12 / status=QUOTED` e preview `PIX_PENDING` consistente no fluxo de pedido externo.

- Data: 2026-04-09
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, replay local com Playwright em `http://127.0.0.1:3000/pedido`, `pnpm --filter @querobroapp/web build`, `npx --yes @railway/cli up -d -s querobroapp -m "fix(web): retain public /pedido freight quotes by request fingerprint"`, `pnpm validate:public-deploy`, replay publicado com Playwright em `https://querobroa.com.br/pedido`
- Resultado: a causa real do travamento em `CALCULANDO FRETE...` era uma invalidação ampla demais do estado da cotação no cliente. O `/pedido` agora prende a quote a um fingerprint estável do pedido atual, só invalida quando endereço/agenda/itens realmente mudam e reaproveita a quote válida também no submit/refresh do pedido. No mesmo ciclo foi corrigido o bloqueio de deploy do `web` por lint (`prefer-const` em `apps/web/src/app/pedido/page.tsx`) e a derivação de `companionProducts` passou a usar `useMemo` para estabilizar as dependências. A publicação `87a63c7b-c103-4373-9ed4-58c514cb4d22` ficou `SUCCESS` no Railway e o replay público confirmou o fluxo completo: após `POST /api/delivery-quote => 201`, o painel lateral passou a exibir `Frete R$ 12,00`, `Total R$ 52,00` e o CTA mudou de `CALCULAR FRETE` para `FINALIZAR PEDIDO`.

- Data: 2026-04-09
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, `pnpm --filter @querobroapp/web build`, restart manual do `next dev` local em `127.0.0.1:3000`, checagem HTTP local de `/pedido` e `/pedidofinalizado`
- Resultado: o fluxo público de confirmação deixou de expor identificadores do pedido ao cliente. O bridge `apps/web/src/app/api/customer-form/route.ts` agora sanitiza a resposta de sucesso do `POST /api/customer-form` para devolver apenas `total`, `scheduledAt`, `stage`, `deliveryFee` e `pixCharge`, sem `order.id`, `publicNumber`, `orderId`, `customerId` ou `paymentId`. A session storage usada por `/pedidofinalizado` (`querobroapp:order-finalized`) também passou a salvar e reler apenas o subconjunto mínimo necessário para a UI, regravando payloads antigos já no primeiro read para eliminar vazamentos residuais. O evento analítico público de submit também deixou de carregar `orderId`. O ajuste ficou validado localmente com `typecheck`, `build` e `200` em `/pedido` e `/pedidofinalizado`, mas ainda nao foi publicado.

- Data: 2026-04-09
- Ciclo executado: `pnpm --filter @querobroapp/web typecheck`, ajuste de runtime flag para `AMIGAS DA BROA`, subida local de `http://127.0.0.1:3000` e laboratorio em `http://127.0.0.1:3002`
- Resultado: o ambiente local deixou de usar `localhost` como gatilho implícito para `AMIGAS DA BROA`. O `/pedido` oficial em `127.0.0.1:3000` agora replica o publicado por padrão, sem `AMIGAS`, enquanto o laboratório experimental ficou isolado atrás de `NEXT_PUBLIC_ENABLE_AMIGAS_DA_BROA=1` no script `pnpm dev:web:amigas-lab`, servindo em `127.0.0.1:3002`. O `/estoque` também passou a esconder a categoria e os campos experimentais nesse trilho oficial, reduzindo o risco de misturar ajustes finos do publicado com a feature ainda não lançada.

- Data: 2026-04-09
- Ciclo executado: `node --check scripts/public-site-mirror.mjs`, subida do espelho local em `http://127.0.0.1:3000`, comparacao de hash de `/pedido`, `/api/order-catalog`, `/api/order-schedule` e `/api/runtime-theme` contra `https://querobroa.com.br`, validacao do lab em `http://127.0.0.1:3002/pedido`
- Resultado: a separacao de ambientes deixou de depender do banco local para o trilho oficial. `http://127.0.0.1:3000` passou a ser um espelho HTTP local exato do dominio publicado via `pnpm dev:web:published-local`, com hash identico ao HTML de `/pedido` e aos payloads publicos de catalogo, agenda e tema. O lab futuro segue isolado em `http://127.0.0.1:3002` usando o codigo local e a API local, inclusive com `AMIGAS DA BROA`. Isso elimina o drift que existia quando o `3000` ainda tentava simular o publicado em cima do banco SQLite local. Quando for necessario mexer no publicado sem contaminar o lab, o ponto de partida correto passa a ser o espelho oficial e nao o trilho experimental.

- Data: 2026-04-14
- Ciclo executado: evolucao completa de `AMIGAS DA BROA` entre `apps/web/src/app/pedido/public-order-page.tsx`, `apps/web/src/app/estoque/page.tsx`, `apps/api/src/modules/orders/orders.service.ts`, `apps/api/src/modules/inventory/inventory-products.service.ts` e `apps/api/src/modules/inventory/inventory.service.ts`; publicacoes sucessivas no Railway para `querobroapp` e `passionate-nourishment`; fechamento do dia com `pnpm --filter @querobroapp/shared build`, `pnpm --filter @querobroapp/api build`, `pnpm --filter @querobroapp/web build`, `pnpm --filter @querobroapp/web exec tsc -p tsconfig.json --noEmit` e `pnpm validate:public-deploy`.
- Resultado: `AMIGAS DA BROA` foi integrada ao `/pedido` publicado com cards, gavetas, estoque direto por produto, auto-inativacao por saldo zerado, reativacao por reposicao manual e total/cupom separados das Broas. `Caixas Mistas` passaram a operar com card unico e gaveta no mesmo padrao de `Monte Sua Caixa`, preservando as fotos oficiais dentro da gaveta. O risco estrutural de perda de upload na API foi mitigado com volume em `/data` e fallback canonico das artes oficiais. O lote final do dia normalizou as acentuacoes em Portugues Brasileiro nos textos visiveis do web e nas mensagens expostas da API. Ultimos deploys do ciclo: API `8ea36cfd-7fd0-4f0c-9a45-9af66a1ac661` e web `a8174343-8235-444a-9700-7491ee4ef09f`, ambos validados com `home=200`, `pedido=200`, protecao de `/pedidos`, `apiHealth=ok`, preview `PIX_PENDING` e quote `LOCAL / MANUAL_FALLBACK`.

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
