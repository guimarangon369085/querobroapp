# NEXT_STEP_PLAN

Ultima atualizacao: 2026-03-03

## Objetivo da fase atual

Permitir reboot e validacao manual sem ambiguidade, mantendo `Pedidos` como agenda unica do dia e consolidando o fluxo operacional real.

## Prioridade 1 (agora)

### Rodada manual apos reboot

- Reiniciar a maquina e subir o ambiente com `./scripts/dev-all.sh`.
- Validar `Pedidos`, `Clientes`, `Produtos` e `Estoque` no navegador.
- Confirmar que o browser abre em `http://127.0.0.1:3000/pedidos`.
- Confirmar health da API e ausencia de erro de CORS ou bundle stale.
- Registrar qualquer friccao real encontrada e corrigir no mesmo ciclo.

Criterio de pronto:
- o usuario consegue religar a maquina e testar sozinho sem depender de ajuste manual escondido.

## Prioridade 2 (agora)

### UX operacional em Estoque

- Hierarquia por jornada real: `planejar -> comprar -> produzir -> conferir`.
- Painel do dia com fila, broas alvo, fornadas e hora de inicio sugerida.
- Lista rapida de compras por faltas D+1.
- Validacao em desktop e mobile width com uso real.

Criterio de pronto:
- operador decide o plano do dia em menos de 5 minutos.

## Prioridade 3 (agora)

### Refino final de Pedidos como agenda do dia

- Continuar reduzindo densidade visual e scroll na visao `Dia`.
- Extrair blocos grandes restantes de `orders-screen` para componentes menores.
- Garantir consistencia total de clique inteiro em cards, listas e acoes.
- Validar estados vazios, sem agendamento e mudanca de dia em desktop e mobile width.

Criterio de pronto:
- operador navega o dia, cria pedido e atualiza status sem friccao nem ambiguidades.

## Prioridade 4 (proxima)

### Robustez do nucleo e cobertura

- Manter o app sem dependencias externas enquanto a operacao principal ainda estiver estabilizando.
- Eliminar residuos legados de configuracao, docs e expectativas de integracao antiga.
- Aumentar testes de dominio em pedidos, pagamentos, estoque, producao e entrega local.
- Ampliar a cobertura de navegador alem do smoke e do E2E critico.

Criterio de pronto:
- regressao reduzida, ambiente de teste previsivel e reintegracao futura feita com base limpa.

## Ordem de execucao

1. Reboot real + validacao manual.
2. UX de estoque.
3. Refino final de pedidos.
4. Hardening extra do nucleo e dos testes.

## Riscos de nao fazer

- O ambiente pode parecer instavel mesmo quando o codigo esta correto.
- Interface continua exigindo interacoes demais em tarefas recorrentes.
- Mudancas de backend ou uma reintegracao futura podem quebrar fluxo sem cobertura suficiente.
