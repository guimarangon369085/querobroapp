# QUEROBROAPP: Guia End-to-End da Versao Atual

Este guia explica, de forma direta e visual, como a versao atual do QUEROBROAPP funciona hoje.

Pense no app como um ERP artesanal para uma operacao pequena de producao e entrega:

```text
CADASTRAR BASE -> VENDER -> PRODUZIR -> ENTREGAR -> RECEBER -> REABASTECER
```

Em termos práticos:

```text
PRODUTOS + FICHA TECNICA
           |
           v
       CLIENTES
           |
           v
        PEDIDOS
           |
           v
 CONFIRMAR / PREPARAR / ENTREGAR
           |
           v
       PAGAMENTOS
           |
           v
 ESTOQUE + COMPRAS D+1 + CUPONS
```

## 1. O que o app e

O QUEROBROAPP organiza a rotina operacional da broa em um fluxo simples:

1. Definir o que voce vende.
2. Definir para quem voce vende.
3. Registrar pedidos.
4. Consumir insumos conforme a receita.
5. Marcar entrega e pagamento.
6. Descobrir o que falta comprar para o proximo ciclo.

Ele tem tres camadas principais:

```text
CAMADA 1: WEB
Painel principal usado no navegador.

CAMADA 2: API
Regras de negocio, validacoes, automacoes, OCR e integracoes.

CAMADA 3: DADOS
Banco + arquivos JSON locais para configuracoes, automacoes e OAuth da Alexa.
```

## 2. Mapa rapido da interface

Hoje a navegacao principal tem 8 telas, agrupadas na lateral esquerda:

| Grupo | Tela | Para que serve |
| --- | --- | --- |
| Operacao do dia | Inicio | Centro de operacao com proximo passo, indicadores e atalho para agir |
| Operacao do dia | Jornada | Mapa guiado das etapas do processo |
| Operacao do dia | Pedidos | Criar, acompanhar e concluir pedidos |
| Base | Clientes | Cadastro e manutencao dos clientes |
| Base | Produtos | Catalogo, preco e acesso rapido a ficha tecnica |
| Planejamento | Estoque | Saldo, faltas, compras e planejamento D+1 |
| Planejamento | Resumo | KPIs gerenciais e visao consolidada |
| Sistema | Builder | Ajustes de configuracao visual e operacional |

Leitura mental da lateral:

```text
OPERACAO DO DIA  -> o que fazer agora
BASE             -> o que precisa existir para vender
PLANEJAMENTO     -> o que precisa existir para nao faltar
SISTEMA          -> como o app se comporta
```

## 3. O fluxo principal em uma frase

Se voce nunca viu o app, grave isto:

```text
Voce cadastra produto e cliente, cria pedido, o app desconta insumo da receita,
depois voce entrega, recebe e usa o estoque para planejar a proxima compra.
```

## 4. Jornada visual do dia

O proprio app organiza a operacao em 7 etapas:

```text
1. Receita pronta
2. Cliente pronto
3. Pedido criado
4. Pedido confirmado
5. Producao pronta
6. Entrega concluida
7. Pagamento concluido
```

Isso aparece como um fluxo operacional. A ideia e simples:

```text
se a etapa anterior nao esta resolvida,
a proxima ainda nao deveria ser o foco.
```

## 5. Tela por tela, sem suposicao

### Inicio

A tela `Inicio` e o painel de comando.

O que ela faz:

1. Mostra o estado atual da operacao.
2. Mostra qual e o proximo passo recomendado.
3. Resume numeros basicos: produtos, clientes, pedidos abertos, entregues e valor pendente.
4. Serve como ponto de entrada para quem abriu o sistema agora.

Quando usar:

```text
Abra esta tela quando quiser entender "o que esta faltando agora".
```

### Jornada

A tela `Jornada` transforma o processo em etapas visuais.

O que ela faz:

1. Mostra as 7 fases do fluxo.
2. Deixa claro o que ja esta pronto, o que esta em andamento e o que ainda esta travado.
3. Direciona para a tela certa para concluir a proxima acao.

Quando usar:

```text
Abra esta tela quando quiser seguir o processo sem pensar demais.
```

### Pedidos

A tela `Pedidos` e o centro operacional das vendas.

O que ela faz hoje:

1. Cria pedido com cliente e itens obrigatorios.
2. Usa o preco atual dos produtos para calcular subtotal, desconto e total.
3. Mostra visao de agenda para navegar por datas.
4. Permite acompanhar detalhes do pedido.
5. Permite avancar o status do pedido.
6. Permite registrar pagamento parcial ou total.

Fluxo real do status:

```text
ABERTO -> CONFIRMADO -> EM_PREPARACAO -> PRONTO -> ENTREGUE
```

Cancelamento:

```text
Pode cancelar antes do fim do fluxo.
```

Efeito invisivel importante:

```text
Ao criar pedido ou adicionar item, o app consome insumos automaticamente
com base na ficha tecnica (BOM) do produto.
```

