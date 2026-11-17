#!/usr/bin/env bash
# Publica uma versão nova do Quill para a atualização automática (roda no Mac).
#   1. monta o app assinado com a chave de atualização (~/.tauri/quill-updater.key);
#   2. cria o latest.json que o app consulta;
#   3. publica tudo como uma release no GitHub (viannaanalyst/quill), com o .dmg para instalar do zero.
# Uso: scripts/release-mac.sh "o que mudou nesta versão"
set -euo pipefail
cd "$(dirname "$0")/.."

KEY="${QUILL_UPDATER_KEY:-$HOME/.tauri/quill-updater.key}"
PASS_FILE="${QUILL_UPDATER_PASS:-$HOME/.tauri/quill-updater.pass}"
REPO="viannaanalyst/quill"
NOTES="${1:-Melhorias e correções.}"

[ -f "$KEY" ] || { echo "Falta a chave de atualização em $KEY"; exit 1; }
command -v gh >/dev/null || { echo "Falta o gh (GitHub CLI): brew install gh && gh auth login"; exit 1; }

VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
TAG="v$VERSION"
if gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "A versão $TAG já foi publicada. Aumente a versão em package.json, src-tauri/tauri.conf.json e src-tauri/Cargo.toml."
  exit 1
fi

export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$( [ -f "$PASS_FILE" ] && cat "$PASS_FILE" || echo "")"
npm ci
npm run tauri build

BUNDLE=src-tauri/target/release/bundle
TARBALL="$BUNDLE/macos/Quill.app.tar.gz"
SIG="$TARBALL.sig"
DMG=$(ls "$BUNDLE"/dmg/*.dmg | head -1)
[ -f "$TARBALL" ] && [ -f "$SIG" ] || { echo "Não achei $TARBALL e a assinatura .sig"; exit 1; }

# nome sem espaço, para o endereço de download
cp "$TARBALL" "$BUNDLE/macos/Quill-$VERSION-aarch64.app.tar.gz"
OUT=$(mktemp -d)
node -e '
const fs = require("fs");
const [version, notes, sig, url, out] = process.argv.slice(1);
fs.writeFileSync(out + "/latest.json", JSON.stringify({
  version, notes, pub_date: new Date().toISOString(),
  platforms: { "darwin-aarch64": { signature: fs.readFileSync(sig, "utf8").trim(), url } },
}, null, 2));
' "$VERSION" "$NOTES" "$SIG" "https://github.com/$REPO/releases/download/$TAG/Quill-$VERSION-aarch64.app.tar.gz" "$OUT"

gh release create "$TAG" --repo "$REPO" --title "Quill $VERSION" --notes "$NOTES" \
  "$BUNDLE/macos/Quill-$VERSION-aarch64.app.tar.gz" "$OUT/latest.json" "$DMG"
echo "Publicado: https://github.com/$REPO/releases/tag/$TAG"
