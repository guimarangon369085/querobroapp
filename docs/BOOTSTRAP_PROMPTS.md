# BOOTSTRAP_PROMPTS

## Prompt base para nova sessao

```txt
Projeto: QUEROBROAPP.
Bootstrap minimo inicial:
- docs/PROJECT_SNAPSHOT.md
- docs/NEXT_STEP_PLAN.md
- ultimas 80 linhas de docs/HANDOFF_LOG.md
- `git status --short --branch`

So se a sessao envolver reboot, subida local, QA ou teste manual, leia tambem:
- README.md
- docs/TEST_RESET_PROTOCOL.md

Depois:
1) resuma o estado atual em 3 bullets,
2) liste 3 riscos ativos,
3) confirme se o plano atual ainda vale ou cite apenas desvios visiveis,
4) nao faca perguntas iniciais,
5) trate `docs/HANDOFF_LOG.md` como historico, nao como snapshot atual.

Diretrizes:
- evite pedir comando manual para o usuario quando voce mesmo puder executar,
- se precisar validar o web com o next dev aberto, prefira `pnpm qa:browser-smoke` e `pnpm qa:critical-e2e`,
- nao rode `next build` manual de `apps/web` concorrente ao `next dev` sem necessidade.

No final:
- validar com `pnpm qa:trust` (ou justificar o subset),
- se mexer em fluxo operacional, preferir o gate forte com flags de lint/smoke/browser/critical-e2e,
- registrar handoff em docs/HANDOFF_LOG.md.
```

## Prompt curto para foco em UX

```txt
Objetivo: simplificar UX para usuario leigo com minimo de cliques.
Regras:
- esconder campos avancados por padrao,
- manter regra complexa no backend,
- validar em desktop e mobile width,
- testar o fluxo real em http://127.0.0.1:3000/pedidos,
- entregar checklist de friccao corrigida.
```

## Prompt curto para validacao apos reboot

```txt
Objetivo: reiniciar o ambiente e validar o app manualmente.
Regras:
- usar README.md e docs/TEST_RESET_PROTOCOL.md como runbook,
- subir com ./scripts/dev-all.sh sempre que possivel,
- validar /pedidos, /clientes, /produtos e /estoque,
- se o browser ja estava aberto, considerar hard refresh,
- registrar no handoff o que foi validado de fato.
```
