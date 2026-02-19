# DELIVERY_BACKLOG

## Agora

1. Simplificar ainda mais o fluxo de `Pedidos` (menos cliques).
2. Validar UX em navegador real e corrigir friccao.
3. Garantir textos de interface 100% claros para usuario leigo.

## Proximo

1. Expandir testes de dominio:
   - pedidos e estados
   - pagamentos (parcial/quitacao)
   - estoque/BOM/D+1
2. Fechar pontos de alinhamento entre `schema.prisma` e `schema.prod.prisma`.
3. Melhorar observabilidade de erros operacionais.

## Depois

1. Provider real de WhatsApp usando outbox ja existente.
2. Evolucao mobile para paridade com web (estoque e D+1).
3. Dashboards gerenciais com leitura simplificada para decisao rapida.

## Regras de prioridade

- Primeiro: o que reduz erro de operacao diaria.
- Segundo: o que evita regressao tecnica.
- Terceiro: o que acelera escala sem aumentar complexidade para o usuario.

