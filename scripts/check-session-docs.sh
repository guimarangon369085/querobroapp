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

BOOTSTRAP_DOCS=(
  "docs/BOOTSTRAP_PROMPTS.md"
  "docs/prompts/codex-bootstrap-quick.txt"
  "docs/prompts/codex-bootstrap-reboot.txt"
  "docs/prompts/codex-bootstrap-ux.txt"
  "docs/MEMORY_VAULT.md"
)

RUNBOOK_DOCS=(
  "README.md"
  "docs/TEST_RESET_PROTOCOL.md"
  "docs/MEMORY_VAULT.md"
)

REMOTE_DEPLOY_DOCS=(
  "docs/RAILWAY_DEPLOY.md"
  "docs/PROJECT_SNAPSHOT.md"
  "docs/NEXT_STEP_PLAN.md"
)

PROCESS_DOCS=(
  "docs/MEMORY_VAULT.md"
  "docs/HANDOFF_TEMPLATE.md"
  "docs/BOOTSTRAP_PROMPTS.md"
)

has_non_doc_change=0
has_current_state_update=0
has_bootstrap_update=0
has_runbook_update=0
has_remote_deploy_update=0
has_process_update=0
needs_bootstrap_docs=0
needs_runbook_docs=0
needs_remote_deploy_docs=0
needs_process_docs=0

contains_file() {
  local needle="$1"
  shift

  local candidate
  for candidate in "$@"; do
    if [[ "$candidate" == "$needle" ]]; then
      return 0
    fi
  done

  return 1
}

for file in "${STAGED_FILES[@]}"; do
  [[ -z "$file" ]] && continue

  if [[ "$file" != docs/* ]]; then
    has_non_doc_change=1
  fi

  if contains_file "$file" "${CURRENT_STATE_DOCS[@]}"; then
    has_current_state_update=1
  fi

  if contains_file "$file" "${BOOTSTRAP_DOCS[@]}"; then
    has_bootstrap_update=1
  fi

  if contains_file "$file" "${RUNBOOK_DOCS[@]}"; then
    has_runbook_update=1
  fi

  if contains_file "$file" "${REMOTE_DEPLOY_DOCS[@]}"; then
    has_remote_deploy_update=1
  fi

  if contains_file "$file" "${PROCESS_DOCS[@]}"; then
    has_process_update=1
  fi

  case "$file" in
    scripts/abrir-codex.command | \
    scripts/install-desktop-launchers.sh | \
    scripts/refresh-codex-context.sh | \
    scripts/relearn-context.sh | \
    docs/prompts/*)
      needs_bootstrap_docs=1
      ;;
    scripts/dev-all.sh | \
    scripts/stop-all.sh | \
    scripts/preflight-local.sh | \
    scripts/qa.sh | \
    scripts/qa-smoke.mjs | \
    scripts/qa-browser-smoke.sh | \
    scripts/qa-critical-e2e.mjs | \
    scripts/qa-trust.mjs)
      needs_runbook_docs=1
      ;;
    scripts/railway-api-entrypoint.sh | \
    scripts/start-public-web-tunnel.sh | \
    scripts/stop-public-web-tunnel.sh | \
    scripts/google-form-bridge.gs | \
    scripts/google-form-bridge-payload.mjs | \
    scripts/test-google-form-bridge.mjs | \
    scripts/validate-public-deploy.mjs | \
    scripts/validate-delivery-quote.mjs)
      needs_remote_deploy_docs=1
      ;;
    scripts/check-session-docs.sh | \
    scripts/save-handoff.sh | \
    scripts/save-handoff-auto.sh)
      needs_process_docs=1
      ;;
  esac
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

if [[ "$needs_bootstrap_docs" -eq 1 && "$has_bootstrap_update" -eq 0 ]]; then
  echo "Mudancas no bootstrap/launcher detectadas sem atualizar a documentacao correspondente."
  echo "Atualize ao menos um destes arquivos antes do commit:"
  for doc in "${BOOTSTRAP_DOCS[@]}"; do
    echo " - $doc"
  done
  exit 1
fi

if [[ "$needs_runbook_docs" -eq 1 && "$has_runbook_update" -eq 0 ]]; then
  echo "Mudancas em reboot/QA detectadas sem atualizar o runbook correspondente."
  echo "Atualize ao menos um destes arquivos antes do commit:"
  for doc in "${RUNBOOK_DOCS[@]}"; do
    echo " - $doc"
  done
  exit 1
fi

if [[ "$needs_remote_deploy_docs" -eq 1 && "$has_remote_deploy_update" -eq 0 ]]; then
  echo "Mudancas em deploy publico/canal externo detectadas sem atualizar a documentacao remota."
  echo "Atualize ao menos um destes arquivos antes do commit:"
  for doc in "${REMOTE_DEPLOY_DOCS[@]}"; do
    echo " - $doc"
  done
  exit 1
fi

if [[ "$needs_process_docs" -eq 1 && "$has_process_update" -eq 0 ]]; then
  echo "Mudancas no processo de handoff/docs detectadas sem atualizar a documentacao do proprio processo."
  echo "Atualize ao menos um destes arquivos antes do commit:"
  for doc in "${PROCESS_DOCS[@]}"; do
    echo " - $doc"
  done
  exit 1
fi
