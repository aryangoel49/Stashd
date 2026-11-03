// Stashd opens this page as chrome-extension://<id>/open.html#<request>, does one thing with a folder's
// tab group, and closes itself. Web pages can't open it (it isn't web-accessible).
//   { name, urls }                     open these tabs in a group named after the folder
//   { action: 'ungroup', name, urls }  take these tabs out of the folder's group (they stay open)
//   { action: 'regroup', name, urls }  put open tabs with these addresses back in the folder's group
//   { action: 'progress' }             how far into each video you got (from progress.js), the same way
//   { action: 'report' }               list the tabs in groups, in this page's address (#R…), for Stashd to read;
//                                      Stashd closes this page itself

const COLORS = ['yellow', 'blue', 'green', 'pink', 'purple', 'cyan', 'orange', 'red', 'grey'];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

/** Same page as a saved address? Saved addresses are cleaned (no tracking bits), so compare the page itself. */
function samePage(tabUrl, saved) {
  try {
    const a = new URL(tabUrl), b = new URL(saved);
    const host = (u) => u.hostname.replace(/^(www|m)\./, '');
    const path = (u) => u.pathname.replace(/\/+$/, '') || '/';
    if (host(a) !== host(b) || path(a) !== path(b)) return false;
    for (const [k, v] of b.searchParams) if (a.searchParams.get(k) !== v) return false;
    return true;
  } catch {
    return false;
  }
}

async function groupNamed(windowId, name) {
  return name ? (await chrome.tabGroups.query({ windowId, title: name }))[0] ?? null : null;
}

async function intoGroup(ids, windowId, name) {
  const same = await groupNamed(windowId, name);
  const groupId = await chrome.tabs.group(same ? { groupId: same.id, tabIds: ids } : { tabIds: ids, createProperties: { windowId } });
  if (!same) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    await chrome.tabGroups.update(groupId, { title: name, color: COLORS[h % COLORS.length], collapsed: false });
  }
}

let keepOpen = false;

async function run() {
  const req = JSON.parse(decodeURIComponent(location.hash.slice(1)));
  if (req.action === 'progress') {
    // How far into each of these videos you got: [address, seconds watched, length].
    const { progress = {} } = await chrome.storage.local.get('progress');
    const out = Object.entries(progress).map(([url, p]) => [url, p.t, p.d]);
    keepOpen = true;
    history.replaceState(null, '', `#R${encodeURIComponent(JSON.stringify(out))}`);
    return;
  }
  if (req.action === 'report') {
    const titles = new Map((await chrome.tabGroups.query({})).map((g) => [g.id, g.title ?? '']));
    const grouped = (await chrome.tabs.query({}))
      .filter((t) => t.groupId !== -1 && /^https?:/.test(t.url ?? '') && titles.get(t.groupId))
      .slice(0, 300)
      .map((t) => [t.url, titles.get(t.groupId)]);
    keepOpen = true;
    history.replaceState(null, '', `#R${encodeURIComponent(JSON.stringify(grouped))}`);
    return;
  }
  const urls = (Array.isArray(req.urls) ? req.urls : []).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, 200);
  const name = String(req.name ?? '').slice(0, 60);
  const self = await chrome.tabs.getCurrent();
  if (!urls.length) return;
  if (req.action === 'ungroup' || req.action === 'regroup') {
    const tabs = (await chrome.tabs.query({})).filter((t) => t.id !== self.id && urls.some((u) => samePage(t.url ?? '', u)));
    if (req.action === 'ungroup') {
      const groups = new Set((await chrome.tabGroups.query({ title: name })).map((g) => g.id));
      const ids = tabs.filter((t) => groups.has(t.groupId)).map((t) => t.id);
      if (ids.length) await chrome.tabs.ungroup(ids);
    } else {
      // Into the folder's group in the window that has it, else the window the tab is in.
      const byWindow = new Map();
      for (const t of tabs) byWindow.set(t.windowId, [...(byWindow.get(t.windowId) ?? []), t.id]);
      for (const [windowId, ids] of byWindow) if (await groupNamed(windowId, name)) await intoGroup(ids, windowId, name);
    }
    return;
  }
  const ids = [];
  for (const [n, url] of urls.entries()) {
    if (n) await pause(150);
    const t = await chrome.tabs.create({ url, windowId: self.windowId, active: n === urls.length - 1 });
    ids.push(t.id);
  }
  await intoGroup(ids, self.windowId, name);
}

run()
  .catch(() => undefined)
  .finally(async () => {
    if (keepOpen) return;
    const self = await chrome.tabs.getCurrent();
    if (self) chrome.tabs.remove(self.id);
  });
