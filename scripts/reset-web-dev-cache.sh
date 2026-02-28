#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"

rm -rf "$WEB_DIR/.next" "$WEB_DIR/.turbo"
rm -f "$WEB_DIR/tsconfig.tsbuildinfo"

echo "apps/web cache limpo (.next, .turbo, tsconfig.tsbuildinfo)."
