# DEMO_CHECKLIST_GABI

## Objetivo

Validar se uma pessoa leiga consegue operar o fluxo principal sem ajuda tecnica.

## Preflight

1. Web abre em `http://127.0.0.1:3000`.
2. API responde em `http://127.0.0.1:3001/health`.
3. Sem erro visual nas telas principais.

## Checklist funcional

### 1) Produtos
- [ ] Criar produto em menos de 30s.
- [ ] Editar produto sem confusao.

### 2) Clientes
- [ ] Criar cliente com nome, telefone e endereco.
- [ ] Encontrar cliente pela busca.

### 3) Pedidos
- [ ] Criar pedido com cliente + itens.
- [ ] Entender status atual sem explicacao extra.
- [ ] Registrar pagamento parcial.
- [ ] Quitar saldo restante.

### 4) Estoque e D+1
- [ ] Ver faltas no D+1.
- [ ] Lancar movimento manual.
- [ ] Conferir saldo de item.

### 5) Cupom (atalho iOS)
- [ ] Tirar foto e receber notificacao final.
- [ ] Confirmar movimento no estoque.

## Criticidade

- `BLOQUEADOR`: impede concluir tarefa.
- `IMPORTANTE`: conclui com retrabalho alto.
- `MELHORIA`: pode evoluir, mas nao bloqueia operacao.

## Gate de aprovacao

Go para proxima fase somente se:

1. Nenhum bloqueador aberto.
2. Fluxo principal concluido sem suporte tecnico.
3. Time entende claramente o proximo clique em cada tela.

