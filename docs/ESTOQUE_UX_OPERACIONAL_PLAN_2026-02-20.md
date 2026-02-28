# ESTOQUE_UX_OPERACIONAL_PLAN_2026-02-20

## Contexto real da QUEROBROA

- Operacao artesanal de pequena escala (ate ~20 pedidos/dia).
- Producao sob demanda, com antecedencia minima de 1 dia.
- Restricao forte de capacidade: 14 broas por fornada e ciclo de forno de 50 minutos (35 + 15).
- Compras mistas: supermercado local e internet, com lead time variavel.
- Entrega via Uber Entregas manual (com cancelamentos e atrasos recorrentes).
- Pagamento atual: PIX.

## Objetivo de UX operacional

Chegar em uma interface de baixa carga cognitiva, com fluxo de decisao em 1 trilho:

1. Planejar o dia (fila + capacidade)
2. Comprar faltas (lista pronta)
3. Produzir por ritmo (fornadas + timer)
4. Expedir e fechar (entrega + pagamento)

## Principios de projeto (pesquisa aplicada)

1. Sistema puxado (pull): produzir a partir da demanda real para reduzir excesso e retrabalho.
- Fonte: https://www.lean.org/lexicon-terms/what-is-a-pull-system/

2. Nivelamento de carga (heijunka): distribuir trabalho no tempo para evitar picos e gargalo no forno.
- Fonte: https://www.lean.org/lexicon-terms/heijunka/

3. Trabalho padrao (standard work): sequencia fixa, clara e repetivel, reduzindo erro operacional.
- Fonte: https://www.lean.org/lexicon-terms/standard-work/

4. Politica de reposicao com incerteza: usar estoque de seguranca e ponto de reposicao por item critico (demanda + lead time).
- Fonte (modelos de reposicao/safety stock):
  - https://ocw.mit.edu/courses/15-064j-inventory-theory-spring-2003/97f6f0a6f6e18f08867ab741cb0f31ec_lec5.pdf
  - https://ocw.mit.edu/courses/15-501-516-accounting-spring-2004/resources/invent_lec_note/

5. Pereciveis: rotacao rigorosa (data/validade e controle de frio) para evitar perda e risco.
- Fonte:
  - https://www.fda.gov/food/retail-food-protection/fda-food-code
  - https://www.cdc.gov/food-safety/php/prevention/separate-and-chill.html

6. Entrega com janela de tempo: planejar com buffer para incerteza de despacho/coleta.
- Fonte (time windows como restricao operacional): https://developers.google.com/optimization/routing/vrptw

## Modelo operacional recomendado para a QUEROBROA

### 1) Planejamento diario (D+1 como coluna mestra)

- Abrir o painel e responder 3 perguntas:
  - Quantos pedidos entram na fila do dia alvo?
  - Quantas broas isso representa?
  - Quantas fornadas e quanto tempo de forno isso exige?
- Saida esperada: hora de inicio sugerida e carga total do forno.

### 2) Lista de compras automatica por criticidade

- Gerar lista automaticamente a partir de faltas D+1.
- Ordenar por:
  1. Ingrediente critico de receita
  2. Embalagem interna
  3. Embalagem externa
- Cada linha deve mostrar: falta, disponivel, necessario e unidade.

### 3) Producao em ritmo de celula

- Unidade de controle: fornada (14 broas).
- Ciclo padrao: 50min/fornada.
- Operacao em botoes simples:
  - Iniciar fornada
  - Virar/retomar timer
  - Finalizar fornada
  - Liberar para resfriamento/embalagem

### 4) Expedicao com janela e buffer

- Registrar janela prometida da cliente (ex.: ate 15h).
- Calcular buffer de despacho (cancelamento/atraso de Uber).
- Sugerir hora limite de chamada Uber por pedido.

### 5) Fechamento financeiro

- Ultimo passo do fluxo: confirmar entrega e registrar PIX.
- Indicador unico de fechamento: pedido entregue + pago.

## Politica de estoque proposta (simples e robusta)

Para cada insumo critico:

- `Consumo medio diario` (historico por dia da semana).
- `Lead time medio` (dias ate reposicao).
- `Estoque de seguranca` (variacao de demanda e atraso de compra).
- `Ponto de reposicao` = consumo no lead time + estoque de seguranca.

Regras praticas:

- Item critico abaixo do ponto de reposicao -> alerta de compra imediata.
- Item perecivel proximo do limite -> alerta de prioridade de uso.
- Sem BOM valida -> alerta bloqueador (nao planejar sem ficha).

## Etapas executadas hoje

1. Reestruturacao de UX da tela `/estoque` para hierarquia operacional.
- Novo topo orientado a jornada:
  - Fila D+1
  - Broas alvo
  - Fornadas
  - Faltas D+1
  - Capacidade total
- Novo bloco `Painel do dia` com:
  - Ritmo de fornadas (14 por ciclo)
  - Hora limite de entrega
  - Inicio sugerido
  - Lista rapida de compras por categoria

2. Quadro D+1 enriquecido com resumo de faltas por tipo.

3. Ordem de layout default atualizada para separar operacao diaria de base tecnica.

## Proximas fases (execucao completa)

### Fase 1 - Hoje/amanha

- Consolidar o fluxo novo com dados reais de pedidos.
- Ajustar microcopy de botoes com linguagem de operacao.
- Validar com Gabi (desktop + mobile width) e mapear atritos.

### Fase 2 - 1 semana

- Adicionar estado de producao por fornada (fila, em forno, resfriando, pronto para embalar).
- Integrar timers operacionais na jornada (inicio/virada/fim).
- Introduzir alerta de atraso para janela de entrega.

### Fase 3 - 2 a 3 semanas

- Incluir data/hora prometida no dominio de pedido (fonte de verdade de planejamento).
- Implementar politicas de reposicao por item (ponto de reposicao + seguranca).
- Introduzir semaforo de pereciveis (urgente/atencao/ok).

## Criterios de sucesso

- Operador leigo conclui planejamento diario sem treinamento tecnico.
- Tempo para decidir compras do dia < 5 minutos.
- Reducao de faltas surpresa durante producao.
- Menos cancelamento/atraso percebido pela cliente no horario prometido.
- Fechamento de pedido (entrega + PIX) sem retrabalho.
