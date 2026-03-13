# NEXT_STEP_PLAN

Ultima atualizacao: 2026-03-13

## Objetivo da fase atual

Consolidar os canais de captura de pedido e o total final do checkout sobre o mesmo nucleo:

- operacao interna em `Pedidos`
- captura externa em `/pedido` e `Google Forms`
- entrega com frete cotado antes do PIX

## Gate operacional (concluido em 2026-03-11)

- Ciclo executado: `./scripts/stop-all.sh` -> `./scripts/dev-all.sh`.
- API validada em `http://127.0.0.1:3001/health`.
- QA executado antes e apos religamento: `pnpm qa:browser-smoke` e `pnpm qa:critical-e2e`.
- Resultado: gates verdes e jornada critica concluindo pedido como `ENTREGUE` e `PAGO`.

## Prioridade 1 (agora)

### Teste real do canal externo com total final correto

- Configurar `ORDER_FORM_BRIDGE_TOKEN` onde houver auth ligada.
- Publicar a URL final do `web` para a pagina `/pedido`.
- Montar o `Google Form` real com os labels definidos em `docs/GOOGLE_FORMS_BRIDGE.md`.
- Colar o `scripts/google-form-bridge.gs` no Apps Script do formulario.
- Validar uma submissao real ponta a ponta caindo no app com `PIX_PENDING`.
- Validar no mesmo teste um pedido `Entrega` com frete somado antes do PIX.

Criterio de pronto:
- cliente consegue abrir o link, enviar o pedido e receber o PIX com o total final correto sem intervencao manual de cadastro.

## Prioridade 2 (agora)

### Refino final de Estoque e Pedidos

- Continuar reduzindo densidade visual e scroll na visao `Dia`.
- Continuar a extracao dos blocos grandes restantes de `orders-screen` para componentes menores.
- Manter o catalogo de caixas/sabores centralizado entre `/pedido`, `quick create` e `/pedidos`.
- Seguir limpando redundancias em `Estoque` agora que `Produtos` saiu da navegação.
- Validar estados vazios e mudanca de dia em desktop e mobile width.

Criterio de pronto:
- operador navega o dia, cria pedido e atualiza status sem friccao nem ambiguidades.

## Prioridade 3 (agora)

### Migracao futura para WhatsApp Flow

- Reaproveitar o contrato externo atual (`customer-form`) em vez de criar outro dominio.
- Trocar apenas a origem do payload quando houver numero dedicado.
- Manter `PIX` simples no curto prazo: chave/copia e cola entregue ao cliente.
- Postergar automacao de confirmacao financeira ate existir provedor adequado.

Criterio de pronto:
- numero dedicado entra sem refazer o fluxo de dominio.

## Ordem de execucao

1. Teste real de `/pedido` e do `Google Forms`, incluindo `Entrega`.
2. Refino final de `Estoque` e `Pedidos`.
3. Migracao futura para `WhatsApp Flow` sobre o mesmo contrato externo.

## Riscos de nao fazer

- O link publico pode parecer pronto sem estar realmente publicado com URL/token corretos.
- Um formulario externo mal configurado pode criar friccao mesmo com o backend pronto.
- Se o contrato externo divergir entre canais, a migracao para `WhatsApp Flow` vai reintroduzir retrabalho.
