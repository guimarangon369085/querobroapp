# NEXT_STEP_PLAN

Ultima atualizacao: 2026-02-20

## Objetivo da fase atual

Entregar UX extremamente simples para operacao diaria, mantendo toda regra complexa no backend.

## Prioridade 1 (agora)

### UX operacional em Estoque (foco do dia)

- Hierarquia por jornada real: planejar -> comprar -> produzir -> conferir.
- Painel do dia com fila, broas alvo, fornadas e hora de inicio sugerida.
- Lista rapida de compras por faltas D+1 (ingrediente/embalagem).
- Validacao com uso real da Gabi (desktop e mobile width).

Criterio de pronto:
- operador decide o plano do dia em menos de 5 minutos.

## Prioridade 2 (agora)

### UX wave 2 em Pedidos

- Auto sugestao de cliente/produto com menos toques.
- Acoes de status ainda mais diretas.
- Reducao de campos visiveis para o minimo necessario.

Criterio de pronto:
- operador cria pedido completo sem treinamento tecnico.

## Prioridade 3 (agora)

### Validacao real de usabilidade

- Rodar validacao em navegador real (desktop e mobile width).
- Mapear friccao por tarefa: criar produto, cliente, pedido, pagamento e checar D+1.
- Corrigir pontos bloqueadores no mesmo ciclo.
- Ao fim de cada rodada, aplicar `docs/TEST_RESET_PROTOCOL.md` para limpar clientes/pedidos de teste.

Criterio de pronto:
- zero bloqueador no fluxo principal.

## Prioridade 4 (proxima)

### Robustez de dominio

- Aumentar testes de pedido + pagamento + estoque.
- Revisar pontos finais de drift Prisma dev/prod.
- Preparar provider de WhatsApp sobre outbox existente.

Criterio de pronto:
- regressao reduzida e trilha de deploy mais previsivel.

## Ordem de execucao

1. UX operacional de estoque + validacao em campo.
2. UX wave 2 (pedidos).
3. Validacao Playwright + ajustes rapidos.
4. Testes de dominio + melhorias de dados.

## Riscos de nao fazer

- Interface continua exigindo muitas interacoes.
- Cresce retrabalho operacional com aumento de volume.
- Mudancas de backend podem quebrar fluxo sem testes suficientes.
