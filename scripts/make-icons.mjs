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
const TAU = Math.PI * 2;
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function inTriangle(px, py, [a, b, c]) {
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const p = [px, py];
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** The glyph: a clock face whose ring is an arrow turning back (counter clockwise), with two hands. */
function glyph(x, y, scale = 1) {
  const cx = 0.5, cy = 0.5;
  const R = 0.3 * scale, W = 0.065 * scale;
  const dx = x - cx, dy = y - cy;
  const r = Math.hypot(dx, dy);
  // angle measured clockwise from 12 o'clock
  let a = Math.atan2(dx, -dy);
  if (a < 0) a += TAU;
  const gapStart = TAU * 0.83, gapEnd = TAU * 0.97;
  const onRing = Math.abs(r - R) < W / 2 && !(a > gapStart && a < gapEnd);
  // Arrowhead at the start of the gap, pointing counter clockwise (toward the gap).
  const ang = gapStart;
  const px = cx + Math.sin(ang) * R, py = cy - Math.cos(ang) * R;
  const tx = Math.cos(ang), ty = Math.sin(ang); // clockwise tangent
  const nx = Math.sin(ang), ny = -Math.cos(ang); // outward normal
  const head = 0.11 * scale;
  const tri = [
    [px + nx * head * 0.85, py + ny * head * 0.85],
    [px - nx * head * 0.85, py - ny * head * 0.85],
    [px - tx * head * 1.05, py - ty * head * 1.05],
  ];
  const onHead = inTriangle(x, y, tri);
  const hand1 = segDist(x, y, cx, cy, cx, cy - R * 0.62) < W / 2;
  const hand2 = segDist(x, y, cx, cy, cx - R * 0.45, cy + R * 0.12) < W / 2;
  return onRing || onHead || hand1 || hand2;
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
  if (glyph(x, y, 1)) return [255, 250, 238, 1];
  // pine green, lighter at the top
  const t = y;
  return [Math.round(52 - 22 * t), Math.round(126 - 44 * t), Math.round(106 - 36 * t), 1];
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
