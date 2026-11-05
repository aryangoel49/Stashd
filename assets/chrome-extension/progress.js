// On video sites only: every few seconds, note how far into the video you are and how long it is, keyed by
// the page's address. Nothing else on the page is read, and it never leaves your Mac: Stashd asks for these
// two numbers when you close a video, to tell a finished one (gone from Continue watching) from one you'll
// come back to.

const KEEP = 300;

// A YouTube video that's live right now. YouTube marks it in the page; the mark is checked against this
// video's own id, since it can be left over from the page you came from.
function youtubeLive() {
  const box = document.querySelector('#watch7-content');
  if (!box || box.querySelector('meta[itemprop=isLiveBroadcast]')?.content !== 'True' || box.querySelector('meta[itemprop=endDate]')) return false;
  const id = box.querySelector('meta[itemprop=identifier]')?.content;
  return !!id && (new URLSearchParams(location.search).get('v') === id || /\/live(\/|$)/.test(location.pathname));
}

function save() {
  const v = [...document.querySelectorAll('video')].find((x) => x.duration > 30);
  if (!v) return;
  const url = location.href;
  // A stream has no length to get through: it's noted with length 0, which Stashd shows as Live.
  const live = !Number.isFinite(v.duration) || (location.hostname.endsWith('youtube.com') && youtubeLive());
  chrome.storage.local.get('progress').then(({ progress = {} }) => {
    progress[url] = { t: Math.round(v.currentTime), d: live ? 0 : Math.round(v.duration), at: Date.now() };
    // Keep the most recent ones only.
    const keys = Object.keys(progress);
    if (keys.length > KEEP) keys.sort((a, b) => progress[a].at - progress[b].at).slice(0, keys.length - KEEP).forEach((k) => delete progress[k]);
    return chrome.storage.local.set({ progress });
  }).catch(() => undefined);
}

setInterval(save, 5000);
addEventListener('pagehide', save);
document.addEventListener('ended', save, true);
