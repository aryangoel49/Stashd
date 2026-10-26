import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ screen: { getDisplayMatching: () => ({ bounds: { x: 0, y: 0, width: 100, height: 100 } }) } }));
const win = { setBounds: vi.fn(), showInactive: vi.fn(), hide: vi.fn(), isVisible: () => false, webContents: { send: vi.fn() } };
vi.mock('../src/main/windows', () => ({ getWindow: () => win, prepareWindow: () => win, showWindow: () => win }));
vi.mock('../src/main/open', () => ({ openItems: vi.fn(async () => ({})) }));
vi.mock('../src/main/tidy', async (orig) => ({
  ...(await orig<typeof import('../src/main/tidy')>()),
  closeItems: vi.fn(async (items: unknown[]) => ({ closed: items, failed: [] })),
}));

import { TidyFlow } from '../src/main/tidyflow';

describe('Pack up refreshes the views once windows are closed', () => {
  it('tells the menu bar panel and Home to look again after the tidy finishes', async () => {
    const item = { key: 'tab:a', kind: 'tab', label: 'A', detail: '', app: 'Safari' };
    let closedAt = 0;
    const core: any = {
      store: { entry: async () => ({ items: [item], frontKey: null }), get: async () => ({ name: 'Essay' }) },
      settings: { get: () => ({ keepQueryStrings: false, excludedDomains: [], sounds: false }) },
      helper: { windows: async () => ({ apps: [] }), icons: async () => [], hideApps: async () => [] },
      notify: vi.fn(() => (closedAt = Date.now())),
    };
    const flow = new TidyFlow(core, () => ({ x: 0, y: 0, width: 10, height: 10 }));
    const p = flow.run('j', 'e');
    // the animation waits for the overlay to report back
    setTimeout(() => flow.finishOverlay(), 50);
    await p;
    expect(core.notify).toHaveBeenCalledTimes(1);
    expect(closedAt).toBeGreaterThan(0);
  });
});