### Clientes

A tela `Clientes` cuida da base de entrega.

O que ela faz:

1. Cadastro.
2. Edicao.
3. Consulta.
4. Exclusao somente quando o cliente ainda nao esta ligado a pedidos.

Detalhe util:

```text
Se nome e sobrenome nao forem enviados separadamente,
o backend tenta derivar isso do nome completo.
```

### Produtos

A tela `Produtos` cuida do catalogo comercial.

O que ela faz:

1. Cadastro de produto.
2. Preco.
3. Categoria.
4. Unidade.
5. Ligacao com ficha tecnica.

Detalhe importante:

```text
Ao criar um produto, o sistema garante que exista uma ficha tecnica padrao.
Se ainda nao existir, ele cria sob demanda.
```

### Estoque

A tela `Estoque` e a area mais operacional para planejamento.

O que ela concentra:

1. Saldos atuais de insumos.
2. Movimentacoes de entrada e saida.
3. Itens em falta.
4. Lista de compras.
5. Planejamento D+1.
6. Comparacao de preco com fornecedor online.

O raciocinio da tela:

```text
O que tenho agora
-
O que a producao de amanha vai consumir
=
O que preciso comprar ou ajustar
```

Ela e a tela mais proxima de "nao deixar faltar nada".

### Resumo

A tela `Resumo` e o painel gerencial.

O que ela faz:

1. Consolida KPIs.
2. Reune visao mais executiva.
3. Ajuda a enxergar o desempenho sem entrar em cada tela operacional.

Pense nela como:

```text
menos operacao de detalhe
mais leitura geral da saude do negocio
```

### Builder

A tela `Builder` controla configuracoes do proprio app.

O que ela faz hoje:

1. Ajusta blocos de configuracao visual e operacional.
2. Salva configuracao em JSON local.
3. Gerencia galeria da home.

Detalhes reais:

1. Cria defaults automaticamente se o arquivo de configuracao ainda nao existir.
2. Faz merge parcial por bloco.
3. Aceita upload de ate 12 imagens para a home.

## 6. O que acontece por baixo do pano

A parte mais importante do app nao e a tela. E a automacao de regra de negocio.

### Regra 1: pedido mexe no estoque

Quando um pedido e criado, o app nao apenas salva "vendemos X".

Ele tambem:

```text
1. olha os itens do pedido
2. encontra a ficha tecnica (BOM) de cada produto
3. calcula o consumo dos insumos
4. registra saida automatica no estoque de insumos
```

Se o pedido for cancelado ou o item for removido:

```text
o sistema estorna a movimentacao e devolve o saldo ao estoque
```

### Regra 2: pagamento nao e so um campo

Pagamento e tratado em modulo separado.

Na pratica:

1. Um pedido pode ter varios pagamentos.
2. O backend calcula quanto ja foi pago.
3. O backend calcula quanto ainda falta.
4. O status financeiro vira `PENDENTE`, `PARCIAL` ou `PAGO`.
5. O sistema bloqueia pagar acima do total do pedido.

### Regra 3: producao D+1 e calculada

O modulo `Production` calcula a necessidade de producao para o dia seguinte.

Hoje o raciocinio real e:

```text
pedidos validos
-> identificar o dia de producao
-> somar necessidade por ficha tecnica
-> comparar com saldo atual
-> mostrar faltas e avisos
```

Resultado:

```text
o app consegue dizer o que falta comprar para nao quebrar o dia seguinte
```

## 7. Como um pedido percorre o sistema

Este e o melhor jeito de entender o app.

### Exemplo visual

```text
[1] Cadastra produto
    Broa Tradicional

        |
        v

[2] Define ficha tecnica
    fuba, acucar, manteiga, embalagem...

        |
        v

[3] Cadastra cliente
    nome, telefone, endereco

        |
        v

[4] Cria pedido
    10 unidades

        |
        v

[5] Sistema calcula
    total do pedido
    +
    consumo automatico de insumos

        |
        v

[6] Pedido avanca
    confirmado -> preparo -> pronto -> entregue

        |
        v

[7] Pagamentos entram
    parcial ou total

        |
        v

[8] Estoque e D+1 mostram
    o que sobrou
    o que faltou
    o que comprar
```

## 8. Como entram compras e cupons fiscais

O modulo `Receipts` serve para transformar cupom fiscal em entrada de estoque.

Fluxo real de leitura:

```text
1. Se vier rawText (texto OCR), ele tenta parse local primeiro.
2. Se nao vier rawText, tenta OCR local no macOS (Vision).
3. Se isso nao resolver, pode cair para OpenAI Vision.
4. Depois aplica regras de mapeamento.
5. No ingest, gera entradas de estoque (IN).
```

Ou seja:

```text
foto do cupom -> reconhecer itens -> mapear item valido -> dar entrada no estoque
```

Pontos importantes da versao atual:

