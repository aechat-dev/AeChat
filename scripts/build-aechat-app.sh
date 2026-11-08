#!/usr/bin/env bash
#
# Build AeChat.app from the Swift package and bundle the CLI next to it.
# The app is ad-hoc signed; it is not a distribution build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${CONFIG:-release}"
APP="${APP:-$ROOT/dist/AeChat.app}"
CLI_DIST="${CLI_DIST:-$ROOT/dist}"

echo "==> Building CLI"
pnpm --dir "$ROOT" build

# tsc does not copy Markdown; ship the host skill templates explicitly.
rm -rf "$CLI_DIST/skills"
if [ -d "$ROOT/skills" ]; then
  cp -R "$ROOT/skills" "$CLI_DIST/skills"
fi

echo "==> Building Swift app ($CONFIG)"
swift build -c "$CONFIG" --package-path "$ROOT/apps/macos"
BIN_PATH="$(swift build -c "$CONFIG" --package-path "$ROOT/apps/macos" --show-bin-path)"

echo "==> Assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN_PATH/AeChat" "$APP/Contents/MacOS/AeChat"
chmod +x "$APP/Contents/MacOS/AeChat"

# dist/cli/main.js keeps relative imports to ../core, so copy the JS tree but
# never the app bundle itself (APP may live inside CLI_DIST).
mkdir -p "$APP/Contents/Resources/cli"
for entry in cli runtime core adapters contracts index.js index.d.ts index.js.map index.d.ts.map; do
  if [ -e "$CLI_DIST/$entry" ]; then
    cp -R "$CLI_DIST/$entry" "$APP/Contents/Resources/cli/"
  fi
done
chmod +x "$APP/Contents/Resources/cli/cli/main.js"

if [ -d "$CLI_DIST/skills" ]; then
  rm -rf "$APP/Contents/Resources/skills"
  cp -R "$CLI_DIST/skills" "$APP/Contents/Resources/skills"
fi

ICON_SRC="$ROOT/docs/assets/icon.png"
if [ -f "$ICON_SRC" ]; then
  ICONSET="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$ICONSET"
  for size in 16 32 128 256 512; do
    sips -z "$size" "$size" "$ICON_SRC" \
      --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
    sips -z "$((size * 2))" "$((size * 2))" "$ICON_SRC" \
      --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
  done
  iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
  rm -rf "$(dirname "$ICONSET")"
fi

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>AeChat</string>
  <key>CFBundleDisplayName</key><string>AeChat</string>
  <key>CFBundleIdentifier</key><string>local.aechat.app</string>
  <key>CFBundleExecutable</key><string>AeChat</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.0.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST

if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "$APP"
  codesign --verify --deep --strict "$APP"
fi

echo "Built $APP"
