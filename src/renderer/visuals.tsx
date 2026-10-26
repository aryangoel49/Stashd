// How things look at a glance: every folder gets its own colour, and every tab, file and app gets a
// badge that says what it is (a site's letter in its colour, a file's type, Finder blue for folders).
// No network: site badges are drawn, not downloaded favicons.

import type { CSSProperties } from 'react';
import type { Item } from '../shared/types';
import { motion } from './ui';

// ---------- folder colours ----------

export interface Tone {
  name: string;
  /** The folder tile. */
  tile: string;
  /** The folder's back flap, a lighter shade. */
  flap: string;
  /** Soft wash for cards and rows. */
  soft: string;
  /** Hairline in the tone. */
  line: string;
  /** Text in the tone that stays readable on white. */
  ink: string;
}

const TONES: Tone[] = [
  { name: 'Butter', tile: '#F2CD5C', flap: '#FBEFC6', soft: 'rgba(242, 205, 92, 0.2)', line: 'rgba(201, 158, 30, 0.42)', ink: '#8a6200' },
  { name: 'Coral', tile: '#F4997F', flap: '#FDE1D8', soft: 'rgba(244, 153, 127, 0.18)', line: 'rgba(214, 100, 70, 0.4)', ink: '#a8432a' },
  { name: 'Sky', tile: '#86BEF0', flap: '#DCEEFD', soft: 'rgba(134, 190, 240, 0.2)', line: 'rgba(70, 140, 210, 0.4)', ink: '#1f5f9e' },
  { name: 'Mint', tile: '#82D1AE', flap: '#D9F4E7', soft: 'rgba(130, 209, 174, 0.2)', line: 'rgba(60, 160, 115, 0.4)', ink: '#1f7a52' },
  { name: 'Lavender', tile: '#B6A4F0', flap: '#ECE6FD', soft: 'rgba(182, 164, 240, 0.2)', line: 'rgba(125, 100, 210, 0.4)', ink: '#5a43b0' },
  { name: 'Peach', tile: '#F6B672', flap: '#FDEBD5', soft: 'rgba(246, 182, 114, 0.2)', line: 'rgba(210, 130, 50, 0.42)', ink: '#9a5a14' },
  { name: 'Rose', tile: '#F1A2C0', flap: '#FDE3EE', soft: 'rgba(241, 162, 192, 0.2)', line: 'rgba(205, 95, 140, 0.4)', ink: '#a3376a' },
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Each folder keeps the same colour for life, picked from its id. */
export function folderTone(id: string): Tone {
  return TONES[hash(id) % TONES.length];
}

/** CSS variables for a block tinted in a folder's colour. */
export function toneStyle(t: Tone): CSSProperties {
  return { '--tone': t.tile, '--tone-soft': t.soft, '--tone-line': t.line, '--tone-ink': t.ink } as CSSProperties;
}

// ---------- item badges ----------

interface Look {
  text: string;
  bg: string;
  fg?: string;
}

/** Well-known sites get their own colours; anything else gets a steady colour from its name. */
const SITES: [RegExp, Look][] = [
  [/(^|\.)youtube\.com$|youtu\.be$/, { text: '▶', bg: '#FF0033' }],
  [/(^|\.)github\.com$/, { text: 'GH', bg: '#1F2328' }],
  [/^docs\.google\.com$/, { text: 'D', bg: '#4285F4' }],
  [/^mail\.google\.com$/, { text: 'M', bg: '#EA4335' }],
  [/^drive\.google\.com$/, { text: 'Dr', bg: '#1FA463' }],
  [/(^|\.)google\.[a-z.]+$/, { text: 'G', bg: '#4285F4' }],
  [/(^|\.)notion\.(so|site)$/, { text: 'N', bg: '#191919' }],
  [/(^|\.)figma\.com$/, { text: 'F', bg: '#A259FF' }],
  [/(^|\.)wikipedia\.org$/, { text: 'W', bg: '#636466' }],
  [/(^|\.)reddit\.com$/, { text: 'r', bg: '#FF4500' }],
  [/(^|\.)(x|twitter)\.com$/, { text: '𝕏', bg: '#0F1419' }],
  [/(^|\.)linkedin\.com$/, { text: 'in', bg: '#0A66C2' }],
  [/(^|\.)stackoverflow\.com$/, { text: 'S', bg: '#F48024' }],
  [/(^|\.)claude\.ai$|(^|\.)anthropic\.com$/, { text: 'C', bg: '#D97757' }],
  [/(^|\.)chatgpt\.com$|(^|\.)openai\.com$/, { text: 'AI', bg: '#10A37F' }],
  [/(^|\.)amazon\.[a-z.]+$/, { text: 'a', bg: '#FF9900', fg: '#111' }],
  [/(^|\.)slack\.com$/, { text: 'S', bg: '#4A154B' }],
  [/(^|\.)vercel\.(com|app)$/, { text: '▲', bg: '#000' }],
];

/** File types by extension: the label on the badge and the colour people know it by. */
const FILES: [RegExp, Look][] = [
  [/^docx?$|^rtf$/, { text: 'DOC', bg: '#2B579A' }],
  [/^xlsx?$|^csv$/, { text: 'XLS', bg: '#217346' }],
  [/^pptx?$/, { text: 'PPT', bg: '#C43E1C' }],
  [/^pdf$/, { text: 'PDF', bg: '#E5252A' }],
  [/^pages$/, { text: 'PGS', bg: '#F79A1E' }],
  [/^key$/, { text: 'KEY', bg: '#1E88E5' }],
  [/^numbers$/, { text: 'NUM', bg: '#2DB84D' }],
  [/^(png|jpe?g|gif|heic|webp|svg|tiff?)$/, { text: 'IMG', bg: '#8E5CF5' }],
  [/^(mp4|mov|m4v|avi)$/, { text: 'VID', bg: '#E04F8F' }],
  [/^(mp3|wav|m4a|aiff)$/, { text: 'AUD', bg: '#F25F5C' }],
  [/^(md|txt|rtfd)$/, { text: 'TXT', bg: '#6B7280' }],
  [/^(ts|tsx|js|jsx|py|swift|go|rs|java|c|cpp|h|rb|json|html|css|sh)$/, { text: '</>', bg: '#334155' }],
  [/^(zip|dmg|tar|gz)$/, { text: 'ZIP', bg: '#9CA3AF' }],
];

export function hostOf(item: Item): string {
  try {
    return new URL(item.url ?? '').hostname.replace(/^www\./, '');
  } catch {
    return item.detail;
  }
}

export function extOf(item: Item): string {
  const m = (item.path ?? item.label).match(/\.([A-Za-z0-9]{1,8})$/);
  return m ? m[1].toLowerCase() : '';
}

function lookFor(item: Item): Look {
  if (item.kind === 'tab') {
    const host = hostOf(item);
    const known = SITES.find(([re]) => re.test(host));
    if (known) return known[1];
    const name = host.split('.').slice(-2, -1)[0] ?? host;
    return { text: (name[0] ?? '•').toUpperCase(), bg: `hsl(${hash(host) % 360} 58% 52%)` };
  }
  if (item.kind === 'folder') return { text: '', bg: '#3D9CF0' };
  if (item.kind === 'doc') {
    const ext = extOf(item);
    const known = FILES.find(([re]) => re.test(ext));
    if (known) return known[1];
    if (item.untitled) return { text: 'NEW', bg: '#9CA3AF' };
    return { text: (ext || 'FILE').slice(0, 4).toUpperCase(), bg: '#6B7280' };
  }
  return { text: (item.app[0] ?? 'A').toUpperCase(), bg: `hsl(${hash(item.app) % 360} 35% 45%)` };
}

/** The little square that says what something is. */
export function ItemBadge({ item, size = 28 }: { item: Item; size?: number }) {
  const look = lookFor(item);
  const small = look.text.length > 2;
  return (
    <span
      className={`badge badge-${item.kind}`}
      style={{ width: size, height: size, background: look.bg, color: look.fg ?? '#fff', fontSize: size * (small ? 0.3 : 0.44), borderRadius: size * 0.28 }}
      aria-hidden="true"
    >
      {item.kind === 'folder' ? (
        <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6}>
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" fill="#fff" />
        </svg>
      ) : (
        look.text
      )}
    </span>
  );
}

/** A few badges overlapping, for folder cards and rows. */
export function BadgeStrip({ items, max = 5, size = 20 }: { items: Item[]; max?: number; size?: number }) {
  const shown = items.slice(0, max);
  return (
    <span className="badge-strip">
      {shown.map((it, i) => (
        <motion.span key={it.key} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}>
          <ItemBadge item={it} size={size} />
        </motion.span>
      ))}
      {items.length > max && <span className="badge-more">+{items.length - max}</span>}
    </span>
  );
}

/** "Chrome tab · youtube.com", "Word document · Documents", "App". */
export function describe(item: Item): string {
  if (item.kind === 'tab') return hostOf(item);
  if (item.kind === 'folder') return `Folder · ${item.detail}`;
  if (item.kind === 'doc') return item.untitled ? `${item.app.replace('Microsoft ', '')} · never saved` : item.url ? `${item.app.replace('Microsoft ', '')} · OneDrive` : item.detail;
  return 'App';
}

/** File names without the extension (the badge already shows the type). */
export function titleOf(item: Item): string {
  return item.kind === 'doc' ? item.label.replace(/\.[A-Za-z0-9]{1,8}$/, '') : item.label;
}
