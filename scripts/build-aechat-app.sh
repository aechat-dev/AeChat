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
for entry in cli app core adapters contracts index.js index.d.ts index.js.map index.d.ts.map; do
  if [ -e "$CLI_DIST/$entry" ]; then
    cp -R "$CLI_DIST/$entry" "$APP/Contents/Resources/cli/"
  fi
done
chmod +x "$APP/Contents/Resources/cli/cli/main.js"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>AeChat</string>
  <key>CFBundleDisplayName</key><string>AeChat</string>
  <key>CFBundleIdentifier</key><string>local.aechat.app</string>
  <key>CFBundleExecutable</key><string>AeChat</string>
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
