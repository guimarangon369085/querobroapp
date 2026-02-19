# NEXT_STEP_PLAN

Ultima atualizacao: 2026-02-19

## Objetivo da fase atual

Entregar UX extremamente simples para operacao diaria, mantendo toda regra complexa no backend.

## Prioridade 1 (agora)

### UX wave 2 em Pedidos

- Auto sugestao de cliente/produto com menos toques.
- Acoes de status ainda mais diretas.
- Reducao de campos visiveis para o minimo necessario.

Criterio de pronto:
- operador cria pedido completo sem treinamento tecnico.

## Prioridade 2 (agora)

### Validacao real de usabilidade

- Rodar validacao em navegador real (desktop e mobile width).
- Mapear friccao por tarefa: criar produto, cliente, pedido, pagamento e checar D+1.
- Corrigir pontos bloqueadores no mesmo ciclo.

Criterio de pronto:
- zero bloqueador no fluxo principal.

## Prioridade 3 (proxima)

### Robustez de dominio

- Aumentar testes de pedido + pagamento + estoque.
- Revisar pontos finais de drift Prisma dev/prod.
- Preparar provider de WhatsApp sobre outbox existente.

Criterio de pronto:
- regressao reduzida e trilha de deploy mais previsivel.

## Ordem de execucao

1. UX wave 2 (pedidos).
2. Validacao Playwright + ajustes rapidos.
3. Testes de dominio + melhorias de dados.

## Riscos de nao fazer

- Interface continua exigindo muitas interacoes.
- Cresce retrabalho operacional com aumento de volume.
- Mudancas de backend podem quebrar fluxo sem testes suficientes.

