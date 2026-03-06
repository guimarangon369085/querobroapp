# QUEROBROAPP: Guia End-to-End Atual

Ultima atualizacao: 2026-03-02

Este guia descreve o comportamento real do app hoje, sem depender de memoria de conversa antiga.

## 1. O que o app e agora

O QUEROBROAPP hoje e um ERP operacional enxuto para a rotina da broa.
O centro da operacao e a tela `Pedidos`.

Fluxo mental correto:

```text
PRODUTOS -> CLIENTES -> PEDIDOS -> ESTOQUE
```

O objetivo do app nao e ter varias telas decorativas.
O objetivo e permitir:

1. cadastrar base,
2. vender,
3. produzir,
4. entregar,
5. receber,
6. planejar a proxima compra.

## 2. Navegacao real

Hoje existem 4 telas operacionais no menu principal:

| Tela | Papel real |
| --- | --- |
| `Pedidos` | Agenda do dia, criacao de pedido, status, producao, entrega e pagamento |
| `Clientes` | Cadastro e edicao rapida de clientes |
| `Produtos` | Catalogo e ficha tecnica |
| `Estoque` | Saldo, faltas, D+1 e compras |

Rotas legadas:

- `/calendario` redireciona para `/pedidos`
- `/` redireciona para `/pedidos`
- `/dashboard`, `/hoje` e `/jornada` convergem para `Pedidos`
- `/builder` redireciona para `/pedidos`

## 3. Como subir apos reiniciar a maquina

Fluxo recomendado:

```bash
./scripts/stop-all.sh
./scripts/dev-all.sh
```

Se quiser limpar dados de teste antes:

```bash
pnpm cleanup:test-data
```

O que esperar:

1. A API sobe em `http://127.0.0.1:3001`.
2. O Web sobe em `http://127.0.0.1:3000`.
3. O script abre `http://127.0.0.1:3000/pedidos`.
4. Fechar a janela do `dev-all` encerra API e Web.

Checks minimos:

```bash
curl -fsS http://127.0.0.1:3001/health
curl -I http://127.0.0.1:3000/pedidos
```

Se o navegador ja estava aberto antes do reboot, faca hard refresh.

## 4. Como `Pedidos` funciona hoje

`Pedidos` e a agenda operacional do app.

### Comportamento esperado ao abrir

1. A tela abre em `Dia`.
2. A grade do dia vai de `08:00` ate `22:59`.
3. O layout e compacto para caber a janela de trabalho sem scroll excessivo.

### Navegacao por data

1. `Dia`, `Semana` e `Mes` vivem na mesma tela.
2. Clicar em qualquer card de `Semana` ou `Mes` abre a visao `Dia` naquela data.
3. Isso funciona mesmo quando o dia nao tem nenhum pedido.

### Operacao principal

1. Criar pedido.
2. Confirmar pedido.
3. Levar para producao.
4. Marcar como `PRONTO`.
5. Disparar entrega.
6. Marcar como `ENTREGUE`.
7. Registrar pagamento parcial ou total.

Fluxo de status:

```text
ABERTO -> CONFIRMADO -> EM_PREPARACAO -> PRONTO -> ENTREGUE
```

### Integracoes visiveis em `Pedidos`

- WhatsApp Flow: o launch local funciona por preview local estavel.
- Producao: fila e proxima fornada continuam integradas.
- Entrega: sem Uber live, usa simulacao local persistente.
- Pagamento: continua registrando parcial ou total.

## 5. Como `Clientes` funciona hoje

`Clientes` e o cadastro minimo de entrega.

O que validar:

1. Criar cliente.
2. Editar cliente clicando no card inteiro.
3. Conferir telefone e endereco.

Comportamento esperado:

- O card inteiro e clicavel.
- Botoes internos continuam funcionando sem conflito.

## 6. Como `Produtos` funciona hoje

`Produtos` e o catalogo comercial.

O que validar:

1. Criar produto.
2. Editar produto clicando no card inteiro.
3. Conferir preco e ficha tecnica.

Comportamento esperado:

- O card inteiro e clicavel.
- O produto continua servindo de base para pedido e consumo por BOM.

## 7. Como `Estoque` funciona hoje

`Estoque` concentra a leitura operacional.

O que validar:

1. Conferir saldo atual.
2. Conferir faltas e compras do D+1.
3. Abrir cards e detalhes clicando no elemento inteiro.
4. Confirmar que a leitura da tela segue a jornada:

```text
planejar -> comprar -> produzir -> conferir
```

## 8. Integracoes no ambiente local

- Nao ha integracoes externas ativas no fluxo operacional atual.
- WhatsApp, Uber, Alexa, receipts e conectores de terceiros foram removidos da base ativa.
- O ambiente local deve validar apenas o fluxo interno em `Pedidos`, `Clientes`, `Produtos` e `Estoque`.
- Qualquer reintegracao futura deve ser reprojetada do zero, sem reaproveitar contratos antigos por inercia.

## 9. Checklist manual de validacao

1. Abrir `Pedidos`.
2. Trocar de `Mes` para um dia vazio e confirmar que abre `Dia` corretamente.
3. Criar ou editar um produto.
4. Criar ou editar um cliente.
5. Criar um pedido.
6. Avancar o pedido no fluxo.
7. Registrar pagamento.
8. Abrir `Estoque` e conferir D+1.

## 10. QA automatizado que existe hoje

Baseline:

```bash
pnpm qa:trust
```

Validador completo:

```bash
QA_TRUST_INCLUDE_LINT=1 \
QA_TRUST_INCLUDE_SMOKE=1 \
QA_TRUST_INCLUDE_BROWSER=1 \
QA_TRUST_INCLUDE_CRITICAL_E2E=1 \
pnpm qa:trust
```

Comandos separados:

```bash
pnpm qa:smoke
pnpm qa:browser-smoke
pnpm qa:critical-e2e
```

## 11. Resumo curto

Se voce esquecer o resto, lembre disto:

```text
O app abre em Pedidos.
Pedidos e a agenda do dia.
O ambiente local e estavel por design.
WhatsApp local nao depende de Meta live.
Uber local nao depende de credencial live.
O caminho certo apos reboot e dev-all -> /pedidos -> checklist manual.
```
