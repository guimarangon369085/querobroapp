#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# shellcheck source=./scripts/runtime-path.sh
source "$ROOT_DIR/scripts/runtime-path.sh"
setup_runtime_path

PNPM_BIN="$(command -v pnpm || true)"

if [[ -z "$PNPM_BIN" ]]; then
  echo "pnpm nao encontrado no PATH."
  exit 1
fi

echo "== Querobroapp Preflight =="
echo "Repo: $ROOT_DIR"
echo "Branch: $(git branch --show-current)"
echo "Commit: $(git rev-parse --short HEAD)"
echo "Node: $(node -v)"
echo "pnpm: $("$PNPM_BIN" -v)"

if command -v shasum >/dev/null 2>&1; then
  echo "Lockfile SHA256: $(LC_ALL=C shasum -a 256 pnpm-lock.yaml | awk '{print $1}')"
elif command -v openssl >/dev/null 2>&1; then
  echo "Lockfile SHA256: $(openssl dgst -sha256 pnpm-lock.yaml | awk '{print $2}')"
fi

if git remote get-url origin >/dev/null 2>&1; then
  git fetch origin --prune >/dev/null 2>&1 || true
  if git show-ref --verify --quiet refs/remotes/origin/main; then
    AHEAD_BEHIND="$(git rev-list --left-right --count HEAD...origin/main)"
    AHEAD="$(echo "$AHEAD_BEHIND" | awk '{print $1}')"
    BEHIND="$(echo "$AHEAD_BEHIND" | awk '{print $2}')"
    echo "Branch delta vs origin/main: ahead=$AHEAD behind=$BEHIND"
  fi
fi

if [[ -f ".nvmrc" ]]; then
  REQUIRED_NODE_MAJOR="$(tr -d '[:space:]' < .nvmrc)"
  CURRENT_NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$CURRENT_NODE_MAJOR" != "$REQUIRED_NODE_MAJOR" ]]; then
    echo "WARN: .nvmrc=$REQUIRED_NODE_MAJOR, mas Node atual=$CURRENT_NODE_MAJOR."
  fi
fi

if [[ -f "apps/api/.env.example" && -f "apps/api/.env" ]]; then
  MISSING_API_KEYS="$(
    comm -23 \
      <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' apps/api/.env.example | cut -d= -f1 | sort -u) \
      <(grep -E '^[A-Za-z_][A-Za-z0-9_]*=' apps/api/.env | cut -d= -f1 | sort -u)
  )"
  if [[ -n "$MISSING_API_KEYS" ]]; then
    echo "WARN: chaves ausentes em apps/api/.env (comparado ao .env.example):"
    while IFS= read -r key; do
      [[ -z "$key" ]] && continue
      echo "  - $key"
    done <<< "$MISSING_API_KEYS"
  fi
fi

echo
echo "1) Dependencias travadas"
"$PNPM_BIN" install --frozen-lockfile

echo
echo "2) Prisma drift"
"$PNPM_BIN" check:prisma-drift

echo
echo "3) Typecheck (workspace)"
"$PNPM_BIN" typecheck

echo
echo "4) Lint (workspace)"
"$PNPM_BIN" lint

echo
echo "5) Build CI (api + web + shared + ui)"
"$PNPM_BIN" build:ci

echo
echo "6) Testes"
"$PNPM_BIN" test

echo
echo "7) Smoke API (se online)"
if node -e "fetch('http://127.0.0.1:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));"; then
  "$PNPM_BIN" qa:smoke
else
  echo "INFO: API offline em http://127.0.0.1:3001. Smoke pulado."
fi

echo
echo "Preflight concluido com sucesso."
