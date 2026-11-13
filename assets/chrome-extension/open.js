// Stashd opens this page as chrome-extension://<id>/open.html#<request>, does one thing with a folder's
// tab group, and closes itself. Web pages can't open it (it isn't web-accessible).
//   { name, urls }                     open these tabs in a group named after the folder
//   { action: 'ungroup', name, urls }  take these tabs out of the folder's group (they stay open)
//   { action: 'regroup', name, urls }  put open tabs with these addresses back in the folder's group
//                        (with create: true, make the group when the window hasn't got one)
// Every request also carries `want`: the version Stashd ships. If Chrome has an older one loaded, this
// page loads the new one (Stashd has already put it on disk), so an update needs no restart of Chrome.

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

async function run() {
  const req = JSON.parse(decodeURIComponent(location.hash.slice(1)));
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
      for (const [windowId, ids] of byWindow) if (req.create || (await groupNamed(windowId, name))) await intoGroup(ids, windowId, name);
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

/** Is the version Stashd ships newer than the one Chrome has loaded? ("1.8" against "1.7".) */
function older(have, want) {
  const parts = (v) => String(v ?? '').split('.').map((n) => Number(n) || 0);
  const [a, b] = [parts(have), parts(want)];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) < (b[i] ?? 0);
  }
  return false;
}

run()
  .catch(() => undefined)
  .finally(async () => {
    const self = await chrome.tabs.getCurrent();
    if (self) chrome.tabs.remove(self.id);
    let want;
    try {
      want = JSON.parse(decodeURIComponent(location.hash.slice(1))).want;
    } catch {
      want = undefined;
    }
    // Loads the copy Stashd has already put on disk; Chrome closes this page as it goes.
    if (want && older(chrome.runtime.getManifest().version, want)) chrome.runtime.reload();
  });
