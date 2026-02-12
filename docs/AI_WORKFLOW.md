# Fluxo Simples entre Codex, ChatGPT e Copilot

## Regra principal

Use **Codex Terminal** como executor oficial do projeto.

- Codex Terminal: altera codigo, roda testes, faz commit/push.
- ChatGPT Web/Mobile: estrategia, ideias, texto.
- Copilot no editor: sugestoes de codigo apenas.

## Regra de seguranca

Nunca desenvolver direto em `main`.

Sempre usar branch de trabalho:

- `wip/...` para trabalho em andamento,
- `feat/...` para funcionalidade pronta para revisao.

## Rotina recomendada

1. Comecar o dia:
   - abrir Codex e pedir: "verifique branch, status e sincronize com main com seguranca".
2. Durante o trabalho:
   - manter tudo na branch de trabalho.
3. Encerrar o dia:
   - pedir: "faça checkpoint: commit e push da branch atual".

## Integracao entre chats

Quando conversar no ChatGPT (web/mobile), traga para o Codex:

- objetivo em 1 frase,
- o que precisa mudar,
- prioridade.

O Codex aplica no repositorio real e confirma com testes.

## Se houver confusao de branch/push

Peça exatamente:

`Mapeie o git e execute o fluxo seguro sem perder nada.`

## Limpeza automatica de branches

No GitHub, a limpeza esta automatizada:

- PR mergeado: branch apagada automaticamente.
- Push em `main`: workflow faz poda de branches totalmente mergeadas (`wip/*`, `feat/*`, `fix/*`, etc.).
