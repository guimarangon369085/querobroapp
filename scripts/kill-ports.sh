#!/usr/bin/env bash
set -euo pipefail
lsof -tiTCP:3000 -sTCP:LISTEN | xargs -r kill -9 || true
lsof -tiTCP:3001 -sTCP:LISTEN | xargs -r kill -9 || true
lsof -tiTCP:8081 -sTCP:LISTEN | xargs -r kill -9 || true
echo "Ports 3000/3001/8081 cleared."
