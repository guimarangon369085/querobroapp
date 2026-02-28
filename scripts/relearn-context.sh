#!/bin/zsh
set -euo pipefail

REPO_DIR="$HOME/querobroapp"

cd "$REPO_DIR"

echo "=== QUEROBROAPP RELEARN CONTEXT ==="
echo "Repo: $REPO_DIR"
echo "Data: $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo

echo "=== GIT ==="
echo "Branch: $(git branch --show-current)"
echo "Remoto:"
git remote -v | sed -n '1,4p'
echo
echo "Worktree (curto):"
git status --short | sed -n '1,40p'
echo

echo "=== ARQUIVOS DE CONTEXTO (obrigatorios) ==="
printf '%s\n' \
  "docs/MEMORY_VAULT.md" \
  "docs/querobroapp-context.md" \
  "docs/NEXT_STEP_PLAN.md" \
  "docs/HANDOFF_LOG.md"
echo

echo "=== HANDOFF_LOG COMPLETO ==="
cat docs/HANDOFF_LOG.md
echo

echo "=== PROXIMO PASSO ==="
echo "1) Defina objetivo em 1 linha."
echo "2) Execute mudancas."
echo "3) Registre nova entrada em docs/HANDOFF_LOG.md."
