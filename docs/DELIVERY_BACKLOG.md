# DELIVERY_BACKLOG

## TOC
- [1. Premissas](#1-premissas)
- [2. MVP (Lancar)](#2-mvp-lancar)
- [3. Pos-MVP](#3-pos-mvp)
- [4. Nice-to-have](#4-nice-to-have)

## 1. Premissas

- Backlog organizado em blocos LEGO: **Dados -> Catalogo -> Pedido -> Itens -> Calculo -> Estados -> Producao D+1 -> Financeiro -> WhatsApp**.
- Estimativa relativa:
  - `S`: ate 1 dia util
  - `M`: 2 a 4 dias uteis
  - `L`: 5+ dias uteis
- Arquivos provaveis sao pontos de partida (nao lista exaustiva).

## 2. MVP (Lancar)

| Bloco | Item | Descricao | Criterios de aceite | Arquivos provaveis | Estimativa |
| --- | --- | --- | --- | --- | --- |
| Dados | Unificar schema Prisma dev/prod | Eliminar drift entre SQLite e Postgres para deploy seguro | `schema.prisma` e `schema.prod.prisma` equivalentes no dominio core; migracao Postgres validada em ambiente local | [`apps/api/prisma/schema.prisma`](../apps/api/prisma/schema.prisma), [`apps/api/prisma/schema.prod.prisma`](../apps/api/prisma/schema.prod.prisma), [`apps/api/prisma/migrations`](../apps/api/prisma/migrations) | L |
| Dados | Revalidar pipeline de migracao | Garantir `prisma:migrate:prod` executavel sem lock sqlite | comando de migrate prod executa sem erro; documentacao atualizada | [`apps/api/package.json`](../apps/api/package.json), [`README.md`](../README.md) | M |
| Catalogo | SKU canonico em Produto | Adicionar campo SKU unico para operacao e integracoes | produto exige `sku`; nao permite duplicado; CRUD web suporta campo | Prisma schema, [`packages/shared/src/index.ts`](../packages/shared/src/index.ts), [`apps/web/src/app/produtos/page.tsx`](../apps/web/src/app/produtos/page.tsx), API products module | M |
| Pedido | Criacao robusta de pedido | Blindar create order para payload invalido e itens inconsistentes | pedido so cria com cliente existente e itens validos; respostas de erro padronizadas | [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts), [`apps/api/src/modules/orders/orders.controller.ts`](../apps/api/src/modules/orders/orders.controller.ts) | M |
| Itens | Regra de mutacao por status | Impedir adicionar/remover item em status nao permitido | testes cobrindo bloqueio em `CANCELADO` e `ENTREGUE`; mensagens consistentes | [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts), [`apps/web/src/app/pedidos/page.tsx`](../apps/web/src/app/pedidos/page.tsx) | S |
| Calculo | Total do pedido server-side | Recalcular subtotal/total sempre no backend | `PUT /orders/:id` nao aceita total manual; total reflete itens e desconto | [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts) | M |
| Estados | Maquina de status testada | Consolidar transicoes e efeitos colaterais (estoque) | transicoes invalidas retornam 400; cancelamento estorna inventario uma unica vez | [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts), testes API | M |
| Producao D+1 | Relatorio de necessidade de insumo | Gerar necessidade por dia com base em pedidos abertos + BOM | endpoint retorna demanda por item para D+1; tela web exibe lista | novo endpoint em inventory/bom/orders + [`apps/web/src/app/estoque/page.tsx`](../apps/web/src/app/estoque/page.tsx) | M |
| Financeiro | Conciliacao de pagamentos | Regras para soma paga vs total do pedido | pagamento nao pode exceder saldo; status financeiro derivado visivel | [`apps/api/src/modules/payments/payments.service.ts`](../apps/api/src/modules/payments/payments.service.ts), [`apps/api/src/modules/orders/orders.service.ts`](../apps/api/src/modules/orders/orders.service.ts), [`apps/web/src/app/pedidos/page.tsx`](../apps/web/src/app/pedidos/page.tsx) | M |
| WhatsApp | Fundacao de mensagens (roadmap) | Estruturar outbox para envios futuros sem bloquear MVP | tabela/evento de outbox criada; registro de evento ao mudar status de pedido | Prisma schema + novo modulo API de eventos | M |

## 3. Pos-MVP

| Bloco | Item | Descricao | Criterios de aceite | Arquivos provaveis | Estimativa |
| --- | --- | --- | --- | --- | --- |
| Dados | Auditoria de alteracoes | Rastro de mudancas criticas (pedido/pagamento/estoque) | trilha de auditoria por entidade critica com `who/when/what` | schema + services API | M |
| Catalogo | Versao de preco | Historico de preco por periodo | pedido novo usa preco vigente; historico consultavel | Product/Order services + schema | M |
| Pedido | Filtros e busca server-side | Evitar fetch total em listas grandes | endpoint suporta pagina e filtros por status/data/cliente | Orders controller/service + web pedidos | M |
| Itens | Reserva de estoque de insumo | Reservar disponibilidade ao confirmar pedido | confirmar pedido cria reserva; cancelar libera | inventory/orders services + schema | L |
| Calculo | Custo e margem por pedido | Calcular margem real por BOM/custo unitario | pedido mostra custo estimado e margem | inventory/bom/orders services + web dashboard/pedidos | M |
| Estados | SLA e timestamp por etapa | Medir lead time operacional | timestamps por status salvos e exibidos | orders schema/service + web pedidos/dashboard | M |
| Producao D+1 | Planejamento semanal | Expandir D+1 para horizonte semanal | endpoint com horizonte 7 dias e agrupamento por item/produto | API estoque/producao + web estoque | M |
| Financeiro | Integrador de pagamento real | Adapter provider (PIX/cartao) e `providerRef` confiavel | webhook de confirmacao atualiza pagamento e pedido | payments module + webhook routes + env example | L |
| WhatsApp | Envio transacional de status | Mensagens automaticas de confirmacao/saida para entrega | ao transicionar status gera envio e persiste log de entrega | novo `modules/whatsapp`, queue/outbox, web settings | L |

## 4. Nice-to-have

| Bloco | Item | Descricao | Criterios de aceite | Arquivos provaveis | Estimativa |
| --- | --- | --- | --- | --- | --- |
| Dados | Multi-tenant basico | Isolar dados por operacao/unidade | todas queries criticas filtram por tenant | schema + middleware + services | L |
| Catalogo | Bundle/kit de produtos | Compor venda por kits | kit cadastrado e vendido com composicao automatica | product/order/bom layers | M |
| Pedido | Duplicar pedido | Repetir pedido recorrente em 1 clique | clone preserva itens/cliente/notes sem status antigo | web pedidos + orders service | S |
| Itens | Edicao em lote | Alterar quantidades de varios itens por vez | endpoint batch e UI de ajuste em massa | orders service/controller + web pedidos | M |
| Calculo | Simulador de desconto | Simular impacto de desconto antes de gravar | UI mostra total e margem projetados em tempo real | web pedidos + endpoint de simulacao | S |
| Estados | Automacoes por regra | Regras autom. por horario/status/pagamento | regras configuraveis e auditaveis | orders module + scheduler | L |
| Producao D+1 | Sugestao de compra | Sugerir reposicao com base no plano | lista de compras sugerida por fornecedor/item | inventory module + web estoque | M |
| Financeiro | DRE simplificada | Consolidado diario/semanal/mensal | dashboard financeiro com receita x custo x margem | API agregador + web dashboard | M |
| WhatsApp | Conversa bidirecional | Receber resposta do cliente e registrar no pedido | inbound webhook cria evento/comentario do pedido | whatsapp module + order comments | L |
