# QUEROBROApp - Consumer Flow Rearchitecture

## Objetivo
- Fluxo unico, navegavel do inicio ao fim.
- Uma decisao por vez.
- Zero tela solta.
- Zero texto de preenchimento.
- Complexidade no backend, simplicidade no frontend.

## Principios de UX (benchmark-driven)
- CTA unico por estado (Duolingo-style).
- Progresso persistente e sempre visivel.
- Etapas bloqueadas ate pre-condicao real.
- Feedback instantaneo em pop-up no mesmo contexto.
- Nao abrir janelas paralelas para explicar estado.

## Fluxo Canonico (state machine)
1. `catalog`: produto + ficha tecnica
2. `customer`: cadastro do cliente
3. `order`: pedido criado
4. `confirm`: pedido confirmado
5. `prepare`: producao/preparo
6. `deliver`: entrega concluida
7. `pay`: pagamento encerrado

Transicoes:
- `catalog -> customer -> order -> confirm -> prepare -> deliver -> pay`
- Etapa futura so libera quando etapa anterior conclui.
- Status de pedido e pagamento sao fonte de verdade para as transicoes.

## Hierarquia de Decisao
1. `FlowDock` (global): mostra etapa atual + CTA principal.
2. `Topbar` (pagina): acao curta de navegacao.
3. `Jornada` (mapa): escolha de etapa via no.
4. `Balloon pop-up`: acao da etapa sem abrir nova janela.
5. `Pagina operacional`: formulario/lista para executar a tarefa.

## Arquitetura Implementada
- `apps/web/src/lib/operation-flow.ts`
  - Derivacao unica do fluxo com fallback offline.
  - Estado da etapa: `done | current | locked`.
  - Metricas operacionais: pedidos, clientes, saldo pendente.
- `apps/web/src/hooks/use-operation-flow.ts`
  - Fetch central de `products/customers/orders/payments/boms`.
  - Revalidacao e resiliencia offline.
- `apps/web/src/components/flow-dock.tsx`
  - Barra persistente do fluxo no layout.
  - CTA primario da etapa atual.
- `apps/web/src/app/jornada/page.tsx`
  - Mapa visual de progresso com pop-up contextual.
  - Etapas bloqueadas com regra de pre-condicao real.

## Wireframe Estrutural
### Desktop
```text
+---------------- Sidebar ----------------+ +--------------- Main ----------------------+
| Inicio                                  | | Topbar (titulo curto + 2 acoes)           |
| Jornada                                 | +-------------------------------------------+
| Pedidos                                 | | FlowDock (etapa atual + progresso + CTA)  |
| Clientes                                | +-------------------------------------------+
| Produtos                                | | Conteudo da pagina atual                  |
| Estoque                                 | | - Jornada: mapa vertical + balloon popup  |
| Resumo                                  | | - Pedidos/Clientes/etc: execucao da etapa |
+-----------------------------------------+ +-------------------------------------------+
```

### Mobile
```text
Topbar
FlowDock
Conteudo principal
Sidebar vira lista empilhada
```

## Regra de Conteudo
- Nao usar textos longos em cards.
- Nao usar imagem decorativa aleatoria.
- Mostrar apenas:
  - pergunta da etapa
  - status
  - acao

## Proximas Entregas Tecnicas
1. Unificar cache de `use-operation-flow` por contexto global para evitar fetch duplicado entre paginas.
2. Adicionar testes E2E da jornada completa (catalogo -> pagamento).
3. Adicionar scoring de usabilidade: cliques por tarefa e tempo por tarefa.
