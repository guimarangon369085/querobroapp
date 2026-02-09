# QuerobroApp Backend

Backend inicial em Node.js + Express + SQLite para gerenciamento de produtos, clientes, pedidos e pagamentos.

## Requisitos

- Node.js 18+

## Setup

1. Instale dependências:

```bash
npm install
```

2. Copie o arquivo de ambiente:

```bash
cp .env.example .env
```

3. Inicie a API:

```bash
npm run dev
```

A API sobe em `http://localhost:3000`.

## Variáveis de ambiente

- `PORT`: porta do servidor
- `DB_PATH`: caminho do arquivo SQLite

## Endpoints

### Saúde
- `GET /health`

### Produtos
- `GET /produtos`
- `GET /produtos/:id`
- `POST /produtos`
- `PUT /produtos/:id`
- `DELETE /produtos/:id`

### Clientes
- `GET /clientes`
- `GET /clientes/:id`
- `POST /clientes`
- `PUT /clientes/:id`
- `DELETE /clientes/:id`

### Pedidos
- `GET /pedidos`
- `GET /pedidos/:id`
- `POST /pedidos`
- `PUT /pedidos/:id`
- `DELETE /pedidos/:id`

### Pagamentos
- `GET /pagamentos`
- `GET /pagamentos/:id`
- `POST /pagamentos`
- `PUT /pagamentos/:id`
- `DELETE /pagamentos/:id`

## Exemplos de payload

### Criar produto

```json
{
  "name": "Cerveja Artesanal",
  "description": "IPA 500ml",
  "price": 12.5,
  "stock": 20
}
```

### Criar cliente

```json
{
  "name": "Maria Santos",
  "email": "maria@email.com",
  "phone": "+55 11 99999-0000"
}
```

### Criar pedido

```json
{
  "client_id": 1,
  "items": [
    { "product_id": 1, "quantity": 2 },
    { "product_id": 2, "quantity": 1 }
  ]
}
```

### Criar pagamento

```json
{
  "order_id": 1,
  "amount": 37.5,
  "method": "pix",
  "status": "pago",
  "paid_at": "2026-02-09 12:30:00"
}
```
