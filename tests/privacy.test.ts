// Privacy guard: only src/main/brief/claude.ts may touch the network.
// This fails if any other source file imports a networking module or calls fetch.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '../src');
const ALLOWED = new Set([path.join(SRC, 'main/brief/claude.ts')]);

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
