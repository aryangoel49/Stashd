// Draws the app icon and the menu bar icon as PNG files, then builds icon.icns with macOS iconutil.
// No image libraries needed. Run with: npm run icons

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const assets = path.join(root, 'assets');

// ---------- tiny PNG writer ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------- shapes, in a 0..1 coordinate space ----------
/**
 * The glyph: a geometric S made of two stacked half-pills (two pieces of work, stashed).
 * Measured in 1024ths of the canvas; `gap` widens the slit between the blocks for tiny sizes.
 */
function glyph(x, y, scale = 1, gap = 24) {
  x = (0.5 + (x - 0.5) / scale) * 1024;
  y = (0.5 + (y - 0.5) / scale) * 1024;
  const h = 164, r = h / 2, w = 336, shift = 30;
  const topY = 512 - gap / 2 - h, botY = 512 + gap / 2;
  // Top block: round on the left, nudged right.
  const tl = 512 - w / 2 + shift;
  if (y >= topY && y <= topY + h && ((x >= tl + r && x <= tl + w) || Math.hypot(x - (tl + r), y - (topY + r)) <= r)) return true;
  // Bottom block: round on the right, nudged left.
  const bl = 512 - w / 2 - shift;
  if (y >= botY && y <= botY + h && ((x >= bl && x <= bl + w - r) || Math.hypot(x - (bl + w - r), y - (botY + r)) <= r)) return true;
  return false;
}

function roundedSquare(x, y) {
  // macOS-style icon tile: 824/1024 of the canvas, corner radius about 22%.
  const m = 100 / 1024, s = 1 - 2 * m, rad = 0.225 * s;
  const qx = Math.abs(x - 0.5) - (s / 2 - rad), qy = Math.abs(y - 0.5) - (s / 2 - rad);
  const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
  return d < 0;
}

function render(size, shade) {
  const buf = Buffer.alloc(size * size * 4);
  const N = 4; // supersampling for smooth edges
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const c = shade((px + (sx + 0.5) / N) / size, (py + (sy + 0.5) / N) / size);
          if (c) {
            r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
          }
        }
      }
      const i = (py * size + px) * 4;
      const n = N * N;
      buf[i + 3] = Math.round((a / n) * 255);
      if (a > 0) {
        buf[i] = Math.round(r / a);
        buf[i + 1] = Math.round(g / a);
        buf[i + 2] = Math.round(b / a);
      }
    }
  }
  return buf;
}

const appShade = (x, y) => {
  if (!roundedSquare(x, y)) return null;
  if (glyph(x, y, 1)) return [255, 255, 255, 1];
  // near black, a touch lighter at the top
  const t = (y - 100 / 1024) / (824 / 1024);
  return [Math.round(38 - 26 * t), Math.round(38 - 26 * t), Math.round(44 - 29 * t), 1];
};
// Menu bar "template" icon: black on transparent; macOS recolors it for light and dark menu bars.
const trayShade = (x, y) => (glyph(x, y, 1.6, 64) ? [0, 0, 0, 1] : null);

// ---------- write files ----------
mkdirSync(path.join(assets, 'tray'), { recursive: true });
writeFileSync(path.join(assets, 'tray', 'trayTemplate.png'), png(18, render(18, trayShade)));
writeFileSync(path.join(assets, 'tray', 'trayTemplate@2x.png'), png(36, render(36, trayShade)));
writeFileSync(path.join(assets, 'icon.png'), png(1024, render(1024, appShade)));

const iconset = path.join(assets, 'icon.iconset');
rmSync(iconset, { recursive: true, force: true });
mkdirSync(iconset);
for (const s of [16, 32, 128, 256, 512]) {
  writeFileSync(path.join(iconset, `icon_${s}x${s}.png`), png(s, render(s, appShade)));
  writeFileSync(path.join(iconset, `icon_${s}x${s}@2x.png`), png(s * 2, render(s * 2, appShade)));
}
if (process.platform === 'darwin') {
  execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(assets, 'icon.icns')]);
  rmSync(iconset, { recursive: true, force: true });
  console.log('Wrote assets/icon.icns, assets/icon.png and assets/tray/*.png');
} else {
  console.log('Wrote PNGs. icon.icns needs macOS (iconutil).');
}
