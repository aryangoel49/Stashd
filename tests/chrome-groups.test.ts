// Chrome tab groups go through Stashd's extension, only when it's installed and turned on.

import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ shell: {} }));
import { CHROME_HELPER_ID, groupPageUrl, helperEnabled } from '../src/main/open';

describe('Chrome tab groups', () => {
  it('passes the folder name and tabs to the extension page', () => {
    const u = groupPageUrl('Toronto trip', ['https://www.cntower.ca/plan-your-visit', 'https://www.booking.com/city/ca/toronto.html']);
    expect(u.startsWith(`chrome-extension://${CHROME_HELPER_ID}/open.html#`)).toBe(true);
    expect(JSON.parse(decodeURIComponent(u.split('#')[1]))).toEqual({ name: 'Toronto trip', urls: ['https://www.cntower.ca/plan-your-visit', 'https://www.booking.com/city/ca/toronto.html'] });
  });

  it('only counts the extension when it is installed and turned on', () => {
    const prefs = (ext: object) => JSON.stringify({ extensions: { settings: { [CHROME_HELPER_ID]: ext } } });
    expect(helperEnabled(prefs({ path: '/x' }))).toBe(true);
    expect(helperEnabled(prefs({ path: '/x', disable_reasons: [1] }))).toBe(false);
    expect(helperEnabled(prefs({ path: '/x', disable_reasons: 1 }))).toBe(false);
    expect(helperEnabled(JSON.stringify({ extensions: { settings: {} } }))).toBe(false);
    expect(helperEnabled('')).toBe(false);
  });

  it("the extension's id matches its key", async () => {
    const { createHash } = await import('node:crypto');
    const { readFileSync } = await import('node:fs');
    const key = JSON.parse(readFileSync('assets/chrome-extension/manifest.json', 'utf8')).key;
    const hex = createHash('sha256').update(Buffer.from(key, 'base64')).digest('hex').slice(0, 32);
    expect([...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')).toBe(CHROME_HELPER_ID);
  });
});
