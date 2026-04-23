#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

LEGACY_DB="$ROOT_DIR/apps/api/dev.db"
CANONICAL_DB="$ROOT_DIR/apps/api/prisma/dev.db"

if [[ -f "$LEGACY_DB" && -f "$CANONICAL_DB" ]]; then
  LEGACY_SIZE="$(stat -f '%z' "$LEGACY_DB")"
  CANONICAL_SIZE="$(stat -f '%z' "$CANONICAL_DB")"

  if [[ "$LEGACY_SIZE" -eq 0 && "$CANONICAL_SIZE" -gt 0 ]]; then
    rm -f "$LEGACY_DB"
    echo "SQLite local saneado: removido apps/api/dev.db vazio; banco canonico permanece em apps/api/prisma/dev.db."
    exit 0
  fi
fi

if [[ -f "$LEGACY_DB" ]]; then
  echo "WARN: apps/api/dev.db ainda existe. O SQLite canonico do projeto fica em apps/api/prisma/dev.db." >&2
fi
