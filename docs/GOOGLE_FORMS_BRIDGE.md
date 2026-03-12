# Google Forms Bridge

Canal temporario para capturar pedidos sem depender ainda de um numero dedicado de WhatsApp Business.

## Rotas

- `POST /orders/intake/google-form`
- Alias generico futuro: `POST /orders/intake/customer-form`

## Objetivo

O Google Forms entra apenas como camada de entrada.

O dominio do app continua centralizado no intake canonico de pedidos, o que facilita migrar depois para:

- pagina publica propria
- WhatsApp Flow

## Payload esperado

```json
{
  "version": 1,
  "customer": {
    "name": "Nome do cliente",
    "phone": "31999999999",
    "address": "Rua Exemplo, 100",
    "deliveryNotes": "Portao azul"
  },
  "fulfillment": {
    "mode": "DELIVERY",
    "scheduledAt": "2030-03-15T14:30:00.000Z"
  },
  "flavors": {
    "T": 4,
    "G": 3,
    "D": 0,
    "Q": 0,
    "R": 0
  },
  "notes": "Sem cebola",
  "source": {
    "channel": "GOOGLE_FORM",
    "externalId": "google-form:carimbo:telefone",
    "originLabel": "google-forms.apps-script"
  }
}
```

## Especificacao final do Google Form

A ordem abaixo foi alinhada para migrar com o minimo de retrabalho depois para `PUBLIC_FORM` ou `WHATSAPP_FLOW`.

1. `Nome completo`
   - tipo: resposta curta
   - obrigatorio: sim
2. `Telefone com WhatsApp`
   - tipo: resposta curta
   - obrigatorio: sim
   - validacao: telefone celular com DDD
3. `Como voce quer receber?`
   - tipo: multipla escolha
   - obrigatorio: sim
   - opcoes:
     - `Entrega`
     - `Retirada`
4. `Endereco para entrega`
   - tipo: resposta curta
   - obrigatorio: sim no processo, mesmo que o Google Forms nao condicione por modo
   - instrucao: `Se for retirada, escreva "Retirada".`
5. `Complemento / referencia`
   - tipo: resposta curta
   - obrigatorio: nao
6. `Data do pedido`
   - tipo: data
   - obrigatorio: sim
7. `Horario`
   - tipo: horario
   - obrigatorio: sim
8. `Quantidade Tradicional (T)`
   - tipo: resposta curta com validacao numerica inteira >= 0
   - obrigatorio: sim
9. `Quantidade Goiabada (G)`
   - tipo: resposta curta com validacao numerica inteira >= 0
   - obrigatorio: sim
10. `Quantidade Doce de Leite (D)`
    - tipo: resposta curta com validacao numerica inteira >= 0
    - obrigatorio: sim
11. `Quantidade Queijo do Serro (Q)`
    - tipo: resposta curta com validacao numerica inteira >= 0
    - obrigatorio: sim
12. `Quantidade Requeijao de Corte (R)`
    - tipo: resposta curta com validacao numerica inteira >= 0
    - obrigatorio: sim
13. `Observacoes do pedido`
    - tipo: paragrafo
    - obrigatorio: nao

Regra operacional:

- o formulario nao pergunta pagamento
- o app assume `PIX`
- pelo menos uma quantidade precisa ser maior que `0`

## Mapa de migracao futura

- `Google Forms`:
  - chama `POST /orders/intake/google-form`
- `Pagina publica atual do app`:
  - abre em `/pedido`
  - envia para `POST /api/customer-form`
  - a route handler do Next repassa para `POST /orders/intake/customer-form`
- `Pagina publica propria`:
  - chama `POST /orders/intake/customer-form`
- `WhatsApp Flow`:
  - coleta os mesmos campos
  - chama `POST /orders/intake/customer-form` ou `POST /orders/intake/whatsapp-flow`

Ou seja: muda o canal, nao muda o contrato.

## Apps Script

Arquivo de apoio:

- [google-form-bridge.gs](/Users/gui/querobroapp/scripts/google-form-bridge.gs)

Configure os 2 valores no topo do script:

- `API_BASE_URL`
- `API_AUTH_TOKEN`

Regras:

- em producao, `API_BASE_URL` precisa ser uma URL publica HTTPS acessivel pelo Google
- `127.0.0.1` ou `localhost` servem apenas para teste local via script Node, nao para o Apps Script real
- se `ORDER_FORM_BRIDGE_TOKEN` estiver configurado no backend, o mesmo valor deve entrar em `API_AUTH_TOKEN`
- se `APP_AUTH_ENABLED=true`, configure `ORDER_FORM_BRIDGE_TOKEN` e nao reutilize o token admin do app para o Forms

## Migracao futura para WhatsApp Flow

Quando o numero dedicado estiver pronto:

1. o Flow coleta os mesmos campos
2. o backend envia para `POST /orders/intake/customer-form` ou `POST /orders/intake/whatsapp-flow`
3. o restante do dominio continua igual

Ou seja: muda o canal, nao muda a regra de negocio.
