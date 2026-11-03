// On video sites only: every few seconds, note how far into the video you are and how long it is, keyed by
// the page's address. Nothing else on the page is read, and it never leaves your Mac: Stashd asks for these
// two numbers when you close a video, to tell a finished one (gone from Continue watching) from one you'll
// come back to.

const KEEP = 300;

function save() {
  const v = [...document.querySelectorAll('video')].find((x) => Number.isFinite(x.duration) && x.duration > 30);
  if (!v) return;
  const url = location.href;
  chrome.storage.local.get('progress').then(({ progress = {} }) => {
    progress[url] = { t: Math.round(v.currentTime), d: Math.round(v.duration), at: Date.now() };
    // Keep the most recent ones only.
    const keys = Object.keys(progress);
    if (keys.length > KEEP) keys.sort((a, b) => progress[a].at - progress[b].at).slice(0, keys.length - KEEP).forEach((k) => delete progress[k]);
    return chrome.storage.local.set({ progress });
  }).catch(() => undefined);
}

setInterval(save, 5000);
addEventListener('pagehide', save);
document.addEventListener('ended', save, true);
