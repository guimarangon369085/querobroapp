# MVP_FINANCEIRO_E_D+1

## TOC
- [1. Escopo Entregue](#1-escopo-entregue)
- [2. Endpoints Novos E Alterados](#2-endpoints-novos-e-alterados)
- [3. Como Operar (Web)](#3-como-operar-web)
- [4. Validacao Manual Em 5 Minutos](#4-validacao-manual-em-5-minutos)
- [5. Dados Reais (PDF/XLSX) E Mapeamento De Dominio](#5-dados-reais-pdfxlsx-e-mapeamento-de-dominio)
- [6. Troubleshooting](#6-troubleshooting)
- [7. Riscos E Pendencias](#7-riscos-e-pendencias)

## 1. Escopo Entregue

Implementacoes desta etapa MVP:
- Financeiro minimo:
  - bloqueio de sobrepagamento no backend
  - `amountPaid`, `balanceDue`, `paymentStatus` derivado no retorno de pedidos
  - tela `/pedidos` com registro de pagamento por `valor + metodo + data`
- Quadro D+1:
  - endpoint de necessidade por insumo para data alvo (`default = amanha`)
  - calculo por pedidos + itens + BOM + saldo de estoque por movimentacoes
  - tela `/estoque` com quadro D+1 (necessario/disponivel/falta + resumo por produto)
- Fundacao WhatsApp (sem provider):
  - tabela de outbox
  - evento de outbox em mudanca de status de pedido (`CONFIRMADO`, `PRONTO`, `ENTREGUE`)
  - endpoint interno para listar pendencias (`/whatsapp/outbox`)

## 2. Endpoints Novos E Alterados

### 2.1 Alterados

- `POST /payments`
  - agora valida conciliacao: soma de pagamentos pagos nao pode exceder `order.total`
  - erro em excesso: HTTP `400 Bad Request`

- `PATCH /payments/:id/mark-paid`
  - valida conciliacao antes de marcar como pago

- `GET /orders` e `GET /orders/:id`
  - agora retornam campos derivados:
    - `amountPaid`
    - `balanceDue`
    - `paymentStatus` (`PENDENTE` | `PARCIAL` | `PAGO`)

- `PATCH /orders/:id/status`
  - alem da mudanca de status, cria item de outbox para WhatsApp nos status definidos

### 2.2 Novos

- `GET /production/requirements?date=YYYY-MM-DD`
  - retorna necessidades D+1 por insumo
  - formato:

```json
{
  "date": "2026-02-11",
  "basis": "createdAtPlus1",
  "rows": [
    {
      "ingredientId": 14,
      "name": "Insumo D1",
      "unit": "g",
      "requiredQty": 400,
      "availableQty": 100,
      "shortageQty": 300,
      "breakdown": [
        {
          "productId": 20,
          "productName": "Produto D1",
          "orderId": 6,
          "orderItemId": 8,
          "quantity": 400
        }
      ]
    }
  ],
  "warnings": []
}
```

- `GET /whatsapp/outbox?status=PENDING`
  - lista pendencias da fundacao WhatsApp

```json
[
  {
    "id": 1,
    "messageId": "uuid",
    "channel": "whatsapp",
    "to": "11999999999",
    "template": "order_status_changed",
    "payload": {
      "event": "ORDER_STATUS_CHANGED",
      "orderId": 6,
      "status": "CONFIRMADO"
    },
    "status": "PENDING",
    "orderId": 6,
    "createdAt": "2026-02-10T22:14:34.627Z",
    "sentAt": null
  }
]
```

## 3. Como Operar (Web)

### 3.1 Pedidos e financeiro

Em `/pedidos`:
- criar pedido normalmente
- selecionar pedido na lista
- ver cards financeiros:
  - `Total`
  - `Pago`
  - `Saldo`
  - `Financeiro`
- no bloco de pagamentos:
  - preencher `Valor`
  - selecionar `Metodo`
  - informar `Data do pagamento`
  - clicar `Registrar pagamento`

Regras esperadas:
- pagamento parcial muda status para `PARCIAL`
- pagamento exato quita pedido (`PAGO`)
- valor acima do saldo gera erro legivel

### 3.2 Estoque D+1

Em `/estoque`:
- usar secao `Quadro D+1 (producao e compras)`
- selecionar data
- clicar `Recalcular`
- ler tabela:
  - `Insumo`
  - `Unidade`
  - `Necessario`
  - `Disponivel`
  - `Falta`
  - `Por produto`
- caso BOM incompleta/ausente, verificar bloco `Alertas de BOM`

## 4. Validacao Manual Em 5 Minutos

### 4.1 Subir stack

```bash
cd $HOME/querobroapp
./scripts/dev-all.sh
```

Se o ambiente bloquear `tsx watch` (erro `EPERM`), usar fallback:

```bash
pnpm --filter @querobroapp/api start:tsx
pnpm --filter @querobroapp/web dev
```

### 4.2 Smoke rapido

```bash
curl -s http://127.0.0.1:3001/health
curl -s "http://127.0.0.1:3001/production/requirements?date=YYYY-MM-DD"
curl -s "http://127.0.0.1:3001/whatsapp/outbox?status=PENDING"
```

### 4.3 Fluxo financeiro esperado

1. Criar pedido com total > 0.
2. Registrar dois pagamentos parciais.
3. Conferir `paymentStatus=PARCIAL` em `GET /orders/:id`.
4. Tentar sobrepagamento e confirmar HTTP `400`.
5. Registrar valor restante exato e confirmar `paymentStatus=PAGO`.

### 4.4 Fluxo D+1 esperado

1. Garantir produto com BOM e item de estoque com saldo.
2. Criar pedido para entrar na base D+1 (fallback atual: `createdAt + 1 dia`).
3. Chamar `GET /production/requirements?date=<amanha>`.
4. Confirmar coerencia de `requiredQty`, `availableQty`, `shortageQty`.

## 5. Dados Reais (PDF/XLSX) E Mapeamento De Dominio

Leitura local feita com fallback textual (sem leitor PDF em `localhost:8451`):
- PDFs lidos por extracao de texto por palavras-chave
- planilha lida via `openpyxl`

Achados relevantes:
- Arquitetura local reforca blocos LEGO do dominio (dados -> catalogo -> pedido -> itens -> calculo -> estados -> D+1 -> financeiro -> WhatsApp)
- `QUERO BROA (1).xlsx`:
  - aba `Custos`: insumo, valor, quantidade embalagem, quantidade receita, valor gasto
  - abas `ESTOQUE` e `CONSUMO`: matriz temporal por data/insumo
  - aba `NF_RAW`: estrutura fiscal (`timestamp`, `chave_acesso`, `valor_total`, `itens_descricao`, `raw_text`)

Implicacao:
- modelo atual de `InventoryItem`, `InventoryMovement` e `BOM` ja suporta o nucleo de necessidade D+1
- ingestao fiscal (`NF_RAW`) continua pendente para proxima etapa

## 6. Troubleshooting

- Erro `TypeError: Failed to fetch` no Web:
  - revisar `NEXT_PUBLIC_API_URL`
  - confirmar API em `127.0.0.1:3001`
  - conferir CORS no `apps/api/src/main.ts`

- `./scripts/dev-all.sh` falha com `tsx watch` em ambiente restrito:
  - subir API com `start:tsx` (sem watch)

- `pnpm --filter @querobroapp/web typecheck`:
  - atualmente ha erros preexistentes em `apps/web/src/app/clientes/page.tsx` (namespace `google`)
  - nao bloqueia o fluxo MVP financeiro/D+1 entregue

## 7. Riscos E Pendencias

- Drift entre `schema.prisma` (dev) e `schema.prod.prisma` (prod) ainda existe em partes historicas
- Sem testes automatizados abrangentes de regressao (fluxos validos manualmente)
- Outbox WhatsApp sem worker/provider (intencional nesta etapa)
- Regra de data D+1 usa fallback `createdAt + 1 dia` por ausencia de `deliveryDate`
