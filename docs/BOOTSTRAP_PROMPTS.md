# BOOTSTRAP_PROMPTS

## Fonte Unica

O launcher [abrir-codex.command](/Users/gui/querobroapp/scripts/abrir-codex.command) nao carrega mais prompt inline. Ele le exatamente um destes templates versionados:

- Antes de abrir o Codex, ele atualiza automaticamente o snapshot factual em `$HOME/.querobroapp/codex-auto-session-snapshot.md` usando [refresh-codex-context.sh](/Users/gui/querobroapp/scripts/refresh-codex-context.sh).
- Esse snapshot agora tambem traz mapa curto de arquivos canonicos, portas observadas e comandos operacionais basicos, para reduzir rebootstrap manual.
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
- `quick` sempre le primeiro o snapshot factual autoatualizado em `$HOME/.querobroapp/codex-auto-session-snapshot.md`.
- O launcher versionado resolve o repo pela propria localizacao, reduzindo fragilidade de path hardcoded no bootstrap real.
- O objetivo principal de `quick` e abrir o Codex ja contextualizado e pronto para receber a proxima instrucao, sem ritual de bootstrap longo.
- Sem objetivo explicito, `quick` sincroniza contexto, entrega um resumo curto e fica aguardando silenciosamente a proxima instrucao.
- `quick` assume por padrao que a proxima mensagem tratara de mudancas esteticas, refinamentos de UX, correcoes de bugs ou novas funcionalidades no app.
- `quick` nao deve puxar reboot, subida local, QA pesado ou leitura documental ampla sem necessidade real.
- `reboot` e `qa` existem para o trilho pesado de religar ambiente, subir stack e validar manualmente.
- `ux` existe para uma sessao focada em simplificacao de interface sem puxar o runbook de reboot por padrao.
- O snapshot autoatualizado e a fonte factual principal para branch, worktree, commits recentes, servicos locais e frescor dos docs.
- O snapshot autoatualizado tambem e o mapa principal de launcher, prompts, handoff, portas observadas e comandos basicos.
- Mudou o comportamento de um modo: atualizar primeiro o template `.txt` correspondente, e so depois esta pagina se a orientacao de uso tambem mudou.
