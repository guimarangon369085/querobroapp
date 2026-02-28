# QUEROBROAPP_CONTEXT

Ultima atualizacao: 2026-02-28

## Missao do produto

Facilitar operacao diaria de vendas e producao com interface simples, calendario como base e backend robusto.

## Estado atual

- Web operacional, com navegacao fixa em `Calendario`, `Pedidos`, `Clientes`, `Produtos`, `Estoque`.
- O calendario virou a tela-base do app e `Pedidos` virou a tela de execucao real do fluxo.
- O fluxo local ja e funcional de ponta a ponta: WhatsApp Flow -> pedido -> confirmacao -> fila de forno -> baixa real de estoque na fornada -> entrega com tracking -> aguardando pagamento.
- A Alexa ja consegue acionar a proxima fornada via `/alexa/bridge` ao detectar uma intencao/utterance com minutos de timer.
- Sem credenciais externas, a entrega cai em simulacao local persistente; com `UBER_DIRECT_*`, o codigo ja tenta seguir o caminho live antes do fallback.
- Builder segue removido da superficie publica; runtime interno continua em leitura via `runtime-config`.

## Prioridades vigentes

1. Eliminar interacoes “falsas” e loops sem efeito real.
2. Simplificar mais a tela de `Estoque`, deixando ficha tecnica visivel em nome, peso, valor e link de compra.
3. Ligar provedores externos reais (Meta WhatsApp Cloud API e Uber Direct live) quando as credenciais estiverem disponiveis.
4. Manter o handoff e o estado do repositório sempre sincronizados para continuidade segura.

## Como retomar rapido

1. Ler `docs/PROJECT_SNAPSHOT.md`.
2. Ler `docs/NEXT_STEP_PLAN.md`.
3. Ler as ultimas entradas de `docs/HANDOFF_LOG.md`.
4. Verificar se as credenciais `WHATSAPP_*`, `UBER_DIRECT_*` e `ALEXA_*` ja foram preenchidas.
