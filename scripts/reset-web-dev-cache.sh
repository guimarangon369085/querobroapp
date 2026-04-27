#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"

rm -rf "$WEB_DIR/.next" "$WEB_DIR/.next-ops-local" "$WEB_DIR/.next-amigas-lab" "$WEB_DIR/.turbo"
rm -f "$WEB_DIR/tsconfig.tsbuildinfo"

echo "apps/web cache limpo (.next, .next-ops-local, .next-amigas-lab, .turbo, tsconfig.tsbuildinfo)."
