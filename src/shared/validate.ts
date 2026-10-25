// Input checks for everything that crosses from the UI into the main process.
// Each function either returns a clean value or throws.

import type { Accent, BrowserName, SaveRequest, Settings } from './types';

export const DEFAULT_LIFESTYLE_APPS = [
  'Spotify', 'Music', 'Messages', 'Mail', 'Microsoft Outlook', 'Slack', 'WhatsApp', 'Discord', 'Telegram',
  'Calendar', 'Notion Calendar', 'FaceTime', 'Podcasts', 'YouTube Music', 'System Settings', 'Activity Monitor',
  'Claude', 'ChatGPT', 'App Store', 'Photos', 'Reminders', 'Clock', 'Weather',
];

export const DEFAULT_LIFESTYLE_SITES = [
  'mail.google.com', 'calendar.google.com', 'music.youtube.com', 'open.spotify.com', 'web.whatsapp.com',
  'outlook.live.com', 'outlook.office.com', 'messages.google.com', 'discord.com', 'web.telegram.org',
];

export const DEFAULT_SETTINGS: Settings = {
  browsers: { chrome: true, arc: true, safari: true },
  excludedDomains: ['accounts.google.com', 'bank', 'login', 'signin', 'auth'],
  lifestyleSites: DEFAULT_LIFESTYLE_SITES,
  lifestyleApps: DEFAULT_LIFESTYLE_APPS,
  keepQueryStrings: false,
  launchAtLogin: false,
  shortcutSave: 'Control+S',
  shortcutRecap: 'Control+W',
  accent: 'indigo',
  tidyUp: false,
  aiModel: 'claude-haiku-5-5',
  aiDisclosureAccepted: false,
};

const OLD_SHORTCUT_SAVE = 'CommandOrControl+Shift+S';
const OLD_SHORTCUT_RECAP = 'CommandOrControl+Shift+W';

export const BROWSERS: BrowserName[] = ['chrome', 'arc', 'safari'];
const ACCENTS: Accent[] = ['indigo', 'teal', 'coral'];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
// Entry ids are ISO timestamps with ':' and '.' replaced by '-', plus an optional suffix.
const ENTRY_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?$/;

export class ValidationError extends Error {}

function fail(msg: string): never {
  throw new ValidationError(msg);
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function str(v: unknown, name: string, max = 1000): string {
  if (typeof v !== 'string') fail(`${name} must be text`);
  if (v.length > max) fail(`${name} is too long`);
  return v;
}

export function bool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') fail(`${name} must be true or false`);
  return v;
}

export function jobId(v: unknown): string {
  const s = str(v, 'job id', 100);
  if (!ID_RE.test(s)) fail('bad job id');
  return s;
}

export function entryId(v: unknown): string {
  const s = str(v, 'save id', 100);
  if (!ENTRY_ID_RE.test(s)) fail('bad save id');
  return s;
}

export function jobName(v: unknown): string {
  const s = str(v, 'name', 200).replace(/\s+/g, ' ').trim();
  if (!s) fail('Give the job a name');
  return s.slice(0, 80);
}

export function note(v: unknown): string {
  return str(v ?? '', 'note', 2000).trim();
}

const ACCEL_RE = /^((CommandOrControl|Command|Cmd|Control|Ctrl|Alt|Option|Shift|Super)\+){1,4}([A-Z0-9]|F\d{1,2}|Space)$/;

export function accelerator(v: unknown, name: string): string {
  const s = str(v, name, 80);
  if (!ACCEL_RE.test(s)) fail(`${name} should look like Control+S`);
  return s;
}

function domainList(v: unknown, name: string): string[] {
  if (!Array.isArray(v) || v.length > 300) fail(`${name} must be a list`);
  return [...new Set(v.map((d) => str(d, name, 200).trim().toLowerCase()).filter((d) => d.length > 0 && /^[a-z0-9.-]+$/.test(d)))];
}

function appList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 300) fail('apps must be a list');
  return [...new Set(v.map((a) => str(a, 'app name', 120).trim()).filter(Boolean))];
}

/** Validate a partial settings update from the UI and merge it onto the current settings. */
export function settingsPatch(v: unknown, current: Settings): Settings {
  if (!isPlainObject(v)) fail('settings must be an object');
  const next: Settings = { ...current, browsers: { ...current.browsers } };
  for (const [k, val] of Object.entries(v)) {
    switch (k) {
      case 'browsers': {
        if (!isPlainObject(val)) fail('browsers must be an object');
        for (const b of BROWSERS) if (b in val) next.browsers[b] = bool(val[b], b);
        break;
      }
      case 'excludedDomains': next.excludedDomains = domainList(val, 'excluded sites'); break;
      case 'lifestyleSites': next.lifestyleSites = domainList(val, 'everyday sites'); break;
      case 'lifestyleApps': next.lifestyleApps = appList(val); break;
      case 'keepQueryStrings': next.keepQueryStrings = bool(val, k); break;
      case 'launchAtLogin': next.launchAtLogin = bool(val, k); break;
      case 'shortcutSave': next.shortcutSave = accelerator(val, 'save shortcut'); break;
      case 'shortcutRecap': next.shortcutRecap = accelerator(val, 'brief shortcut'); break;
      case 'accent': {
        if (!ACCENTS.includes(val as Accent)) fail('unknown colour');
        next.accent = val as Accent;
        break;
      }
      case 'tidyUp': next.tidyUp = bool(val, k); break;
      case 'aiModel': {
        const m = str(val, 'model name', 100).trim();
        if (!/^[a-z0-9][a-z0-9.-]{1,99}$/.test(m)) fail('model name looks wrong');
        next.aiModel = m;
        break;
      }
      case 'aiDisclosureAccepted': next.aiDisclosureAccepted = bool(val, k); break;
      default: fail(`unknown setting: ${k}`);
    }
  }
  return next;
}

/** Fill in missing fields of settings read from disk (older versions, hand edits). */
export function normalizeStoredSettings(raw: unknown): Settings {
  const out: Settings = { ...DEFAULT_SETTINGS, browsers: { ...DEFAULT_SETTINGS.browsers } };
  if (!isPlainObject(raw)) return out;
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (!(key in raw)) continue;
    try {
      Object.assign(out, settingsPatch({ [key]: raw[key] }, out));
    } catch {
      // keep the default for a field that no longer validates
    }
  }
  // The shortcuts used to be three keys. Anyone still on those old defaults moves to the new two-key ones.
  if (out.shortcutSave === OLD_SHORTCUT_SAVE) out.shortcutSave = DEFAULT_SETTINGS.shortcutSave;
  if (out.shortcutRecap === OLD_SHORTCUT_RECAP) out.shortcutRecap = DEFAULT_SETTINGS.shortcutRecap;
  return out;
}

export function saveRequest(v: unknown): SaveRequest {
  if (!isPlainObject(v)) fail('bad save request');
  if (!Array.isArray(v.keys) || v.keys.length > 500) fail('items must be a list');
  return {
    jobId: v.jobId == null ? null : jobId(v.jobId),
    name: jobName(v.name),
    note: note(v.note),
    keys: v.keys.map((k) => str(k, 'item', 4200)),
    tidy: bool(v.tidy, 'tidy'),
  };
}

export function openMode(v: unknown): 'needed' | 'all' {
  if (v !== 'needed' && v !== 'all') fail('bad open mode');
  return v;
}

export function apiKey(v: unknown): string {
  const s = str(v, 'API key', 300).trim();
  if (s !== '' && !/^[A-Za-z0-9_-]{20,300}$/.test(s)) fail('That does not look like an API key');
  return s;
}
