# NEXT_STEP_PLAN

Ultima atualizacao: 2026-03-30

## Objetivo da fase atual

Consolidar o lancamento publico do app sobre o mesmo nucleo operacional:

- landing publica em `/`
- operacao interna em `Pedidos`
- captura externa em `/pedido` e `Google Forms`
- entrega com frete cotado antes do PIX, calculado internamente por raio
- COGS calculado por pedido com preco historico de insumo, usando baseline pesquisada desde o primeiro pedido quando necessario
- ficha tecnica oficial de broa recalibrada para `36 broas` por receita, com leitura por broa no dashboard e custo reprocessado sobre toda a base ativa

## Gate operacional (concluido em 2026-03-11)

- Ciclo executado: `./scripts/stop-all.sh` -> `./scripts/dev-all.sh`.
- API validada em `http://127.0.0.1:3001/health`.
- QA executado antes e apos religamento: `pnpm qa:browser-smoke` e `pnpm qa:critical-e2e`.
- Resultado: gates verdes e jornada critica concluindo pedido como `ENTREGUE` e `PAGO`.

## Prioridade 1 (concluida em 2026-03-21)

### Publicar o dominio real com captura publica e operacao no mesmo app

- Subir `web`, `api` e `Postgres` no host final.
- Apontar `www.querobroa.com.br` para o `web`.
- Garantir `/` como landing publica, `/pedido` como captura publica e `/pedidos` como superficie operacional.
- Publicar a URL final do `web` para a pagina `/pedido`.
- Validar uma abertura externa real nas 3 rotas finais do dominio.
- Validacao executada: `pnpm validate:public-deploy` e `pnpm validate:delivery-quote`, com `200` em `/`, `/pedido` e `/pedidos`, `apiHealth=ok` e quote publico `LOCAL / MANUAL_FALLBACK`.

Criterio de pronto:
- `www.querobroa.com.br`, `www.querobroa.com.br/pedido` e `www.querobroa.com.br/pedidos` abrem no deploy final e usam a mesma base operacional.

## Prioridade 2 (agora)

### Teste real do canal externo com total final correto

- Configurar `ORDER_FORM_BRIDGE_TOKEN` onde houver auth ligada.
- Montar o `Google Form` real com os labels definidos em `docs/GOOGLE_FORMS_BRIDGE.md`.
- Colar o `scripts/google-form-bridge.gs` no Apps Script do formulario.
- Garantir o uso do bundle ja publicado que expoe `POST /api/google-form/preview` e `POST /api/customer-form/preview`.
- Validar uma submissao real ponta a ponta caindo no app com `PIX_PENDING`.
- Validar no mesmo teste um pedido `Entrega` com frete somado antes do PIX.
- Rodar `pnpm validate:public-deploy` apos o deploy e manter `pnpm validate:delivery-quote` como checagem rapida de frete real.

Criterio de pronto:
- cliente consegue abrir o link, enviar o pedido e receber o PIX com o total final correto sem intervencao manual de cadastro.

## Prioridade 3 (agora)

### Refino final de Estoque e Pedidos

- Continuar reduzindo densidade visual e scroll na visao `Dia`.
- Continuar a extracao dos blocos grandes restantes de `orders-screen` para componentes menores.
- Manter o catalogo de caixas/sabores centralizado entre `/pedido`, `quick create` e `/pedidos`.
- Manter em `/pedido` a selecao manual de data/faixa estavel, sem resync da agenda sobrescrever a escolha do cliente durante a interacao com o calendario.
- Manter a numeracao publica sequencial de clientes/pedidos como unico numero exposto na interface.
- Validar em producao o CTA principal da home, o prefill local de `/pedido` e o fluxo `Refazer ultimo pedido`.
- Manter a home sem CTA de instalacao/atalho enquanto iPhone/iOS nao permitir um fluxo realmente coerente por clique direto.
- Manter a home travada ao viewport visivel real, sem qualquer rolagem residual causada por `100vh` ou barras do navegador.
- Manter a home sem bounce/scroll residual em iPhone, mesmo com barras dinamicas do navegador, e validar isso no dominio publico.
- Manter favoritos, favicon, `apple-touch-icon`, `manifest` e preview social da home ancorados na foto canonica atual (`stack.jpg`), sem voltar a sugerir imagens antigas da galeria ou composições desatualizadas ao favoritar/adicionar atalho.
- Manter o restante do app no mesmo modelo de viewport real da home, com modais, toasts, avisos e barras sticky respeitando `visualViewport` e safe areas do navegador.
- Manter `Novo pedido`, detalhe de pedido e detalhe de cliente no padrao drawer lateral sobreposto, sem regressao para modal central flutuante nem scroll no container externo.
- Manter o app sem pinch zoom e com gesto principal de navegacao restrito ao eixo vertical, evitando zoom acidental e conflito com drawers/calendario em mobile.
- Manter as rotas publicas com copy social curta e editorial no compartilhamento, sem texto tecnico de operacao no preview.
  Copy atual: `Sua vida + broa :) 🙂`.
