// Reads open tab titles and addresses from Chrome, Arc and Safari with AppleScript.
// Only asks a browser that is already running (never launches one), skips Chrome and Arc
// incognito windows, and never reads cookies, history, passwords or page contents.

import type { BrowserName, CollectorError, Tab } from '../../shared/types';
import { run, RunError } from '../exec';
import { cleanTabUrl, type UrlOptions } from '../urls';

export const BROWSER_APPS: Record<BrowserName, { bundleId: string; appName: string; label: string }> = {
  chrome: { bundleId: 'com.google.Chrome', appName: 'Google Chrome', label: 'Chrome' },
  arc: { bundleId: 'company.thebrowser.Browser', appName: 'Arc', label: 'Arc' },
  safari: { bundleId: 'com.apple.Safari', appName: 'Safari', label: 'Safari' },
};

const US = 'character id 31';
const RS = 'character id 30';

// Each script prints records "window<US>isActive<US>url<US>title<RS>".
const SCRIPTS: Record<BrowserName, string> = {
  chrome: `
set out to ""
tell application id "com.google.Chrome"
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set skip to false
    try
      if mode of w is "incognito" then set skip to true
    end try
    if not skip then
      set ai to active tab index of w
      set ti to 0
      repeat with t in tabs of w
        set ti to ti + 1
        set out to out & wi & ${US} & (ti = ai) & ${US} & (URL of t) & ${US} & (title of t) & ${RS}
      end repeat
    end if
  end repeat
end tell
return out`,
  arc: `
set out to ""
tell application id "company.thebrowser.Browser"
  set wi to 0
  repeat with w in windows
    set wi to wi + 1
    set skip to false
    try
      if incognito of w then set skip to true
    end try
    if not skip then
      set activeId to ""
      try
        set activeId to id of active tab of w
      end try
      repeat with t in tabs of w
        set out to out & wi & ${US} & ((id of t) = activeId) & ${US} & (URL of t) & ${US} & (title of t) & ${RS}
      end repeat
    end if
  end repeat
end tell
return out`,
  safari: `
set out to ""
tell application id "com.apple.Safari"
  set wi to 0
  repeat with w in windows
    try
      set ct to index of current tab of w
      set wi to wi + 1
      repeat with t in tabs of w
        set out to out & wi & ${US} & ((index of t) = ct) & ${US} & (URL of t) & ${US} & (name of t) & ${RS}
      end repeat
    end try
  end repeat
end tell
return out`,
};

export function parseTabOutput(browser: BrowserName, out: string): Tab[] {
  return out
    .split('\x1e')
    .map((r) => r.replace(/^\n+/, ''))
    .filter((r) => r.includes('\x1f'))
    .map((r) => {
      const [win, active, url, title] = r.split('\x1f');
      return {
        browser,
        window: Number.parseInt(win, 10) || 1,
        active: active.trim() === 'true',
        url: (url ?? '').trim(),
        title: (title ?? '').replace(/\s+/g, ' ').trim(),
      };
    });
}

export async function isRunning(browser: BrowserName): Promise<boolean> {
  try {
    // "is running" never launches the app. If it is not installed this errors, which also means "no".
    const r = await run('osascript', ['-e', `application id "${BROWSER_APPS[browser].bundleId}" is running`], { timeoutMs: 3000 });
    return r.stdout.trim() === 'true';
  } catch {
    return false;
  }
}

export function isPermissionError(e: unknown): boolean {
  const text = e instanceof RunError ? `${e.message} ${e.stderr}` : String(e);
  return /-1743|not authori[sz]ed to send apple events/i.test(text);
}

export async function collectTabs(
  browsers: BrowserName[],
  opts: UrlOptions,
): Promise<{ tabs: Tab[]; errors: CollectorError[] }> {
  const tabs: Tab[] = [];
  const errors: CollectorError[] = [];
  for (const b of browsers) {
    if (!(await isRunning(b))) continue;
    try {
      const r = await run('osascript', ['-e', SCRIPTS[b]], { timeoutMs: 8000 });
      for (const t of parseTabOutput(b, r.stdout)) {
        const url = cleanTabUrl(t.url, opts);
        if (url) tabs.push({ ...t, url });
      }
    } catch (e) {
      const denied = isPermissionError(e);
      errors.push({
        collector: `browser:${b}`,
        message: denied
          ? `Where Was I is not allowed to read ${BROWSER_APPS[b].label} tabs yet.`
          : `Could not read ${BROWSER_APPS[b].label} tabs: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300),
        permissionDenied: denied || undefined,
      });
    }
  }
  return { tabs: tabs.slice(0, 200), errors };
}
