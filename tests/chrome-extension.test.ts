// Stashd's Chrome extension (assets/chrome-extension/open.js), run against a stand-in for Chrome:
// the page Stashd opens does one thing to a folder's tab group, then closes itself.

import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

interface FakeTab { id: number; url: string; windowId: number; groupId: number }
interface FakeGroup { id: number; windowId: number; title?: string; color?: string }

/** Runs open.html with this request against these open tabs and groups, and says how Chrome ended up.
 *  `have`: the version of the extension Chrome has loaded. */
async function openPage(req: unknown, tabs: FakeTab[], groups: FakeGroup[] = [], have = '1.8') {
  const all = [...tabs];
  // The page itself: Stashd opens it as a tab in the front window.
  const self: FakeTab = { id: 999, url: 'chrome-extension://x/open.html', windowId: 1, groupId: -1 };
  all.push(self);
  let nextId = 1000;
  let reloaded = false;
  let closed: (() => void) | undefined;
  const done = new Promise<void>((r) => (closed = r));
  const chrome = {
    tabs: {
      getCurrent: async () => (all.includes(self) ? self : null),
      query: async (q: { windowId?: number }) => all.filter((t) => q.windowId === undefined || t.windowId === q.windowId),
      create: async ({ url, windowId }: { url: string; windowId: number }) => {
        const t: FakeTab = { id: nextId++, url, windowId, groupId: -1 };
        all.push(t);
        return t;
      },
      group: async ({ groupId, tabIds, createProperties }: { groupId?: number; tabIds: number[]; createProperties?: { windowId: number } }) => {
        const id = groupId ?? nextId++;
        if (groupId === undefined) groups.push({ id, windowId: createProperties!.windowId });
        for (const t of all) if (tabIds.includes(t.id)) t.groupId = id;
        return id;
      },
      ungroup: async (ids: number[]) => {
        for (const t of all) if (ids.includes(t.id)) t.groupId = -1;
      },
      remove: async (id: number) => {
        all.splice(all.findIndex((t) => t.id === id), 1);
        closed?.();
      },
    },
    runtime: {
      getManifest: () => ({ version: have }),
      reload: () => {
        reloaded = true;
      },
    },
    tabGroups: {
      query: async (q: { windowId?: number; title?: string }) =>
        groups.filter((g) => (q.windowId === undefined || g.windowId === q.windowId) && (q.title === undefined || g.title === q.title)),
      update: async (id: number, props: Partial<FakeGroup>) => Object.assign(groups.find((g) => g.id === id)!, props),
    },
  };
  const code = readFileSync('assets/chrome-extension/open.js', 'utf8');
  runInNewContext(code, { chrome, location: { hash: `#${encodeURIComponent(JSON.stringify(req))}` }, URL, setTimeout, console });
  await Promise.race([done, new Promise((r) => setTimeout(r, 2000))]);
  const groupOf = (url: string) => groups.find((g) => g.id === all.find((t) => t.url === url)?.groupId);
  return { tabs: all.filter((t) => t.id !== self.id), groups, groupOf, reloaded: () => reloaded };
}

const cn = 'https://www.cntower.ca/visit';
const hotel = 'https://www.booking.com/city/ca/toronto.html';

describe("a folder's Chrome tab group", () => {
  it('Unpack: the tabs it opens go in a group named after the folder', async () => {
    const r = await openPage({ name: 'Toronto trip', urls: [cn, hotel] }, []);
    expect(r.tabs.map((t) => t.url)).toEqual([cn, hotel]);
    expect(r.groupOf(cn)?.title).toBe('Toronto trip');
    expect(r.groupOf(hotel)?.id).toBe(r.groupOf(cn)?.id);
  });

  it('tabs that are already open join the folder’s group too (this is what was missing)', async () => {
    const open = [{ id: 1, url: cn, windowId: 1, groupId: -1 }, { id: 2, url: hotel, windowId: 1, groupId: -1 }];
    const r = await openPage({ action: 'regroup', name: 'Toronto trip', urls: [cn, hotel], create: true }, open);
    // Nothing was opened again, and both are now in one group named after the folder.
    expect(r.tabs).toHaveLength(2);
    expect(r.groupOf(cn)?.title).toBe('Toronto trip');
    expect(r.groupOf(hotel)?.id).toBe(r.groupOf(cn)?.id);
  });

  it('they join the group the folder already has, and tabs in other windows get their own', async () => {
    const open = [{ id: 1, url: cn, windowId: 1, groupId: 7 }, { id: 2, url: hotel, windowId: 2, groupId: -1 }];
    const r = await openPage({ action: 'regroup', name: 'Toronto trip', urls: [cn, hotel], create: true }, open, [{ id: 7, windowId: 1, title: 'Toronto trip', color: 'blue' }]);
    expect(r.groupOf(cn)?.id).toBe(7);
    expect(r.groupOf(hotel)?.title).toBe('Toronto trip');
    expect(r.groupOf(hotel)?.windowId).toBe(2);
  });

  it('without create (Undo putting a tab back), no group is made where there was none', async () => {
    const r = await openPage({ action: 'regroup', name: 'Toronto trip', urls: [cn] }, [{ id: 1, url: cn, windowId: 1, groupId: -1 }]);
    expect(r.groups).toEqual([]);
    expect(r.tabs[0].groupId).toBe(-1);
  });

  it('Pack up: the tabs leave the group before they close', async () => {
    const r = await openPage({ action: 'ungroup', name: 'Toronto trip', urls: [cn] }, [{ id: 1, url: cn, windowId: 1, groupId: 7 }], [{ id: 7, windowId: 1, title: 'Toronto trip' }]);
    expect(r.tabs[0].groupId).toBe(-1);
  });

  it('loads the version Stashd ships when Chrome has an older one, so nobody has to restart Chrome', async () => {
    const r = await openPage({ action: 'regroup', name: 'Toronto trip', urls: [cn], create: true, want: '1.9' }, [{ id: 1, url: cn, windowId: 1, groupId: -1 }], [], '1.8');
    // It did its job first, then loaded the new copy.
    expect(r.groupOf(cn)?.title).toBe('Toronto trip');
    expect(r.reloaded()).toBe(true);
  });

  it('stays as it is when it already has that version, or a newer one', async () => {
    for (const have of ['1.8', '1.10']) {
      const r = await openPage({ action: 'regroup', name: 'T', urls: [cn], create: true, want: '1.8' }, [{ id: 1, url: cn, windowId: 1, groupId: -1 }], [], have);
      expect(r.reloaded()).toBe(false);
    }
  });

  it('a tab is matched by its page, not its tracking bits, and other tabs are left alone', async () => {
    const open = [
      { id: 1, url: `${cn}?utm_source=x`, windowId: 1, groupId: -1 },
      { id: 2, url: 'https://www.espn.com/nba', windowId: 1, groupId: -1 },
    ];
    const r = await openPage({ action: 'regroup', name: 'Toronto trip', urls: [cn], create: true }, open);
    expect(r.tabs[0].groupId).not.toBe(-1);
    expect(r.tabs[1].groupId).toBe(-1);
  });
});
