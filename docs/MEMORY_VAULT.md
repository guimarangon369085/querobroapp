# MEMORY VAULT - QUEROBROAPP

Ultima atualizacao: 2026-02-11 23:07:49 -03
Escopo: continuidade entre Codex Terminal/Cloud e ChatGPT Online/Mobile

## 1) Realidade de memoria entre plataformas

- ChatGPT Online e ChatGPT Mobile compartilham historico da mesma conta.
- Codex Terminal nao herda automaticamente todo historico do ChatGPT.
- Eu (agente) nao tenho acesso direto ao historico completo da sua conta por conta propria.
- Solucao adotada: contexto persistente em arquivos locais versionaveis no repo.

## 2) Estado local confirmado nesta sessao

- Usuario/sistema: `<usuario_local>` em macOS.
- Repo principal: `$HOME/querobroapp`.
- Branch atual: `main`.
- Remoto principal: `origin https://github.com/<owner>/querobroapp.git`.
- Login Codex CLI: `Logged in using ChatGPT`.
- `OPENAI_API_KEY` em shell: ausente no momento.

## 3) Atalho de abertura do Codex

- Arquivo: `$HOME/Desktop/Abrir Codex.command`
- Conteudo:
  - `#!/bin/zsh`
  - `cd $HOME`
  - `exec $HOME/.npm-global/bin/codex`
- Status: executavel e com icone customizado aplicado no arquivo.

## 4) Copias detectadas do projeto (para evitar confusao)

- `$HOME/querobroapp` (principal em uso)
- `$HOME/Documents/GitHub/querobroapp`
- `$HOME/Downloads/querobroapp`
- `$HOME/Downloads/q_new2/querobroapp`

## 5) Fontes de verdade do contexto

Leitura obrigatoria no inicio de qualquer nova sessao:

1. `docs/querobroapp-context.md`
2. `docs/PROJECT_SNAPSHOT.md`
3. `docs/NEXT_STEP_PLAN.md`
4. `docs/HANDOFF_LOG.md`

Apoio adicional:

- `docs/HANDOFF_TEMPLATE.md`
- `docs/DELIVERY_BACKLOG.md`
- `docs/ARCHITECTURE.md`
- `docs/MVP_FINANCEIRO_E_D+1.md`
- `docs/REPO_SCRAPE_REPORT.md`

## 6) Mapa tecnico rapido

- API: `apps/api` (NestJS + Prisma)
- Web: `apps/web` (Next.js App Router)
- Mobile: `apps/mobile` (Expo)
- Contratos: `packages/shared`
- UI compartilhada: `packages/ui`

Fluxo MVP atual:

1. Cadastro de produtos/sabores.
2. Criacao e gestao de pedidos/itens/status.
3. Pagamentos (parcial/quitacao).
4. Estoque/BOM e quadro de producao D+1.

## 7) Prioridades correntes consolidadas

1. Consolidar `Pedido + Itens + Calculo + Estados`.
2. Fechar regras de `Financeiro` (saldo/parcial/quitacao).
3. Evoluir `D+1` operacional com base em pedidos + BOM.
4. Manter docs e codigo sincronizados no `main`.

## 8) Riscos e pontos de atencao

- Possivel divergencia entre schema Prisma dev e prod.
- Worktree pode estar suja durante iteracao local.
- Nao apagar/reverter alteracoes nao revisadas.

## 9) Procedimento de retomada sem historico

Use exatamente esta sequencia:

1. `cd $HOME/querobroapp`
2. `git branch --show-current && git status --short`
3. Ler `docs/querobroapp-context.md`
4. Ler `docs/NEXT_STEP_PLAN.md`
5. Ler ultima entrada de `docs/HANDOFF_LOG.md`
6. Definir objetivo da sessao em 1 linha
7. Executar trabalho
8. Encerrar com nova entrada no `docs/HANDOFF_LOG.md`

Encerramento recomendado:

- Rodar `./scripts/save-handoff.sh` (ou o atalho Desktop `Salvar Handoff.command`) antes de fechar a sessao.

## 10) Prompt de bootstrap (curto)

```txt
Projeto: querobroapp.
Nao presuma memoria de conversa anterior.
Leia primeiro:
- docs/MEMORY_VAULT.md
- docs/querobroapp-context.md
- docs/NEXT_STEP_PLAN.md
- docs/HANDOFF_LOG.md

Depois continue com este objetivo:
[objetivo em 1 linha]

Antes de encerrar:
- atualizar HANDOFF_LOG com resumo tecnico e proximo passo.
```

## 11) Linha do tempo desta sessao (resumo)

1. Criado atalho de desktop `Abrir Codex.command`.
2. Validado que Codex CLI estava logado com ChatGPT.
3. Validado que `OPENAI_API_KEY` nao estava configurada.
4. Criados docs de continuidade:
   - `docs/querobroapp-context.md`
   - `docs/HANDOFF_TEMPLATE.md`
   - `docs/HANDOFF_LOG.md`
5. Atualizado `README.md` com secao de continuidade.
6. Aplicado icone customizado ao atalho do Codex no Desktop.
7. Criado `scripts/save-handoff.sh` para registrar handoff automaticamente.

## 12) Politica operacional de memoria

- Cada sessao deve gerar handoff.
- Contexto tecnico deve ficar em arquivos do repo (nao apenas no chat).
- O repo deve permanecer como memoria duravel e auditavel.
