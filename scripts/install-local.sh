#!/bin/bash
# Builds Stashd from this checkout, replaces the copy in /Applications, and opens it,
# so Aryan sees every change in his real app right away. Run with: npm run install-local
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.local/node/bin:$PATH"

npm run package --silent
app=$(ls -d out/Stashd-darwin-*/Stashd.app | head -1)
codesign --verify --deep --strict "$app"

# Quit the running copy gently, then wait for it to close.
osascript -e 'tell application id "com.aryangoel.stashd" to quit' >/dev/null 2>&1 || true
for _ in $(seq 1 20); do pgrep -f "/Applications/Stashd.app/" >/dev/null || break; sleep 0.5; done
pkill -f "/Applications/Stashd.app/" 2>/dev/null || true

rm -rf /Applications/Stashd.app
ditto "$app" /Applications/Stashd.app
open /Applications/Stashd.app
echo "Installed and opened Stashd $(node -p "require('./package.json').version")"
