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
/** Signed distance to a rounded box centred at (cx, cy) with half sizes hx, hy and corner radius rad. */
function boxDist(x, y, cx, cy, hx, hy, rad) {
  const qx = Math.abs(x - cx) - (hx - rad), qy = Math.abs(y - cy) - (hy - rad);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rad;
}

/**
 * The glyph: an open tray with a card tucked into it (your work, stashed).
 * Returns 'tray', 'card' or null for a point in the 0..1 space.
 */
function glyph(x, y, scale = 1) {
  x = 0.5 + (x - 0.5) / scale;
  y = 0.5 + (y - 0.5) / scale;
  // Tray: the bottom of a rounded box outline, cut off at the rim, with round ends.
  const W = 0.066, rim = 0.488, left = 0.285, right = 0.715, floor = 0.703;
  const outline = Math.abs(boxDist(x, y, 0.5, (rim - 0.2 + floor) / 2, (right - left) / 2, (floor - rim + 0.2) / 2, 0.09));
  const ends = Math.min(Math.hypot(x - left, y - rim), Math.hypot(x - right, y - rim));
  if ((outline < W / 2 && y > rim) || ends < W / 2) return 'tray';
  // Card: a rounded rectangle tilted 9° counter clockwise, sitting inside the tray.
  const cx = 0.5, cy = 0.47, t = (9 * Math.PI) / 180;
  const rx = cx + (x - cx) * Math.cos(t) - (y - cy) * Math.sin(t);
  const ry = cy + (x - cx) * Math.sin(t) + (y - cy) * Math.cos(t);
  if (boxDist(rx, ry, cx, cy, 0.1075, 0.1465, 0.043) < 0) return 'card';
  return null;
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
  const part = glyph(x, y, 1);
  if (part === 'tray') return [255, 250, 239, 1];
  if (part === 'card') return [255, 197, 107, 1];
  // indigo, lighter at the top
  const t = (y - 100 / 1024) / (824 / 1024);
  return [Math.round(108 - 41 * t), Math.round(117 - 43 * t), Math.round(230 - 46 * t), 1];
};
// Menu bar "template" icon: black on transparent; macOS recolors it for light and dark menu bars.
const trayShade = (x, y) => (glyph(x, y, 1.45) ? [0, 0, 0, 1] : null);

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
