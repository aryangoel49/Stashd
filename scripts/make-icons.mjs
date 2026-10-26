// Builds the app icon and the menu bar icon from the brand SVGs (the sleepy folder):
//   assets/brand/stashd-icon.svg -> assets/icon.png and assets/icon.icns
//   assets/brand/stashd-tray-awake.svg -> assets/tray/trayTemplate.png (+ @2x), the menu bar icon
//   assets/brand/stashd-tray.svg -> assets/tray/trayBlinkTemplate.png (+ @2x), its blink
// Rendering uses macOS itself (scripts/render-svg.swift), so no image libraries are needed.
// Run with: npm run icons (macOS only)

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');
const icon = path.join(assets, 'brand', 'stashd-icon.svg');
const tray = path.join(assets, 'brand', 'stashd-tray-awake.svg');
const blink = path.join(assets, 'brand', 'stashd-tray.svg');

const tmp = mkdtempSync(path.join(tmpdir(), 'stashd-icons-'));
const renderer = path.join(tmp, 'render-svg');
execFileSync('xcrun', ['swiftc', '-O', path.join(root, 'scripts', 'render-svg.swift'), '-o', renderer], { stdio: 'inherit' });
const render = (svg, size, out) => execFileSync(renderer, [svg, String(size), out]);

mkdirSync(path.join(assets, 'tray'), { recursive: true });
render(tray, 18, path.join(assets, 'tray', 'trayTemplate.png'));
render(tray, 36, path.join(assets, 'tray', 'trayTemplate@2x.png'));
render(blink, 18, path.join(assets, 'tray', 'trayBlinkTemplate.png'));
render(blink, 36, path.join(assets, 'tray', 'trayBlinkTemplate@2x.png'));
render(icon, 1024, path.join(assets, 'icon.png'));

const iconset = path.join(tmp, 'icon.iconset');
mkdirSync(iconset);
for (const s of [16, 32, 128, 256, 512]) {
  render(icon, s, path.join(iconset, `icon_${s}x${s}.png`));
  render(icon, s * 2, path.join(iconset, `icon_${s}x${s}@2x.png`));
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'icon.icns')]);
rmSync(tmp, { recursive: true, force: true });
console.log('Wrote assets/icon.icns, assets/icon.png and assets/tray/*.png');
