#!/usr/bin/env bash
set -euo pipefail

SRC_DIR="${1:-${QBAPP_BRAND_SOURCE:-/Users/gui/Desktop/@QUEROBROAPP DOCS/QBAPP_MAGENS}}"
OUT_DIR="${2:-apps/web/public/querobroa/brand}"

mkdir -p "$OUT_DIR"

log() {
  printf '%s\n' "$1"
}

convert_heic() {
  local src="$1"
  local dest="$2"

  if command -v sips >/dev/null 2>&1; then
    sips -s format jpeg -s formatOptions 85 "$src" --out "$dest" >/dev/null
    return 0
  fi

  if command -v magick >/dev/null 2>&1; then
    magick "$src" -quality 85 "$dest"
    return 0
  fi

  if command -v convert >/dev/null 2>&1; then
    convert "$src" -quality 85 "$dest"
    return 0
  fi

  log "[warn] conversor HEIC indisponivel para: $src"
  return 1
}

optimize_jpg() {
  local src="$1"
  local tmp="${src}.tmp.jpg"

  if command -v sips >/dev/null 2>&1; then
    sips -s format jpeg -s formatOptions 82 -Z 2200 "$src" --out "$tmp" >/dev/null
    mv "$tmp" "$src"
    return 0
  fi

  if command -v magick >/dev/null 2>&1; then
    magick "$src" -resize '2200x2200>' -quality 82 "$tmp"
    mv "$tmp" "$src"
    return 0
  fi

  if command -v convert >/dev/null 2>&1; then
    convert "$src" -resize '2200x2200>' -quality 82 "$tmp"
    mv "$tmp" "$src"
    return 0
  fi

  return 1
}

log "Fonte: $SRC_DIR"
log "Destino: $OUT_DIR"

if [ ! -d "$SRC_DIR" ]; then
  log "[error] diretorio de origem nao encontrado: $SRC_DIR"
  exit 1
fi

converted_count=0
copied_count=0
extracted_count=0
optimized_count=0

shopt -s nullglob
for heic in "$SRC_DIR"/IMG_09*.HEIC "$SRC_DIR"/IMG_09*.heic; do
  base="$(basename "$heic")"
  base="${base%.*}"
  dest="$OUT_DIR/$base.jpg"
  if convert_heic "$heic" "$dest"; then
    converted_count=$((converted_count + 1))
  fi
done
shopt -u nullglob

if [ -f "$SRC_DIR/IMG_1318.jpg" ]; then
  cp "$SRC_DIR/IMG_1318.jpg" "$OUT_DIR/IMG_1318.jpg"
  copied_count=$((copied_count + 1))
fi

ZIP_FILE="$SRC_DIR/FOTOS_QUEROBROA.zip"
if [ -f "$ZIP_FILE" ]; then
  unzip -j -o "$ZIP_FILE" "TRATADAS/FINAL_Quero Broa0109.jpg" -d "$OUT_DIR" >/dev/null || true
  unzip -j -o "$ZIP_FILE" "TRATADAS/FINAL_Quero Broa0129.jpg" -d "$OUT_DIR" >/dev/null || true
  unzip -j -o "$ZIP_FILE" "TRATADAS/FINAL_Quero Broa060.jpg" -d "$OUT_DIR" >/dev/null || true

  shopt -s nullglob
  for raw in "$OUT_DIR"/FINAL_Quero\ Broa*.jpg; do
    safe_name="$(basename "$raw")"
    safe_name="${safe_name// /_}"
    if [ "$raw" != "$OUT_DIR/$safe_name" ]; then
      mv "$raw" "$OUT_DIR/$safe_name"
      extracted_count=$((extracted_count + 1))
    fi
  done
  shopt -u nullglob
fi

shopt -s nullglob
for jpg in "$OUT_DIR"/*.jpg "$OUT_DIR"/*.jpeg "$OUT_DIR"/*.JPG "$OUT_DIR"/*.JPEG; do
  if optimize_jpg "$jpg"; then
    optimized_count=$((optimized_count + 1))
  fi
done
shopt -u nullglob

log "HEIC convertidos: $converted_count"
log "JPG copiados: $copied_count"
log "Fotos tratadas extraidas: $extracted_count"
log "JPG otimizados: $optimized_count"
log "Sincronizacao concluida."
