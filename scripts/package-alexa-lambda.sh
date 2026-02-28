#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$ROOT_DIR/integrations/alexa/lambda"
OUTPUT_DIR="$ROOT_DIR/output/alexa"
BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/querobroapp-alexa-lambda-XXXXXX")"
ZIP_PATH="$OUTPUT_DIR/querobroapp-alexa-lambda.zip"

cleanup() {
  rm -rf "$BUILD_DIR"
}
trap cleanup EXIT

mkdir -p "$OUTPUT_DIR"

cp "$SOURCE_DIR/package.json" "$BUILD_DIR/package.json"
cp "$SOURCE_DIR/index.mjs" "$BUILD_DIR/index.mjs"

pushd "$BUILD_DIR" >/dev/null
npm install --omit=dev --no-audit --no-fund >/dev/null
zip -qr "$ZIP_PATH" .
popd >/dev/null

echo "Pacote gerado em: $ZIP_PATH"
