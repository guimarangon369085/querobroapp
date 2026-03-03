# BOOTSTRAP_PROMPTS

## Fonte Unica

O launcher [abrir-codex.command](/Users/gui/querobroapp/scripts/abrir-codex.command) nao carrega mais prompt inline. Ele le exatamente um destes templates versionados:

- `quick`: [codex-bootstrap-quick.txt](/Users/gui/querobroapp/docs/prompts/codex-bootstrap-quick.txt)
- `reboot` e `qa`: [codex-bootstrap-reboot.txt](/Users/gui/querobroapp/docs/prompts/codex-bootstrap-reboot.txt)
- `ux`: [codex-bootstrap-ux.txt](/Users/gui/querobroapp/docs/prompts/codex-bootstrap-ux.txt)

## Uso

O default continua sendo o bootstrap rapido:

- `./scripts/abrir-codex.command`
- `./scripts/abrir-codex.command quick`
- `./scripts/abrir-codex.command reboot`
- `./scripts/abrir-codex.command qa`
- `./scripts/abrir-codex.command ux`

## Regras De Desenho

- `quick` e o modo padrao e nao faz perguntas iniciais.
- Sem objetivo explicito, `quick` sincroniza contexto, entrega um resumo curto e fica aguardando silenciosamente a proxima instrucao.
- `quick` assume por padrao que a proxima mensagem tratara de ajustes no app, UX, bugs ou refinamentos operacionais.
- `reboot` e `qa` existem para o trilho pesado de religar ambiente, subir stack e validar manualmente.
- `ux` existe para uma sessao focada em simplificacao de interface sem puxar o runbook de reboot por padrao.
- Mudou o comportamento de um modo: atualizar primeiro o template `.txt` correspondente, e so depois esta pagina se a orientacao de uso tambem mudou.
