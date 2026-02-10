#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

msg="${1:-}"
if [[ -z "$msg" ]]; then
  echo "Usage: ./scripts/push-all.sh \"commit message\""
  exit 1
fi

if [[ -z "$(git status --porcelain)" ]]; then
  echo "No changes to commit."
  exit 0
fi

git add -A
git commit -m "$msg"
git push origin main
