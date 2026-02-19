# PROJECT_SNAPSHOT

Ultima atualizacao: 2026-02-19

## Estado atual

- Monorepo ativo com API, Web, Mobile e contratos compartilhados.
- Web operacional com foco em simplicidade de uso (fluxo guiado por passos).
- API com regras de pedido, pagamento, estoque, BOM, D+1 e builder.
- Pipeline de seguranca e qualidade ativo (lint, drift, secret scan, policy gate).

## O que um usuario consegue fazer hoje

1. Cadastrar produto e cliente.
2. Criar pedido com itens e desconto.
3. Atualizar status do pedido.
4. Registrar pagamento parcial/total.
5. Conferir saldo e quadro D+1 no estoque.
6. Processar cupom via endpoint de receipts.

## Telas web

- `/dashboard`: resumo da operacao.
- `/produtos`: cadastro e lista de produtos.
- `/clientes`: cadastro de clientes (campos avancados opcionais).
- `/pedidos`: criacao, acompanhamento, pagamentos.
- `/estoque`: BOM, movimentos, saldo e D+1.
- `/builder`: customizacao da interface e regras.

## API (blocos)

- Cadastro: `products`, `customers`
- Operacao: `orders`, `payments`
- Estoque: `inventory`, `stock`, `bom`, `production`
- Automacao: `receipts`, `builder`, `whatsapp/outbox`

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

