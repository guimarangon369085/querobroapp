# QUEROBROAPP_CONTEXT

Ultima atualizacao: 2026-02-28

## Missao do produto

Facilitar operacao diaria de vendas e producao com interface simples e backend robusto.

## Estado atual

- Web operacional com foco em usabilidade.
- A casca principal do web foi redesenhada como `Broa do Dia`, priorizando uma jornada simples (`Hoje`, `Producao`, `Saidas`, `Caixa`, `Base`) e mantendo as telas antigas como detalhe operacional.
- A reconstrucao de `Pedidos` ja comecou em estrutura de feature (`orders-screen`, `orders-model`, `orders-api`, `order-filters`), mas o comportamento principal ainda e o mesmo; a mudanca desta rodada e organizacional para permitir a reescrita por partes.
- API com regras de pedido, financeiro, estoque e D+1.
- Builder removido da navegacao visivel e do backend legado; o app agora usa um modulo neutro de runtime-config em modo leitura, com alias legado apenas para compatibilidade.
- Uber evoluiu de link solto para readiness interno e rota de cotacao real no detalhe do pedido; sem credenciais oficiais, o app bloqueia a cotacao de forma segura e continua com fallback manual.

## Prioridades vigentes

1. UX cada vez mais simples para operador leigo.
2. Menos cliques no fluxo de pedidos.
3. Mais testes de dominio para evitar regressao.
4. Evolucao de integracoes externas (WhatsApp) em cima do outbox.

## Como retomar rapido

1. Ler `docs/PROJECT_SNAPSHOT.md`.
2. Ler `docs/NEXT_STEP_PLAN.md`.
3. Ler ultimas entradas de `docs/HANDOFF_LOG.md`.
4. Definir objetivo da sessao em 1 linha.
