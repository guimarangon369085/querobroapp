#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
DEFAULT_BASE="${1:-main}"

if [ "$CURRENT_BRANCH" = "$DEFAULT_BASE" ]; then
  echo "Voce esta em '$DEFAULT_BASE'. Troque para uma branch de trabalho antes de abrir PR."
  exit 1
fi

REMOTE_URL="$(git remote get-url origin)"
if [[ "$REMOTE_URL" =~ ^git@github\.com:(.*)\.git$ ]]; then
  REPO_PATH="${BASH_REMATCH[1]}"
  HTTPS_BASE="https://github.com/${REPO_PATH}"
elif [[ "$REMOTE_URL" =~ ^https://github\.com/(.*)\.git$ ]]; then
  REPO_PATH="${BASH_REMATCH[1]}"
  HTTPS_BASE="https://github.com/${REPO_PATH}"
else
  echo "Nao foi possivel interpretar o remote origin: $REMOTE_URL"
  exit 1
fi

PR_URL="${HTTPS_BASE}/compare/${DEFAULT_BASE}...${CURRENT_BRANCH}?expand=1"

echo "Link de PR:"
echo "$PR_URL"

if command -v open >/dev/null 2>&1; then
  open "$PR_URL"
fi
