# PROJECT_SNAPSHOT

Ultima atualizacao: 2026-03-16

## Estado atual

- Monorepo ativo com API, Web, Mobile e contratos compartilhados.
- Web consolidado em 3 telas operacionais reais: `Pedidos`, `Clientes` e `Estoque`, com captura publica em `/pedido`.
- A raiz publica do web agora esta preparada para dominio externo: `/` pode operar como landing fullscreen da marca, `/pedido` como captura publica e `/pedidos` como superficie operacional no mesmo app.
- `Pedidos` e a entrada principal; agenda `Dia/Semana/Mes` na mesma tela, com criacao de pedido no proprio painel e lista completa de pedidos logo abaixo do calendario.
- CTAs contextuais por tela: `Pedidos` usa acao `Criar` no painel, `Clientes/Produtos` usam acao inline/sticky e `Estoque` usa botao flutuante `Nova movimentacao`.
- `Calendario`, `Inicio`, `Jornada`, `Resumo` e `Builder` nao existem mais como superficies operacionais.
- Marca lateral usa o mark vetorial interno e favicon/shortcut usam `broa-mark.svg`, com o nome QUEROBROAPP.
- API cobre pedido, pagamento, estoque, BOM, D+1, producao e entrega local interna.
- O processo de qualidade atual inclui `qa:trust`, `qa:browser-smoke`, `qa:critical-e2e`, drift check e testes raiz.
- Gate operacional de religamento foi validado em 2026-03-11 com `stop-all -> dev-all`, health da API e execucao de smoke + E2E critico.
- `Produtos` deixou de existir como superficie operacional; catalogo e ficha tecnica ficam dentro de `Estoque`.
- Existe agora uma captura publica de pedido em `/pedido`, usando o mesmo intake externo que vai servir para `Google Forms`, pagina propria e futuro `WhatsApp Flow`.
- Pedidos de `Entrega` agora podem receber cotacao de frete antes do submit final, com o valor incorporado ao total e ao PIX.
- `/pedido`, `quick create` e a logica de caixas em `Pedidos` passaram a compartilhar o mesmo catalogo de caixas/sabores e as mesmas imagens originais da marca.
- O provider principal de frete/entrega do app agora e `Loggi`, substituindo a integracao anterior com `Uber Direct`.
- `/pedido` e o modal de novo pedido em `/pedidos` agora usam o mesmo fluxo em duas etapas para entrega: `Calcular frete` antes de `Finalizar pedido/Criar pedido`.
- As caixas mistas passaram a usar composicao visual unica no mesmo quadrante, padronizada entre a captura publica e a operacao interna.
- `/dashboard` voltou a existir como rota oculta interna, agora com painel real de analytics first-party do site, vitals e performance financeira/operacional da broa.
- O web passou a instrumentar navegacao, links, funil e web vitals por coleta propria, gravando esses eventos na API para leitura imediata no dashboard.

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

- `/pedido`: pagina publica do cliente com submit para o intake canonico, cotacao previa de frete e exibicao do PIX copia e cola.
- `/pedido`: CTA principal abaixo do bloco `Resumo`; em `Entrega` ele calcula o frete antes da finalizacao, e em `Retirada` o frete zera.
- `/`: landing publica fullscreen da marca, preparada para `www.querobroa.com.br`.
- `/pedidos`: agenda do dia, criacao de pedido, status, producao, entrega e pagamento.
- `/pedidos`: modal `Novo pedido` alinhado visualmente com `/pedido`, sem miniatura redundante e com CTA de frete abaixo do resumo.
- `/clientes`: cadastro e edicao rapida.
- `/estoque`: saldo, D+1, compras e leitura operacional.
- `/produtos`: redirect legado para `/estoque`.
- `/calendario`: redirect permanente para `/pedidos`.
- `/dashboard`: pagina oculta interna com trafego, navegacao, vitals, funil e financeiro completo.
- Rotas antigas (`/`, `/hoje`, `/jornada`, `/inicio`, `/resumo`, `/base`, `/producao`, `/saidas`, `/caixa`) convergem para `Pedidos`.
- Alias legado de captura (`/whatsapp-flow/pedido/:sessionId`) ainda converte para `Pedidos` ate a troca do canal.
- `/builder`: redirect para `/pedidos`; o runtime interno segue exposto por `GET /runtime-config`.

## API (blocos)

- Cadastro: `customers`, `inventory-products`
- Operacao: `orders`, `payments`, `deliveries`, `production`
- Estoque: `inventory`, `inventory-products`, `bom`
- Intake externo: `orders/intake`, `orders/intake/customer-form`, `orders/intake/google-form`, `orders/intake/whatsapp-flow`
- Cotacao de frete: `deliveries/quotes` + proxy interno do web em `/api/delivery-quote`
- Proxy de `Google Forms`: web exposto em `/api/google-form` para receber o Apps Script sem abrir a API inteira publicamente
- Analytics first-party: `analytics/events` na API + proxy interno do web em `/api/analytics/track`
- Dashboard: `dashboard/summary` para trafego, vitals, financeiro, mix de produtos e recebiveis
- Suporte interno: `runtime-config` (read-only) e redirects legados controlados no web

## Qualidade tecnica

- `pnpm qa:trust`: gate unico de docs, diff, typecheck, testes e build.
- `pnpm qa:browser-smoke`: smoke de navegador real nas 4 telas principais.
- `pnpm qa:critical-e2e`: jornada critica de produto -> cliente -> pedido -> status.
- `pnpm check:prisma-drift`: guard de drift dev/prod.
- Os flows de QA que sobem um web temporario agora usam dist dirs dedicados do Next, para nao disputar o `.next` do `next dev`.
- O workflow principal de CI no GitHub agora roda `check:prisma-drift` e `qa:trust` com lint habilitado.
- O browser smoke garante o redirect legado de `/produtos` e cobre as telas operacionais principais.
- O app agora produz analytics first-party sem GA4 previa, usando o proprio banco para sessao, page view, link click e web vitals.

## Validacao operacional mais recente

- Data: 2026-03-11
- Ciclo executado: `./scripts/stop-all.sh` -> `./scripts/dev-all.sh` -> `curl http://127.0.0.1:3001/health`
- QA executado antes e apos religamento: `pnpm qa:browser-smoke` e `pnpm qa:critical-e2e`
- Resultado: todos os gates passaram, incluindo jornada critica finalizando pedido como `ENTREGUE` e `PAGO`.

## Gaps abertos

1. `Google Forms` ja e viavel como canal temporario, mas ainda falta configuracao real do Apps Script e URL publica final.
2. O dominio publico ja responde em `querobroa.com.br`, `www`, `ops` e `api`, mas o web ainda precisa publicar o bundle corrigido para `/pedidos` e `/pedido` nao cairem em fallback de `127.0.0.1` quando o client bundle estiver defasado.
3. `WhatsApp Flow` segue sem numero dedicado; a migracao futura deve reutilizar o contrato externo atual.
4. A integracao Loggi ja substituiu o provider anterior no codigo e no runtime, mas ainda vale validar o disparo real de shipment em producao sem criar entrega acidental.
5. Mobile segue atras do web no fluxo operacional novo.
6. Ainda vale ampliar cobertura de testes alem dos gates atuais, principalmente em cenarios de edge case de dominio.
7. O dashboard interno de analytics parte do zero sem historico legado; ele comeca a refletir navegacao nova a partir desta instrumentacao first-party.

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
