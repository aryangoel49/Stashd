// Chrome tab groups go through Stashd's extension.

import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ shell: {} }));
import { CHROME_HELPER_ID, groupPageUrl, newWindowScript } from '../src/main/open';

describe('Chrome tab groups', () => {
  it('passes the folder name and tabs to the extension page', () => {
    const u = groupPageUrl('Toronto trip', ['https://www.cntower.ca/plan-your-visit', 'https://www.booking.com/city/ca/toronto.html']);
    expect(u.startsWith(`chrome-extension://${CHROME_HELPER_ID}/open.html#`)).toBe(true);
    expect(JSON.parse(decodeURIComponent(u.split('#')[1]))).toEqual({ name: 'Toronto trip', urls: ['https://www.cntower.ca/plan-your-visit', 'https://www.booking.com/city/ca/toronto.html'] });
  });

  it("the extension's id matches its key", async () => {
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const key = JSON.parse(readFileSync('assets/chrome-extension/manifest.json', 'utf8')).key;
    const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
    expect([...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')).toBe(CHROME_HELPER_ID);
  });
});

describe('opening a folder\'s tabs together', () => {
  it('uses a new window in Brave, Edge and Vivaldi, the way it does in Chrome', () => {
    const ids = { chrome: 'com.google.Chrome', brave: 'com.brave.Browser', edge: 'com.microsoft.edgemac', vivaldi: 'com.vivaldi.Vivaldi' } as const;
    for (const [b, id] of Object.entries(ids)) {
      const s = newWindowScript(b as keyof typeof ids)!;
      expect(s).toContain(`tell application id "${id}"`);
      expect(s).toContain('set wwiWin to make new window');
    }
    expect(newWindowScript('arc')).toBeNull();
  });

  it('uses the window you have open when there is one, and only then makes a new one', () => {
    for (const b of ['chrome', 'safari'] as const) {
      const s = newWindowScript(b)!;
      expect(s).toContain('set wwiWin to window id (wwiReuse as integer)');
      expect(s.indexOf('window id (wwiReuse')).toBeLessThan(s.indexOf('if wwiWin is missing value then'));
    }
  });
});
