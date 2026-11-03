// Stashd opens this page as chrome-extension://<id>/open.html#<request>. It opens the folder's tabs
// in this window, puts them in a tab group named after the folder, and closes itself.
// Web pages can't open it (it isn't web-accessible), and only web addresses are ever opened.

const COLORS = ['yellow', 'blue', 'green', 'pink', 'purple', 'cyan', 'orange', 'red', 'grey'];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const req = JSON.parse(decodeURIComponent(location.hash.slice(1)));
  const urls = (Array.isArray(req.urls) ? req.urls : []).filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u)).slice(0, 200);
  const name = String(req.name ?? '').slice(0, 60);
  const self = await chrome.tabs.getCurrent();
  if (!urls.length) return chrome.tabs.remove(self.id);
  const ids = [];
  for (const [n, url] of urls.entries()) {
    if (n) await pause(150);
    const t = await chrome.tabs.create({ url, windowId: self.windowId, active: n === urls.length - 1 });
    ids.push(t.id);
  }
  // Back to a group of the same name if it's still here, so a second Unpack doesn't make another one.
  const same = name ? (await chrome.tabGroups.query({ windowId: self.windowId, title: name }))[0] : null;
  const groupId = await chrome.tabs.group(same ? { groupId: same.id, tabIds: ids } : { tabIds: ids, createProperties: { windowId: self.windowId } });
  if (!same) {
    let h = 0;
    for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    await chrome.tabGroups.update(groupId, { title: name, color: COLORS[h % COLORS.length], collapsed: false });
  }
  await chrome.tabs.remove(self.id);
}

run().catch(async () => {
  const self = await chrome.tabs.getCurrent();
  if (self) chrome.tabs.remove(self.id);
});
