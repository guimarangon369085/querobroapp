# ARCHITECTURE

## Visao simples

```text
Web (Next.js)  ----\
                  ---> API (NestJS) ---> Prisma ---> Banco
Mobile (Expo) ---/

Builder (config) --------> API/arquivo local
Shared contracts (Zod) --> Web + API + Mobile
```

## Camadas

- Interface: `apps/web` e `apps/mobile`.
- Regras de negocio: `apps/api/src/modules`.
- Contratos de entrada/saida: `packages/shared/src/index.ts`.
- Persistencia: `apps/api/prisma/schema.prisma`.

## Modulos da API

- `products`, `customers`, `orders`, `payments`
- `inventory`, `stock`, `bom`, `production`
- `receipts`, `builder`, `whatsapp`

Arquivo de composicao:
- `apps/api/src/app.module.ts`

## Fluxos principais

### 1) Pedido e financeiro

1. Web cria pedido com cliente + itens.
2. API calcula subtotal, desconto e total.
3. API aplica consumo de estoque por BOM.
4. Pagamentos atualizam `amountPaid`, `balanceDue`, `paymentStatus`.

### 2) D+1 (producao)

1. API le pedidos e BOM.
2. Calcula necessidade por insumo para data alvo.
3. Compara necessidade com saldo de inventario.
4. Web mostra falta por item no quadro D+1.

### 3) Cupom para estoque

1. iOS envia imagem para `/receipts/ingest`.
2. API extrai itens e aplica regras do Builder.
3. API grava movimentos de entrada no inventario.
4. Web mostra entradas automaticas.

## Decisoes tecnicas importantes

- Em dev, banco padrao e SQLite.
- Em producao, usar Postgres (`schema.prod.prisma`).
- Auth em producao e obrigatoria por padrao.
- Throttling e helmet ja ativos na API.

## Riscos atuais

- Drift entre schema dev e prod ainda precisa monitoramento continuo.
- Cobertura de testes de negocio ainda e parcial.
- Envio real de WhatsApp ainda nao esta implementado (somente outbox).

