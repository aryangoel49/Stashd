// Hands Stashd two things, straight to its helper program through Chrome's native messaging (no tabs, no
// windows): how far into each video you got (noted by progress.js), and which named tab group each tab
// is in. Sent shortly after a tab closes, moves or changes group, and about once a minute while a video
// plays. It never leaves your Mac.

const HOST = 'com.aryangoel.stashd';
let timer = null;
let due = Infinity;

/** Send within `ms`; an earlier send already planned stays. */
function soon(ms) {
  const at = Date.now() + ms;
  if (timer && at >= due) return;
  clearTimeout(timer);
  due = at;
  timer = setTimeout(send, ms);
}

async function send() {
  timer = null;
  due = Infinity;
  lastSent = Date.now();
  try {
    const { progress = {} } = await chrome.storage.local.get('progress');
    const titles = new Map((await chrome.tabGroups.query({})).map((g) => [g.id, g.title ?? '']));
    const groups = (await chrome.tabs.query({}))
      .filter((t) => t.groupId !== -1 && /^https?:/.test(t.url ?? '') && titles.get(t.groupId))
      .slice(0, 300)
      .map((t) => [t.url, titles.get(t.groupId)]);
    const videos = Object.entries(progress).map(([url, p]) => [url, p.t, p.d, p.at]);
    // `v`: which version of this extension Chrome has loaded, so Stashd knows when Chrome still has an old one.
    await chrome.runtime.sendNativeMessage(HOST, { videos, groups, at: Date.now(), v: chrome.runtime.getManifest().version });
  } catch {
    // Stashd isn't installed (or is too old): nothing to tell.
  }
}

// While a video plays its position changes every few seconds: pass it on at most once a minute. Chrome
// puts this script to sleep after about 30 quiet seconds, which would kill a long timer, so instead it
// sends right away once a minute has passed since the last send, and otherwise soon after.
let lastSent = 0;
chrome.storage.onChanged.addListener((c) => {
  if (!c.progress) return;
  if (Date.now() - lastSent > 60_000) soon(500);
});
chrome.tabs.onRemoved.addListener(() => soon(1_500));
chrome.tabs.onUpdated.addListener((_id, c) => (c.url || 'groupId' in c) && soon(1_500));
chrome.tabGroups.onUpdated.addListener(() => soon(1_000));
chrome.tabGroups.onRemoved.addListener(() => soon(1_000));
chrome.runtime.onStartup.addListener(() => soon(3_000));
chrome.runtime.onInstalled.addListener(() => soon(3_000));
