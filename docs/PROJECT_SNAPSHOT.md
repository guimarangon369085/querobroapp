# PROJECT_SNAPSHOT

Ultima atualizacao: 2026-02-28

## Estado atual

- Monorepo ativo com API, Web, Mobile e contratos compartilhados.
- Web operacional com foco em simplicidade de uso (fluxo guiado por passos).
- Web agora com casca principal redesenhada como `Broa do Dia`, orientada por jornada: `Hoje`, `Producao`, `Saidas`, `Caixa`, `Base`.
- A reestruturacao de `Pedidos` foi iniciada: a rota agora e uma casca fina e a implementacao passou para `apps/web/src/features/orders/`, abrindo caminho para dividir a tela por blocos sem quebrar a operacao.
- API com regras de pedido, pagamento, estoque, BOM, D+1 e runtime-config read-only para receipts/layout, sem o modulo legado de Builder no backend.
- Pipeline de seguranca e qualidade ativo (lint, drift, secret scan, policy gate).

## O que um usuario consegue fazer hoje

1. Abrir a operacao do dia em `Hoje`.
2. Navegar por `Producao`, `Saidas`, `Caixa` e `Base` com leitura operacional simples.
3. Criar pedido com itens e desconto.
4. Atualizar status do pedido.
5. Registrar pagamento parcial/total.
6. Conferir saldo e quadro D+1 no estoque.
7. Processar cupom via endpoint de receipts.
8. Validar readiness de entrega Uber Direct no detalhe do pedido.
9. Consultar cotacao Uber Direct no detalhe do pedido quando a configuracao estiver pronta.

## Telas web

- `/hoje`: tela central da operacao.
- `/producao`: casca simples para planejar e produzir.
- `/saidas`: casca simples para separar e entregar.
- `/caixa`: casca simples para receber e fechar.
- `/base`: casca simples para clientes e broas.
- `/produtos`: detalhe legado de cadastro.
- `/clientes`: detalhe legado de cadastro.
- `/pedidos`: detalhe legado de compromissos, pagamentos e Uber.
- `/estoque`: detalhe legado de BOM, movimentos, saldo e D+1.
- `/builder`: redirecionado para `/pedidos`; runtime interno principal exposto em `GET /runtime-config` (com alias legado em `GET /builder/config`).

## API (blocos)

- Cadastro: `products`, `customers`
- Operacao: `orders`, `payments`, `deliveries`
- Estoque: `inventory`, `stock`, `bom`, `production`
- Automacao: `receipts`, `whatsapp/outbox`

## Qualidade tecnica

- `pnpm lint`: OK
- `pnpm test`: OK (inclui drift test)
- `pnpm --filter @querobroapp/web typecheck`: OK

## Gaps abertos

1. Mais testes de dominio (pedido/financeiro/estoque).
2. Unificacao final de estrategia dev/prod no Prisma.
3. Provider real de WhatsApp (hoje existe apenas outbox).
4. Paridade mobile com web (estoque e D+1 ainda incompletos).

## Arquivos chave

- API entrypoint: `apps/api/src/main.ts`
- API modules: `apps/api/src/modules`
- Schema: `apps/api/prisma/schema.prisma`
- Web pages: `apps/web/src/app`
- Shared schemas: `packages/shared/src/index.ts`
