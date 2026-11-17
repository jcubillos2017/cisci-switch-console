#!/usr/bin/env bash
# Genera el .dmg y el .zip en una Mac (mismo flujo que .github/workflows/build.yml).
# Uso: ./build-mac.sh [arm64|x64]   (por defecto, la arquitectura de esta Mac)
set -euo pipefail

cd "$(dirname "$0")"

ARCH="${1:-$(uname -m)}"
[ "$ARCH" = "x86_64" ] && ARCH="x64"
if [ "$ARCH" != "arm64" ] && [ "$ARCH" != "x64" ]; then
  echo "Arquitectura no soportada: $ARCH (use arm64 o x64)" >&2
  exit 1
fi

export CSC_IDENTITY_AUTO_DISCOVERY=false

npm ci --ignore-scripts

# 1. Empaquetar la .app sin firma.
npx electron-builder --mac dir --"$ARCH" --publish never -c.mac.identity=null

# 2. Firma ad-hoc: evita el aviso de app "danada" en Apple Silicon.
APP="$(find dist -maxdepth 2 -name '*.app' -type d | head -n 1)"
codesign --force --deep --sign - "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

# 3. Crear .dmg y .zip a partir de la .app firmada.
npx electron-builder --mac dmg zip --"$ARCH" --publish never -c.mac.identity=null --prepackaged "$APP"

echo "Instaladores macOS ($ARCH) generados en ./dist"
