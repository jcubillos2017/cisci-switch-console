#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

export CSC_IDENTITY_AUTO_DISCOVERY=false

npm install
npm run dist:mac

echo "Instalador macOS generado en ./dist"
