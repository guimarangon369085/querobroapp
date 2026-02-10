#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_DIR="${1:-/tmp/querobroa_photos/TRATADAS}"
DEST_DIR="$ROOT/apps/web/public/querobroa"

mkdir -p "$DEST_DIR"

files=(
  "FINAL_Quero Broa0010 copy.jpg"
  "FINAL_Quero Broa0021 copy.jpg"
  "FINAL_Quero Broa0035 copy.jpg"
  "FINAL_Quero Broa0074.jpg"
)

out=(
  "hero-01.jpg"
  "hero-02.jpg"
  "hero-03.jpg"
  "hero-04.jpg"
)

for i in "${!files[@]}"; do
  src="$SRC_DIR/${files[$i]}"
  dst="$DEST_DIR/${out[$i]}"
  sips -Z 1600 "$src" --out "$dst" >/dev/null
  echo "Wrote: $dst"
 done

ls -la "$DEST_DIR"
