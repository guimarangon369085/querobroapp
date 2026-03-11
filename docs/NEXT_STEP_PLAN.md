# NEXT_STEP_PLAN

Ultima atualizacao: 2026-03-11

## Objetivo da fase atual

Consolidar UX operacional em `Estoque` e `Pedidos` sobre um ambiente local ja validado em ciclo completo de religamento.

## Gate operacional (concluido em 2026-03-11)

- Ciclo executado: `./scripts/stop-all.sh` -> `./scripts/dev-all.sh`.
- API validada em `http://127.0.0.1:3001/health`.
- QA executado antes e apos religamento: `pnpm qa:browser-smoke` e `pnpm qa:critical-e2e`.
- Resultado: gates verdes e jornada critica concluindo pedido como `ENTREGUE` e `PAGO`.

## Prioridade 1 (agora)

### UX operacional em Estoque

- Hierarquia por jornada real: `planejar -> comprar -> produzir -> conferir`.
- Painel do dia com fila, broas alvo, fornadas e hora de inicio sugerida.
- Lista rapida de compras por faltas D+1.
- Validacao em desktop e mobile width com uso real.

Criterio de pronto:
- operador decide o plano do dia em menos de 5 minutos.

## Prioridade 2 (agora)

### Refino final de Pedidos como agenda do dia

- Continuar reduzindo densidade visual e scroll na visao `Dia`.
- Extrair blocos grandes restantes de `orders-screen` para componentes menores.
- Garantir consistencia total de clique inteiro em cards, listas e acoes.
- Validar estados vazios, sem agendamento e mudanca de dia em desktop e mobile width.

Criterio de pronto:
- operador navega o dia, cria pedido e atualiza status sem friccao nem ambiguidades.

## Prioridade 3 (agora)

### Robustez do nucleo e cobertura

- Manter o app sem dependencias externas enquanto a operacao principal ainda estiver estabilizando.
- Eliminar residuos legados de configuracao, docs e expectativas de integracao antiga.
- Aumentar testes de dominio em pedidos, pagamentos, estoque, producao e entrega local.
- Ampliar a cobertura de navegador alem do smoke e do E2E critico.

Criterio de pronto:
- regressao reduzida, ambiente de teste previsivel e reintegracao futura feita com base limpa.

## Ordem de execucao

1. UX de estoque.
2. Refino final de pedidos.
3. Hardening extra do nucleo e dos testes.

## Riscos de nao fazer

- Interface continua exigindo interacoes demais em tarefas recorrentes.
- Mudancas de backend ou uma reintegracao futura podem quebrar fluxo sem cobertura suficiente.
- Defasagem documental pode reintroduzir incerteza operacional entre sessoes.
