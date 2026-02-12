# Demo de Navegacao + Go/No-Go Sprint B

## Objetivo
Validar o app em uso real com voce e a Gabi antes de novas mudancas estruturais.

Data sugerida: 2026-02-12 a 2026-02-15  
Duracao sugerida: 60 a 90 minutos

## Preflight (5 min)
1. Subir stack com duplo clique no Desktop:
- `@QUEROBROAPP.app` (preferencial, sem terminal)
- fallback: `@QUEROBROAPP.command`

2. Conferir stack visualmente:
- Abrir `http://127.0.0.1:3000`
- Confirmar que a home carregou sem erro
- Ir para `Dashboard` e confirmar cards carregando

3. Confirmar URLs:
- Web: `http://127.0.0.1:3000`
- Builder: `http://127.0.0.1:3000/builder`
- Estoque: `http://127.0.0.1:3000/estoque`

Para encerrar apos a sessao:
- `Parar QUEROBROAPP.app` (preferencial)
- fallback: `Parar QUEROBROAPP.command`

## Papéis da Sessão
1. Condutor (voce): navega e executa os fluxos.
2. Observadora (Gabi): registra atritos e impressao de clareza.
3. Relator: marca checklist e registra insights no template desta pagina.

## Critério de Severidade
1. `BLOQUEADOR`: impede concluir tarefa principal.
2. `IMPORTANTE`: tarefa conclui, mas com erro, retrabalho ou risco.
3. `MELHORIA`: ajuste de UX/texto/layout sem impedir operacao.

## Roteiro de Validacao

### 1. Visao Geral e Navegacao
- [ ] Home abre sem erro visual.
- [ ] Navegacao lateral troca de pagina sem confusao.
- [ ] Topbar botoes levam ao bloco certo (com scroll e foco).
- [ ] Mobile/responsivo basico testado em largura reduzida.

### 2. Produtos
- [ ] Criar produto novo com nome/categoria/unidade/preco.
- [ ] Editar produto existente e salvar.
- [ ] Arquivar/remover produto sem quebrar lista.
- [ ] Busca e filtro (ativos/inativos) funcionam.

### 3. Clientes
- [ ] Criar cliente novo.
- [ ] Editar cliente.
- [ ] Buscar cliente por nome/telefone.
- [ ] Fluxo nao gera duvida para usuario leigo.

### 4. Pedidos e Pagamentos
- [ ] Criar pedido com cliente + itens.
- [ ] Adicionar/remover item do pedido.
- [ ] Atualizar status do pedido.
- [ ] Registrar pagamento parcial.
- [ ] Marcar pedido como pago.
- [ ] Status financeiro (PENDENTE/PARCIAL/PAGO) bate com valores.

### 5. Estoque e Producao
- [ ] Lancar movimentacao manual.
- [ ] Ver saldos e historico.
- [ ] Abrir quadro D+1 e validar leitura geral.

### 6. Cupom NFC -> Estoque (Atalhos iOS)
- [ ] Executar atalho por NFC.
- [ ] Tirar foto do cupom e processar sem erro.
- [ ] Receber notificacao final no iPhone.
- [ ] Ver movimentacao aplicada em `Estoque > Movimentacoes`.
- [ ] Repetir envio com mesmo `idempotency-key` e confirmar que nao duplica.

### 7. Builder (Modo LEGO)
- [ ] Alterar cor/fonte/input e ver efeito no app.
- [ ] Ajustar regra de item oficial de cupom e salvar.
- [ ] Subir/remover imagem da home.
- [ ] Reordenar bloco de layout de alguma pagina e validar.

## Template de Insights (preencher durante a demo)

Use 1 linha por insight:

| ID | Severidade | Tela/Fluxo | Evidencia curta | Ajuste sugerido | Responsavel | Status |
| --- | --- | --- | --- | --- | --- | --- |
| D-001 | BLOQUEADOR/IMPORTANTE/MELHORIA | Ex.: Pedidos > Novo pedido | Ex.: botao salva, mas usuario nao percebe onde ficou | Ex.: scroll + highlight no card criado | Codex/Time | Aberto |

## Gate de Decisao: Sprint B (Go/No-Go)

Iniciar Sprint B somente se todos os itens abaixo estiverem `SIM`:
1. [ ] Sem `BLOQUEADOR` aberto.
2. [ ] Fluxo Cupom NFC -> Estoque passou 3 vezes seguidas.
3. [ ] Fluxo principal (`Produtos -> Pedidos -> Pagamentos -> Estoque`) aprovado por voce e Gabi.
4. [ ] Lista de `IMPORTANTE` priorizada e fechada para evitar novas mudancas estruturais inesperadas.

Se algum item estiver `NAO`, executar apenas ajustes taticos e repetir demo curta.

## Plano de Pós-Demo
1. Consolidar insights em 3 lotes: `Agora`, `Proximo`, `Depois`.
2. Entregar correcoes taticas primeiro (UX e clareza operacional).
3. Quando gate estiver 100% verde, iniciar Sprint B (dados/migracoes).
