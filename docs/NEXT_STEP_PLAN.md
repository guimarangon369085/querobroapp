# NEXT_STEP_PLAN

Ultima atualizacao: 2026-03-17

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
- Validar uma submissao real ponta a ponta caindo no app com `PIX_PENDING`.
- Validar no mesmo teste um pedido `Entrega` com frete somado antes do PIX.

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
- Manter `/dashboard` acessivel no menu principal sem voltar a aplicar trava de host no web por engano.
- Manter a navegacao padronizada com `PEDIDOS` como item principal e labels em caixa alta em todo o menu.
- Seguir limpando redundancias em `Estoque` agora que `Produtos` saiu da navegação.
- Validar estados vazios e mudanca de dia em desktop e mobile width.
- Fechado neste lote: `/dashboard` e analytics ficaram blindados por bridge/token, e `PICKUP` passou a ser respeitado em `/clientes` e no quick create de `/pedidos`.

Criterio de pronto:
- operador navega o dia, cria pedido e atualiza status sem friccao nem ambiguidades.

## Prioridade 4 (agora)

### Migracao futura para WhatsApp Flow

- Reaproveitar o contrato externo atual (`customer-form`) em vez de criar outro dominio.
- Trocar apenas a origem do payload quando houver numero dedicado.
- Manter `PIX` simples no curto prazo: chave/copia e cola entregue ao cliente.
- Postergar automacao de confirmacao financeira ate existir provedor adequado.

Criterio de pronto:
- numero dedicado entra sem refazer o fluxo de dominio.

## Ordem de execucao

1. Publicar o dominio real e validar `/`, `/pedido` e `/pedidos`.
2. Teste real de `/pedido` e do `Google Forms`, incluindo `Entrega`.
3. Refino final de `Estoque` e `Pedidos`, com foco agora em performance/agregacao do dashboard e fatiamento de `orders-screen`.
4. Migracao futura para `WhatsApp Flow` sobre o mesmo contrato externo.

## Riscos de nao fazer

- O link publico pode parecer pronto sem estar realmente publicado com host, DNS e token corretos.
- Um formulario externo mal configurado pode criar friccao mesmo com o backend pronto.
- Se o contrato externo divergir entre canais, a migracao para `WhatsApp Flow` vai reintroduzir retrabalho.
