// Hands Stashd two things, straight to its helper program through Chrome's native messaging (no tabs, no
// windows): how far into each video you got (noted by progress.js), and which named tab group each tab
// is in. Sent shortly after a tab closes, moves or changes group, and at most once a minute while a video
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
  try {
    const { progress = {} } = await chrome.storage.local.get('progress');
    const titles = new Map((await chrome.tabGroups.query({})).map((g) => [g.id, g.title ?? '']));
    const groups = (await chrome.tabs.query({}))
      .filter((t) => t.groupId !== -1 && /^https?:/.test(t.url ?? '') && titles.get(t.groupId))
      .slice(0, 300)
      .map((t) => [t.url, titles.get(t.groupId)]);
    const videos = Object.entries(progress).map(([url, p]) => [url, p.t, p.d, p.at]);
    await chrome.runtime.sendNativeMessage(HOST, { videos, groups, at: Date.now() });
  } catch {
    // Stashd isn't installed (or is too old): nothing to tell.
  }
}

chrome.storage.onChanged.addListener((c) => c.progress && soon(60_000));
chrome.tabs.onRemoved.addListener(() => soon(1_500));
chrome.tabs.onUpdated.addListener((_id, c) => (c.url || 'groupId' in c) && soon(1_500));
chrome.tabGroups.onUpdated.addListener(() => soon(1_000));
chrome.tabGroups.onRemoved.addListener(() => soon(1_000));
chrome.runtime.onStartup.addListener(() => soon(3_000));
chrome.runtime.onInstalled.addListener(() => soon(3_000));
