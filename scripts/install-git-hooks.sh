#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

git config core.hooksPath .githooks
chmod +x .githooks/pre-commit

echo "Git hooks enabled via core.hooksPath=.githooks"
echo "Pre-commit secret guard is now active."
