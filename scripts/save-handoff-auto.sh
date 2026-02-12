#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="${HANDOFF_REPO_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

cd "$REPO_DIR"

extract_next_step() {
  local next_step=""

  if [[ -f docs/NEXT_STEP_PLAN.md ]]; then
    next_step="$(awk '
      /^## 6\. Prioridade Da Proxima Etapa/ { in_section=1; next }
      /^## / && in_section { exit }
      in_section && /^[0-9]+\./ {
        sub(/^[0-9]+\.[[:space:]]*/, "", $0)
        print
        exit
      }
    ' docs/NEXT_STEP_PLAN.md)"
  fi

  if [[ -z "$next_step" ]]; then
    next_step="Validar app apos reinicializacao e registrar feedback de navegacao."
  fi

  printf '%s' "$next_step"
}

NEXT_STEP="$(extract_next_step)"
CHANGED_COUNT="$(git status --short | wc -l | tr -d ' ')"

if [[ "$CHANGED_COUNT" == "0" ]]; then
  RESULTADO_AUTO="Entrada automatica registrada sem mudancas locais pendentes."
else
  RESULTADO_AUTO="Entrada automatica registrada com estado atual do repositorio ($CHANGED_COUNT itens no git status)."
fi

env \
  HANDOFF_ORIGEM="Codex Terminal" \
  HANDOFF_DESTINO="ChatGPT Online/Mobile e Codex Terminal/Cloud" \
  HANDOFF_OBJETIVO="Registrar handoff automatico no encerramento da sessao." \
  HANDOFF_RESULTADO="$RESULTADO_AUTO" \
  HANDOFF_PENDENTE="$NEXT_STEP" \
  HANDOFF_DECISOES="Manter bootstrap por documentacao e reduzir dependencia de historico longo no chat." \
  HANDOFF_BLOQUEIOS="nenhum" \
  HANDOFF_PROXIMO_PASSO="$NEXT_STEP" \
  HANDOFF_COMPORTAMENTO="Sem alteracao funcional nesta execucao; somente atualizacao documental automatica." \
  HANDOFF_RISCOS="baixo risco; log pode registrar pendencias genericas se o plano nao estiver atualizado." \
  HANDOFF_COMANDOS="scripts/save-handoff-auto.sh; scripts/save-handoff.sh" \
  HANDOFF_TESTES_OK="nao aplicavel" \
  HANDOFF_TESTES_NAO_EXEC="nao aplicavel (encerramento documental)" \
  HANDOFF_SUPOSICOES="Repositorio local em ~/querobroapp com docs atualizados." \
  ./scripts/save-handoff.sh </dev/null

echo "Handoff automatico concluido."
