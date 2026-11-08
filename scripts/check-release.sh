#!/bin/bash
# Before publishing a release: every built Stashd must be signed with the "Stashd Local Signing" certificate.
# A build without it can't update people's copies (the updater refuses it) and makes them approve Stashd's
# permissions again. Run after `npm run make` and `npm run make:intel`: npm run check:release
set -euo pipefail
cd "$(dirname "$0")/.."
found=0
for app in out/Stashd-darwin-*/Stashd.app; do
  [ -d "$app" ] || continue
  found=1
  codesign --verify --deep --strict "$app"
  req=$(codesign -d -r- "$app" 2>&1 | grep 'designated =>' || true)
  if ! grep -q 'certificate root' <<<"$req"; then
    echo "✗ $app is not signed with the Stashd certificate. Don't publish it."
    echo "  (Is \"Stashd Local Signing\" in this Mac's Keychain?)"
    exit 1
  fi
  echo "✓ $app: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$app/Contents/Info.plist"), signed with the Stashd certificate"
done
[ "$found" = 1 ] || { echo "No builds in out/. Run npm run make and npm run make:intel first."; exit 1; }