1. Existe protecao por token (`x-receipts-token`) quando configurado.
2. Ha suporte a idempotencia para evitar duplicar lancamento.
3. O parser hoje ja faz leitura local antes de gastar tokens externos, quando possivel.

## 9. Automacoes que ja existem

O modulo `Automations` hoje executa 4 skills reais:

| Skill | O que faz |
| --- | --- |
| `D1_PURCHASE_PLAN` | Calcula producao D+1, pode sincronizar fornecedor e gerar plano de compra |
| `SUPPLIER_PRICE_SYNC` | Sincroniza preco de fornecedor |
| `RECEIPTS_BATCH_INGEST` | Processa lote de cupons |
| `RUNBOOK_SHELL` | Executa rotinas shell controladas por allowlist, se habilitado |

Pense nelas como botoes de "trabalho pesado" do sistema.

## 10. Voz e Alexa

O app ja tem dois caminhos de comando por voz.

### Voice (interno)

O modulo `Voice` consegue:

1. Abrir sessao Realtime na OpenAI.
2. Interpretar um comando falado.
3. Classificar a intencao.
4. Executar automaticamente algumas automacoes se a confianca for suficiente.

Hoje ele entende, por exemplo:

```text
sincronizar fornecedor
gerar plano D+1
ingerir lote de cupons
```

### Alexa (externo)

O modulo `Alexa` conecta a skill ao app.

Hoje ele faz:

1. Validacao por token dedicado.
2. Validacao HMAC com timestamp.
3. Protecao anti-replay.
4. Allowlist de skill.
5. Account linking com OAuth local.

Intents atuais:

```text
SyncSupplierPricesIntent
BuildPurchasePlanIntent
LatestAutomationStatusIntent
```

Traduzindo:

```text
A Alexa hoje ja consegue acionar rotinas reais do app com uma ponte segura.
```

## 11. O que o app salva onde

Nem tudo fica no mesmo lugar.

Mapa simples:

```text
BANCO
- pedidos
- clientes
- produtos
- pagamentos
- movimentos

ARQUIVOS JSON
- builder/config.json
- automations/runs.json
- alexa/oauth-store.json

ARQUIVOS DE MIDIA
- imagens da home enviadas pelo Builder
```

Isso importa porque explica por que algumas partes do sistema sao "dados de negocio"
e outras sao "estado operacional/configuracao".

## 12. O que esta implementado, mas com limite

Para entender a versao atual sem ilusao, estes limites sao importantes:

1. O modulo de WhatsApp hoje monta e lista a outbox, mas nao envia mensagem de fato.
2. `Inventory` e `Stock` sao modulos diferentes: um cuida de insumos/embalagens, outro cuida de estoque de produto.
3. A Alexa ja esta conectada por bridge seguro, mas o uso pratico ainda depende das intents que forem sendo adicionadas.
4. O `Builder` ajusta configuracao e home, mas nao e um construtor no-code completo.

## 13. O primeiro uso ideal, em 15 minutos

Se eu estivesse apresentando o app a alguem do zero, eu faria nesta ordem:

### Passo 1

Abra `Produtos` e cadastre 1 produto real.

Objetivo:

```text
garantir que existe algo vendavel no sistema
```

### Passo 2

Confirme que a ficha tecnica desse produto existe.

Objetivo:

```text
garantir que o app saiba consumir insumo automaticamente
```

### Passo 3

Abra `Clientes` e cadastre 1 cliente real.

Objetivo:

```text
garantir que o pedido tenha destino
```

### Passo 4

Abra `Pedidos` e crie 1 pedido simples.

Objetivo:

```text
ver o fluxo central funcionar de ponta a ponta
```

### Passo 5

Avance o pedido de `ABERTO` ate `ENTREGUE`.

Objetivo:

```text
entender a esteira operacional
```

### Passo 6

Registre um pagamento parcial e depois o restante.

Objetivo:

```text
ver a diferenca entre operacao e financeiro
```

### Passo 7

Abra `Estoque`.

Objetivo:

```text
enxergar o efeito do pedido no consumo e no planejamento seguinte
```

### Passo 8

Teste um cupom fiscal.

Objetivo:

```text
repor insumos por ingestao automatica
```

Depois disso, a pessoa ja entende a espinha dorsal do app.

## 14. Resumo brutalmente simples

Se eu tivesse que explicar o QUEROBROAPP em 5 linhas:

```text
1. O app organiza a venda e a producao da broa.
2. Produto precisa de ficha tecnica.
3. Pedido consome insumo automaticamente.
4. Pagamento fecha o lado financeiro do pedido.
5. Estoque e D+1 mostram o que comprar antes de faltar.
```

## 15. Como ler o app sem se perder

Use esta ordem mental sempre:

```text
BASE
Produtos + Clientes

OPERACAO
Pedidos + Status + Pagamentos

CONTROLE
Estoque + Cupons + D+1

SUPORTE
Resumo + Builder + Automacoes + Voz + Alexa
```

Se voce entender isso, voce ja entende a arquitetura funcional da versao atual.