- Manter na home desktop o fundo em 3 colunas sincronizadas e sem repeticao, evitando crop agressivo de uma unica imagem em widescreen.
- Manter na home desktop as trocas de coluna defasadas entre si, sem blackout simultaneo nas 3 faixas.
- Manter na home o contraste mais leve sobre as fotos e a navegacao desktop com botoes maiores, sem voltar a achatar o impacto visual.
- Manter o desktop de `/pedido` mais direto, sem blocos introdutorios redundantes acima do formulario.
- Manter o popup de status em `/pedidos` com clique direto no proprio icone de etapa, sem regressao para setas laterais e sem perder os recalculos/gatilhos intermediarios no backend.
- Manter `/pedido` abrindo direto em `Dados`, sem header/resumo duplicado no topo e sem labels redundantes de seção.
- Manter `/pedido` sem colapsos em desktop/mobile intermediario, com grids elasticos para agendamento, caixas e `Caixa Sabores` em qualquer navegador.
- Manter em `/pedido` a mensagem explicita de que pedido novo nao entra para hoje, sempre mostrando o primeiro horario liberado antes do erro final.
- Manter `/pedido` sem subtotal/CTA flutuante no mobile e com a `Caixa Sabores` exibindo a composicao oficial alinhada aos sabores ativos do catalogo.
- Manter `/pedido` e `/clientes` no autocomplete novo do Google Places, sem regressao para o widget legado nem novos warnings de console ao selecionar sugestao.
- Manter a linha de quantidade dos cards de `/pedido` no layout flexivel novo, sem voltar a comprimir o selo `caixas` em Safari/desktop ou em larguras intermediarias.
- Manter `/dashboard` acessivel no menu principal sem voltar a aplicar trava de host no web por engano.
- Manter `/dashboard` no formato editorial didatico novo, sem regressao para cards genericos ou leitura mais tecnica do que humana.
- Manter `Novo pedido` de `/pedidos` estavel em mobile, sem popup deformado nem quebra no bloco de quantidade.
- Manter `/pedidos` mobile sem FAB flutuante para `Novo pedido`, usando acao inline no proprio painel.
- Manter a abertura do detalhe de pedido sem refetch global da workspace ao trocar `selectedOrder`, evitando flashes curtos de loading ao clicar em cards.
- Manter os cards comprimidos do calendario de `/pedidos` mostrando ao menos o nome do cliente em mobile quando houver sobreposicao na mesma faixa.
- Manter `/pedidos` exibindo de forma visivel as 3 faixas publicas de `/pedido` (`9h - 12h`, `12h - 16h`, `16h - 20h`) no quick create e na edicao, para conferência operacional sem remover a liberdade de sobreposicao interna.
- Manter o intake externo/publico sem abortar transacao no Postgres ao reservar `publicNumber` para cliente/pedido.
- Manter a navegacao padronizada com `PEDIDOS` como item principal e labels em caixa alta em todo o menu.
- Seguir limpando redundancias em `Estoque` agora que `Produtos` saiu da navegação.
- Publicar o novo bloco `Preços` em `/estoque`, aplicar a baseline historica na base produtiva e confirmar o COGS sobre todos os pedidos ativos da base.
- Fechado neste lote: o COGS publicado foi recalibrado sobre os `433` pedidos usando a receita oficial de `36 broas`, com `qtyPerUnit` como base canonica, sacola a cada `2 caixas` e margem consolidada novamente em nivel plausivel.
- Validar estados vazios e mudanca de dia em desktop e mobile width.
- Fechado neste lote: `/dashboard` e analytics ficaram blindados por bridge/token, e `PICKUP` passou a ser respeitado em `/clientes` e no quick create de `/pedidos`.

Criterio de pronto:
- operador navega o dia, cria pedido e atualiza status sem friccao nem ambiguidades.

## Prioridade 4 (agora)

### Operacao externa canonica

- Consolidar `Google Forms` e `/pedido` sobre o mesmo contrato de preview/intake.
- Manter `PIX` simples no curto prazo: chave/copia e cola entregue ao cliente.
- Postergar automacao de confirmacao financeira ate existir provedor adequado.

Criterio de pronto:
- numero dedicado entra no mesmo contrato canonico sem refazer o fluxo de dominio.

## Ordem de execucao

1. Teste real de `/pedido` e do `Google Forms`, incluindo `Entrega`.
2. Refino final de `Estoque` e `Pedidos`, com foco agora em performance/agregacao do dashboard e fatiamento de `orders-screen`.
3. Consolidacao final do intake externo sem mensageria de terceiros.

## Riscos de nao fazer

- O deploy publico ja esta no ar; o risco agora e o canal externo parecer pronto sem Apps Script/token realmente configurados de ponta a ponta.
- Um formulario externo mal configurado pode criar friccao mesmo com o backend pronto.
- Se algum canal externo divergir do intake canonico ja implementado, isso vai reintroduzir retrabalho e inconsistencias operacionais.
