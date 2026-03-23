# MVP_FINANCEIRO_E_D+1

> Nota historica: este documento mistura partes ainda validas do financeiro/D+1 com referencias a WhatsApp que nao fazem mais parte da base ativa. Use apenas os blocos de financeiro e D+1 como referencia atual.

## Objetivo

Explicar de forma simples como o bloco financeiro e o bloco D+1 funcionam hoje.

## Financeiro (pedido)

O sistema calcula automaticamente:

- `Total` do pedido
- `Pago` (soma de pagamentos confirmados)
- `Saldo` (o que ainda falta)
- `Status financeiro` (`PENDENTE`, `PARCIAL`, `PAGO`)

### Regras importantes

- Nao permite pagamento acima do saldo.
- Pedido cancelado bloqueia novos pagamentos.
- Existe acao rapida para quitar o saldo restante.

## D+1 (producao)

O quadro D+1 mostra:

- quanto de cada insumo sera necessario na data escolhida
- quanto ja existe em estoque
- quanto vai faltar

Endpoint:
- `GET /production/requirements?date=YYYY-MM-DD`

Uso pratico:
1. Abrir `Estoque`.
2. Ir na secao D+1.
3. Escolher data.
4. Ver faltas e planejar compras/producao.

## Outbox de WhatsApp

Esta secao ficou historica.

- A base operacional atual nao expoe `GET /whatsapp/outbox`.
- O fluxo ativo validado hoje e interno, sem provider externo.
- Qualquer reintegracao futura deve ser redesenhada do zero.

## O que validar manualmente

1. Criar pedido com itens.
2. Registrar pagamento parcial.
3. Confirmar `Status financeiro = PARCIAL`.
4. Quitar saldo restante.
5. Confirmar `Status financeiro = PAGO`.
6. Abrir D+1 e verificar leitura da falta por insumo.
