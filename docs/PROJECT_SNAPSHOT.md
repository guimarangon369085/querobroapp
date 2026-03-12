# PROJECT_SNAPSHOT

Ultima atualizacao: 2026-03-12

## Estado atual

- Monorepo ativo com API, Web, Mobile e contratos compartilhados.
- Web consolidado em 3 telas operacionais reais: `Pedidos`, `Clientes` e `Estoque`, com captura publica em `/pedido`.
- `Pedidos` e a entrada principal; agenda `Dia/Semana/Mes` na mesma tela, com criacao de pedido no proprio painel e lista completa de pedidos logo abaixo do calendario.
- CTAs contextuais por tela: `Pedidos` usa acao `Criar` no painel, `Clientes/Produtos` usam acao inline/sticky e `Estoque` usa botao flutuante `Nova movimentacao`.
- `Calendario`, `Inicio`, `Jornada`, `Resumo` e `Builder` nao existem mais como superficies operacionais.
- Marca lateral usa o mark vetorial interno e favicon/shortcut usam `broa-mark.svg`, com o nome QUEROBROAPP.
- API cobre pedido, pagamento, estoque, BOM, D+1, producao e entrega local interna.
- O processo de qualidade atual inclui `qa:trust`, `qa:browser-smoke`, `qa:critical-e2e`, drift check e testes raiz.
- Gate operacional de religamento foi validado em 2026-03-11 com `stop-all -> dev-all`, health da API e execucao de smoke + E2E critico.
- `Produtos` deixou de existir como superficie operacional; catalogo e ficha tecnica ficam dentro de `Estoque`.
- Existe agora uma captura publica de pedido em `/pedido`, usando o mesmo intake externo que vai servir para `Google Forms`, pagina propria e futuro `WhatsApp Flow`.

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

## Telas web

- `/pedido`: pagina publica do cliente com submit para o intake canonico e exibicao do PIX copia e cola.
- `/pedidos`: agenda do dia, criacao de pedido, status, producao, entrega e pagamento.
- `/clientes`: cadastro e edicao rapida.
- `/estoque`: saldo, D+1, compras e leitura operacional.
- `/produtos`: redirect legado para `/estoque`.
- `/calendario`: redirect permanente para `/pedidos`.
- Rotas antigas (`/`, `/dashboard`, `/hoje`, `/jornada`, `/inicio`, `/resumo`, `/base`, `/producao`, `/saidas`, `/caixa`) convergem para `Pedidos`.
- Alias legado de captura (`/whatsapp-flow/pedido/:sessionId`) ainda converte para `Pedidos` ate a troca do canal.
- `/builder`: redirect para `/pedidos`; o runtime interno segue exposto por `GET /runtime-config`.

## API (blocos)

- Cadastro: `customers`, `inventory-products`
- Operacao: `orders`, `payments`, `deliveries`, `production`
- Estoque: `inventory`, `inventory-products`, `bom`
- Intake externo: `orders/intake`, `orders/intake/customer-form`, `orders/intake/google-form`, `orders/intake/whatsapp-flow`
- Suporte interno: `runtime-config` (read-only) e redirects legados controlados no web

## Qualidade tecnica

- `pnpm qa:trust`: gate unico de docs, diff, typecheck, testes e build.
- `pnpm qa:browser-smoke`: smoke de navegador real nas 4 telas principais.
- `pnpm qa:critical-e2e`: jornada critica de produto -> cliente -> pedido -> status.
- `pnpm check:prisma-drift`: guard de drift dev/prod.
- Os flows de QA que sobem um web temporario agora usam dist dirs dedicados do Next, para nao disputar o `.next` do `next dev`.
- O workflow principal de CI no GitHub agora roda `check:prisma-drift` e `qa:trust` com lint habilitado.
- O browser smoke garante o redirect legado de `/produtos` e cobre as telas operacionais principais.

## Validacao operacional mais recente

- Data: 2026-03-11
- Ciclo executado: `./scripts/stop-all.sh` -> `./scripts/dev-all.sh` -> `curl http://127.0.0.1:3001/health`
- QA executado antes e apos religamento: `pnpm qa:browser-smoke` e `pnpm qa:critical-e2e`
- Resultado: todos os gates passaram, incluindo jornada critica finalizando pedido como `ENTREGUE` e `PAGO`.

## Gaps abertos

1. `Google Forms` ja e viavel como canal temporario, mas ainda falta configuracao real do Apps Script e URL publica final.
2. `WhatsApp Flow` segue sem numero dedicado; a migracao futura deve reutilizar o contrato externo atual.
3. Mobile segue atras do web no fluxo operacional novo.
4. Ainda vale ampliar cobertura de testes alem dos gates atuais, principalmente em cenarios de edge case de dominio.

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
