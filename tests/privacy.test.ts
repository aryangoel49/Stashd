// Privacy guard: only three files may touch the network: claude.ts (your own key, to Anthropic),
// stashd.ts (Stashd AI, only ever to Stashd's own server) and updater.ts (which version is the latest, and
// the download, only ever from GitHub).
// This fails if any other source file imports a networking module or calls fetch.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../src');
const ALLOWED = new Set([path.join(SRC, 'main/brief/claude.ts'), path.join(SRC, 'main/brief/stashd.ts'), path.join(SRC, 'main/updater.ts')]);

const FORBIDDEN: [string, RegExp][] = [
  ['imports a Node networking module', /(from\s+|require\(\s*|import\(\s*)['"](node:)?(http|https|http2|net|tls|dgram|undici)['"]/],
  ['imports Electron net', /\bnet\b[^;]*from\s+['"]electron['"]|require\(['"]electron['"]\)\.net/],
  ['calls fetch', /\bfetch\s*\(/],
  ['uses XMLHttpRequest', /\bXMLHttpRequest\b/],
  ['uses WebSocket', /\bWebSocket\b/],
  ['uses EventSource', /\bEventSource\b/],
  ['uses sendBeacon', /\bsendBeacon\b/],
  ['imports the Anthropic SDK', /['"]@anthropic-ai\/sdk['"]/],
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(name) ? [full] : [];
  });
}

describe('network access', () => {
  // Our code, plus the on-device meaning model's runner (it ships next to the app).
  const EMBEDDER = path.resolve(__dirname, '../embedder');
  const files = [...sourceFiles(SRC), ...readdirSync(EMBEDDER).filter((f) => /\.(c|m)?js$/.test(f)).map((f) => path.join(EMBEDDER, f))];

  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files).toContain(path.join(SRC, 'main/brief/claude.ts'));
  });

  it('Stashd AI only ever talks to Stashd’s own server', () => {
    const text = readFileSync(path.join(SRC, 'main/brief/stashd.ts'), 'utf8');
    expect(text.match(/https?:\/\/[^\s'"`]+/g)).toEqual(['https://getstashd.vercel.app/api/brief']);
    expect(text.match(/\bfetch\s*\(/g)).toHaveLength(1);
    expect(text).toContain('fetch(STASHD_AI,');
  });

  it('the updater only ever talks to GitHub, and sends nothing about you', () => {
    const text = readFileSync(path.join(SRC, 'main/updater.ts'), 'utf8');
    for (const url of text.match(/https?:\/\/[^\s'"`]+/g) ?? []) expect(new URL(url).hostname, url).toMatch(/^(api\.)?github\.com$/);
    expect(text.match(/\bfetch\s*\(/g)).toHaveLength(2);
    expect(text).not.toMatch(/method:\s*['"]POST/);
    expect(text).not.toMatch(/body:/);
  });

  for (const file of files) {
    if (ALLOWED.has(file)) continue;
    it(`${path.relative(path.dirname(SRC), file)} does not use the network`, () => {
      const text = readFileSync(file, 'utf8');
      for (const [what, re] of FORBIDDEN) {
        expect(re.test(text), `${path.relative(SRC, file)} ${what}`).toBe(false);
      }
    });
  }
});
