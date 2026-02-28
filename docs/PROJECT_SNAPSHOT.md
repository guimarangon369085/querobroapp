# PROJECT_SNAPSHOT

Ultima atualizacao: 2026-02-28

## Estado atual

- Monorepo ativo com API, Web, Mobile e contratos compartilhados.
- Web agora e `calendar-first`, com as 5 telas mandatórias: `Calendario`, `Pedidos`, `Clientes`, `Produtos`, `Estoque`.
- `Pedidos` e `Calendario` compartilham a mesma base de dados, mas a navegacao e o foco visual ja foram realinhados para o modelo novo.
- A maior parte dos blocos decorativos, tutoriais e quickflows foi removida das telas principais.
- API com regras de pedido, pagamento, estoque, BOM, D+1, WhatsApp Flow local, forno/fila de producao e entrega com tracking persistente.
- Pipeline de seguranca e qualidade ativo (lint, drift, secret scan, policy gate).

## O que um usuario consegue fazer hoje

1. Abrir o app direto em `Calendario`.
2. Navegar por `Pedidos`, `Clientes`, `Produtos` e `Estoque`.
3. Criar pedido manualmente no web.
4. Criar pedido via WhatsApp Flow local (`launch -> session -> submit`), gerando cliente e pedido reais.
5. Confirmar pedido e colocar ele na fila real de producao.
6. Iniciar a proxima fornada (1 forno, 14 broas por vez), com baixa real de estoque no momento em que a fornada comeca.
7. Concluir a fornada e deixar o pedido `PRONTO`.
8. Disparar entrega com tracking persistente; sem credenciais Uber, o app cai em simulacao local rastreavel e continua funcional.
9. Marcar entrega concluida e deixar o pedido em `ENTREGUE`, aguardando apenas pagamento.
10. Registrar pagamento parcial/total.

## Telas web

- `/calendario`: entrada principal e base de leitura do dia/semana/mes.
- `/pedidos`: execucao do pedido, WhatsApp Flow, producao, entrega e pagamento.
- `/clientes`: cadastro minimo e historico curto.
- `/produtos`: catalogo minimo.
- `/estoque`: saldo, D+1, compras e ficha tecnica simplificada.
- Rotas antigas (`/hoje`, `/producao`, `/saidas`, `/caixa`, `/base`) redirecionam para as 5 telas reais.
- `/builder`: redirecionado para `/calendario`; runtime interno principal exposto em `GET /runtime-config` (com alias legado em `GET /builder/config`).

## API (blocos)

- Cadastro: `products`, `customers`
- Operacao: `orders`, `payments`, `deliveries`, `production`
- Estoque: `inventory`, `stock`, `bom`, `production`
- Automacao: `receipts`, `whatsapp/outbox`, `alexa`

## Qualidade tecnica

- `pnpm --filter @querobroapp/api typecheck`: OK
- `pnpm --filter @querobroapp/web typecheck`: OK

## Gaps abertos

1. Despacho real da Meta WhatsApp Cloud API ainda nao esta ligado; o Flow local ja funciona, mas o envio automatico do convite ainda depende do dispatcher do outbox + credenciais.
2. Uber live dispatch/tracking depende de preencher `UBER_DIRECT_*`; sem credenciais, o fallback local de simulacao continua ativo e funcional.
3. Ainda existe historico legado de movimentos antigos no banco; a normalizacao por compensacao foi aplicada para pedidos em aberto, mas o historico anterior foi preservado.
4. Mobile segue atras do web no fluxo novo.

## Arquivos chave

- API entrypoint: `apps/api/src/main.ts`
- API modules: `apps/api/src/modules`
- Schema: `apps/api/prisma/schema.prisma`
- Web pages: `apps/web/src/app`
- Shared schemas: `packages/shared/src/index.ts`
