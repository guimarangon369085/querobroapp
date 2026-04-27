# Google Forms Bridge

Canal temporario para capturar pedidos pela pagina publica e pelo Google Forms, sem depender de mensageria externa.

## Rotas

- `POST /api/google-form/preview` no `web` (preview seguro, sem criar pedido)
- `POST /api/google-form` no `web` (proxy recomendado quando so o web estiver publico)
- `POST /orders/intake/google-form/preview`
- `POST /orders/intake/google-form`
- Alias generico futuro: `POST /orders/intake/customer-form`

## Objetivo

O Google Forms entra apenas como camada de entrada.

O dominio do app continua centralizado no intake canonico de pedidos, o que facilita evoluir depois sem trocar o contrato:

- pagina publica propria

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

A ordem abaixo foi alinhada para convergir no contrato canonico de `PUBLIC_FORM`.

1. `Nome completo`
   - tipo: resposta curta
   - obrigatorio: sim
2. `Telefone`
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
  - chama `POST /api/google-form` no `web`
  - a route handler do Next repassa para `POST /orders/intake/google-form`
- `Pagina publica atual do app`:
  - abre em `/pedido`
  - envia para `POST /api/customer-form`
  - a route handler do Next repassa para `POST /orders/intake/customer-form`
- `Pagina publica propria`:
  - chama `POST /orders/intake/customer-form`
Ou seja: o Google Forms e a pagina publica usam o mesmo contrato canonico.

## Preview seguro

Para validar o bridge ponta a ponta sem criar pedido nem PIX real:

- `QBAPP_GOOGLE_FORM_MODE=preview node scripts/test-google-form-bridge.mjs`
- `pnpm validate:public-deploy`

O preview usa o mesmo proxy do web e a mesma validacao do backend, mas responde apenas com:

- itens resolvidos
- subtotal, frete e total
- provider/source do frete
- stage esperado (`PIX_PENDING`)

## Apps Script

Arquivo de apoio:

- [google-form-bridge.gs](/Users/gui/querobroapp/scripts/google-form-bridge.gs)

Configure o valor no topo do script:

- `APP_BASE_URL`

Valor atual do script versionado:

- `APP_BASE_URL=https://querobroa.com.br`

Regras:

- em producao, `APP_BASE_URL` precisa ser uma URL publica HTTPS acessivel pelo Google
- `127.0.0.1` ou `localhost` servem apenas para teste local via script Node, nao para o Apps Script real
- quando o script chama `/api/google-form`, o token do backend fica no servidor do `web`; o Apps Script nao precisa carregar `ORDER_FORM_BRIDGE_TOKEN`

## Continuidade

Enquanto o canal externo seguir em formulario, a recomendacao e manter a fonte de verdade no contrato `ExternalOrderSubmissionSchema`.
