#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "${SKIP_SESSION_DOCS_GUARD:-0}" == "1" ]]; then
  exit 0
fi

STAGED_FILES=()
while IFS= read -r file; do
  STAGED_FILES+=("$file")
done < <(git diff --cached --name-only --diff-filter=ACMR)

if [[ "${#STAGED_FILES[@]}" -eq 0 ]]; then
  exit 0
fi

CURRENT_STATE_DOCS=(
  "docs/NEXT_STEP_PLAN.md"
  "docs/PROJECT_SNAPSHOT.md"
  "docs/querobroapp-context.md"
  "docs/MEMORY_VAULT.md"
)

has_non_doc_change=0
has_current_state_update=0

for file in "${STAGED_FILES[@]}"; do
  [[ -z "$file" ]] && continue

  if [[ "$file" != docs/* ]]; then
    has_non_doc_change=1
  fi

  for doc in "${CURRENT_STATE_DOCS[@]}"; do
    if [[ "$file" == "$doc" ]]; then
      has_current_state_update=1
      break
    fi
  done
done

if [[ "$has_non_doc_change" -eq 1 && "$has_current_state_update" -eq 0 ]]; then
  echo "Mudancas de codigo detectadas sem atualizar uma fonte de verdade atual."
  echo "Atualize ao menos um destes arquivos antes do commit:"
  for doc in "${CURRENT_STATE_DOCS[@]}"; do
    echo " - $doc"
  done
  echo "O HANDOFF_LOG sozinho nao basta, porque ele e apenas historico."
  echo "Se for apenas um commit tecnico temporario, use SKIP_SESSION_DOCS_GUARD=1 por sua conta e risco."
  exit 1
fi
