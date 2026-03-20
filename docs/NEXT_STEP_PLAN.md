# NEXT_STEP_PLAN

Ultima atualizacao: 2026-03-20

## Objetivo da fase atual

Consolidar o lancamento publico do app sobre o mesmo nucleo operacional:

- landing publica em `/`
- operacao interna em `Pedidos`
- captura externa em `/pedido` e `Google Forms`
- entrega com frete cotado antes do PIX, agora em modo hibrido `Uber Direct -> Loggi`

## Gate operacional (concluido em 2026-03-11)

- Ciclo executado: `./scripts/stop-all.sh` -> `./scripts/dev-all.sh`.
- API validada em `http://127.0.0.1:3001/health`.
- QA executado antes e apos religamento: `pnpm qa:browser-smoke` e `pnpm qa:critical-e2e`.
- Resultado: gates verdes e jornada critica concluindo pedido como `ENTREGUE` e `PAGO`.

## Prioridade 1 (agora)

### Publicar o dominio real com captura publica e operacao no mesmo app

- Subir `web`, `api` e `Postgres` no host final.
- Apontar `www.querobroa.com.br` para o `web`.
- Garantir `/` como landing publica, `/pedido` como captura publica e `/pedidos` como superficie operacional.
- Publicar a URL final do `web` para a pagina `/pedido`.
- Validar uma abertura externa real nas 3 rotas finais do dominio.

Criterio de pronto:
- `www.querobroa.com.br`, `www.querobroa.com.br/pedido` e `www.querobroa.com.br/pedidos` abrem no deploy final e usam a mesma base operacional.

## Prioridade 2 (agora)

### Teste real do canal externo com total final correto

- Configurar `ORDER_FORM_BRIDGE_TOKEN` onde houver auth ligada.
- Montar o `Google Form` real com os labels definidos em `docs/GOOGLE_FORMS_BRIDGE.md`.
- Colar o `scripts/google-form-bridge.gs` no Apps Script do formulario.
- Publicar no deploy final o bundle que expoe `POST /api/google-form/preview` e `POST /api/customer-form/preview`.
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
- Manter a numeracao publica sequencial de clientes/pedidos como unico numero exposto na interface.
- Validar em producao o atalho mobile da home, o prefill local de `/pedido` e o fluxo `Refazer ultimo pedido`.
- Manter a home sem CTA de instalacao/atalho enquanto iPhone/iOS nao permitir um fluxo realmente coerente por clique direto.
- Manter a home travada ao viewport visivel real, sem qualquer rolagem residual causada por `100vh` ou barras do navegador.
- Manter a home sem bounce/scroll residual em iPhone, mesmo com barras dinamicas do navegador, e validar isso no dominio publico.
- Manter o restante do app no mesmo modelo de viewport real da home, com modais, toasts, avisos e barras sticky respeitando `visualViewport` e safe areas do navegador.
- Manter as rotas publicas com copy social curta e editorial no compartilhamento, sem texto tecnico de operacao no preview.
  Copy atual: `Sua vida + broa :) 🙂`.
- Manter na home desktop o fundo em 3 colunas sincronizadas e sem repeticao, evitando crop agressivo de uma unica imagem em widescreen.
- Manter na home desktop as trocas de coluna defasadas entre si, sem blackout simultaneo nas 3 faixas.
- Manter na home o contraste mais leve sobre as fotos e a navegacao desktop com botoes maiores, sem voltar a achatar o impacto visual.
- Manter o desktop de `/pedido` mais direto, sem blocos introdutorios redundantes acima do formulario.
- Manter `/pedido` abrindo direto em `Dados`, sem header/resumo duplicado no topo e sem labels redundantes de seção.
- Manter `/pedido` sem colapsos em desktop/mobile intermediario, com grids elasticos para agendamento, caixas e `Caixa Sabores` em qualquer navegador.
- Manter em `/pedido` a mensagem explicita de que pedido novo nao entra para hoje, sempre mostrando o primeiro horario liberado antes do erro final.
- Manter `/pedido` sem subtotal/CTA flutuante no mobile e com a `Caixa Sabores` exibindo a composicao oficial dos 5 sabores.
- Manter `/pedido` e `/clientes` no autocomplete novo do Google Places, sem regressao para o widget legado nem novos warnings de console ao selecionar sugestao.
- Manter a linha de quantidade dos cards de `/pedido` no layout flexivel novo, sem voltar a comprimir o selo `caixas` em Safari/desktop ou em larguras intermediarias.
- Manter `/dashboard` acessivel no menu principal sem voltar a aplicar trava de host no web por engano.
- Manter `/dashboard` no formato editorial didatico novo, sem regressao para cards genericos ou leitura mais tecnica do que humana.
- Manter `Novo pedido` de `/pedidos` estavel em mobile, sem popup deformado nem quebra no bloco de quantidade.
- Manter `/pedidos` mobile sem FAB flutuante para `Novo pedido`, usando acao inline no proprio painel.
- Manter o intake externo/publico sem abortar transacao no Postgres ao reservar `publicNumber` para cliente/pedido.
- Manter a navegacao padronizada com `PEDIDOS` como item principal e labels em caixa alta em todo o menu.
- Seguir limpando redundancias em `Estoque` agora que `Produtos` saiu da navegação.
- Validar estados vazios e mudanca de dia em desktop e mobile width.
- Fechado neste lote: `/dashboard` e analytics ficaram blindados por bridge/token, e `PICKUP` passou a ser respeitado em `/clientes` e no quick create de `/pedidos`.

Criterio de pronto:
- operador navega o dia, cria pedido e atualiza status sem friccao nem ambiguidades.

## Prioridade 4 (agora)

### Ativacao final do WhatsApp Flow

- Publicar o Flow na Meta e preencher `WHATSAPP_FLOW_ORDER_INTAKE_ID`.
- Apontar `WHATSAPP_FLOW_API_BASE_URL` para a API publica final, se necessario.
- Validar o disparo real do convite no webhook e o submit do Flow caindo em `/pedidos`.
- Persistir a origem do canal no modelo/UI se for necessario distinguir pedido vindo do WhatsApp no operacional.
- Manter `PIX` simples no curto prazo: chave/copia e cola entregue ao cliente.
- Postergar automacao de confirmacao financeira ate existir provedor adequado.

Criterio de pronto:
- numero dedicado entra no mesmo contrato canonico sem refazer o fluxo de dominio.

## Ordem de execucao

1. Publicar o dominio real e validar `/`, `/pedido` e `/pedidos`.
2. Teste real de `/pedido` e do `Google Forms`, incluindo `Entrega`.
3. Refino final de `Estoque` e `Pedidos`, com foco agora em performance/agregacao do dashboard e fatiamento de `orders-screen`.
4. Ativacao final de `WhatsApp Flow` sobre o intake canonico ja pronto.

## Riscos de nao fazer

- O link publico pode parecer pronto sem estar realmente publicado com host, DNS e token corretos.
- Um formulario externo mal configurado pode criar friccao mesmo com o backend pronto.
- Se a ativacao final do `WhatsApp Flow` divergir do intake canonico ja implementado, o canal vai reintroduzir retrabalho e inconsistencias operacionais.
