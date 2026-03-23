# Tests

Este diretorio guarda testes de infraestrutura e regressao.

Status atual:
- Ja existe teste de alinhamento de schema Prisma (`tests/prisma-schema-drift.test.mjs`).
- A cobertura de dominio (pedido, financeiro, estoque) ainda precisa crescer.

Padrao recomendado para novos testes:
- Nome claro: `<modulo>.<cenario>.test.mjs`
- Um comportamento por teste
- Mensagem de falha objetiva

