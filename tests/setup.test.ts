// The welcome's permission checklist (src/main/setup.ts): only apps on this Mac, each with what macOS says.

import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { isPackaged: false, getPath: () => '/tmp' }, shell: {} }));
import { setupItems } from '../src/main/setup';
import { DEFAULT_SETTINGS } from '../src/shared/validate';
import type { Helper } from '../src/main/helper';

const helper = (status: Record<string, string>, trusted = false) =>
  ({
    automation: vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, status[id] ?? 'notInstalled']))),
    accessibility: vi.fn(async () => trusted),
  }) as unknown as Helper;

describe('the welcome checklist', () => {
  it('lists the apps this Mac has, with what macOS says about each', async () => {
    const items = await setupItems(helper({ 'com.google.Chrome': 'allowed', 'com.apple.Safari': 'ask', 'com.microsoft.Word': 'notRunning', 'com.apple.finder': 'denied' }), DEFAULT_SETTINGS);
    expect(items.map((i) => [i.name, i.status])).toEqual([
      ['Chrome', 'allowed'],
      ['Safari', 'ask'],
      ['Word', 'later'],
      ['Finder', 'denied'],
    ]);
  });

  it('asks about chats only when Claude or ChatGPT is installed', async () => {
    expect((await setupItems(helper({}), DEFAULT_SETTINGS)).some((i) => i.kind === 'accessibility')).toBe(false);
    const items = await setupItems(helper({ 'com.anthropic.claudefordesktop': 'notRunning' }, true), DEFAULT_SETTINGS);
    expect(items.find((i) => i.kind === 'accessibility')?.status).toBe('allowed');
  });

  it('skips browsers you turned off', async () => {
    const items = await setupItems(helper({ 'com.google.Chrome': 'allowed' }), { ...DEFAULT_SETTINGS, browsers: { ...DEFAULT_SETTINGS.browsers, chrome: false } });
    expect(items.some((i) => i.name === 'Chrome')).toBe(false);
  });
});
