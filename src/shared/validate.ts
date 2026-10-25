// Input checks for everything that crosses from the UI into the main process.
// Each function either returns a clean value or throws.

import type { BrowserName, Project, RestoreRequest, Settings } from './types';

export const DEFAULT_SETTINGS: Settings = {
  projects: [],
  browsers: { chrome: true, arc: true, safari: true },
  excludedDomains: ['accounts.google.com', 'mail.google.com', 'bank', 'login', 'signin', 'auth'],
  keepQueryStrings: false,
  shellHistory: false,
  lookbackHours: 12,
  retentionCount: 20,
  retentionDays: 30,
  autoSnapshot: false,
  launchAtLogin: false,
  openFilesInVSCode: true,
  shortcutSave: 'CommandOrControl+Shift+S',
  shortcutRecap: 'CommandOrControl+Shift+W',
  aiRecap: false,
  aiModel: 'claude-haiku-5-5',
  aiDisclosureAccepted: false,
};

export const BROWSERS: BrowserName[] = ['chrome', 'arc', 'safari'];

const ID_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;
// Snapshot ids are ISO timestamps with ':' and '.' replaced by '-', plus an optional suffix.
const SNAPSHOT_ID_RE = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z(-\d+)?$/;

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

export function int(v: unknown, name: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    fail(`${name} must be a whole number from ${min} to ${max}`);
  }
  return v;
}

export function projectId(v: unknown): string {
  const s = str(v, 'project id', 100);
  if (!ID_RE.test(s)) fail('bad project id');
  return s;
}

export function snapshotId(v: unknown): string {
  const s = str(v, 'snapshot id', 100);
  if (!SNAPSHOT_ID_RE.test(s)) fail('bad snapshot id');
  return s;
}

export function note(v: unknown): string {
  return str(v ?? '', 'note', 2000).trim();
}

export function absolutePath(v: unknown, name = 'path'): string {
  const s = str(v, name, 4096);
  if (!s.startsWith('/') || s.includes('\0')) fail(`${name} must be a full folder path`);
  return s;
}

const ACCEL_RE = /^((CommandOrControl|Command|Cmd|Control|Ctrl|Alt|Option|Shift|Super)\+){1,4}([A-Z0-9]|F\d{1,2}|Space)$/;

export function accelerator(v: unknown, name: string): string {
  const s = str(v, name, 80);
  if (!ACCEL_RE.test(s)) fail(`${name} should look like CommandOrControl+Shift+S`);
  return s;
}

function domainList(v: unknown): string[] {
  if (!Array.isArray(v) || v.length > 200) fail('excluded domains must be a list');
  return v
    .map((d) => str(d, 'excluded domain', 200).trim().toLowerCase())
    .filter((d) => d.length > 0 && /^[a-z0-9.-]+$/.test(d));
}

function projects(v: unknown): Project[] {
  if (!Array.isArray(v) || v.length > 100) fail('projects must be a list');
  const seen = new Set<string>();
  return v.map((p) => {
    if (!isPlainObject(p)) fail('bad project');
    const id = projectId(p.id);
    if (seen.has(id)) fail('duplicate project');
    seen.add(id);
    return { id, name: str(p.name, 'project name', 120).trim() || id, path: absolutePath(p.path) };
  });
}

/** Validate a partial settings update from the UI and merge it onto the current settings. */
export function settingsPatch(v: unknown, current: Settings): Settings {
  if (!isPlainObject(v)) fail('settings must be an object');
  const next: Settings = { ...current, browsers: { ...current.browsers } };
  for (const [k, val] of Object.entries(v)) {
    switch (k) {
      case 'projects': next.projects = projects(val); break;
      case 'browsers': {
        if (!isPlainObject(val)) fail('browsers must be an object');
        for (const b of BROWSERS) if (b in val) next.browsers[b] = bool(val[b], b);
        break;
      }
      case 'excludedDomains': next.excludedDomains = domainList(val); break;
      case 'keepQueryStrings': next.keepQueryStrings = bool(val, k); break;
      case 'shellHistory': next.shellHistory = bool(val, k); break;
      case 'lookbackHours': next.lookbackHours = int(val, 'lookback hours', 1, 168); break;
      case 'retentionCount': next.retentionCount = int(val, 'snapshots to keep', 1, 500); break;
      case 'retentionDays': next.retentionDays = int(val, 'days to keep', 1, 3650); break;
      case 'autoSnapshot': next.autoSnapshot = bool(val, k); break;
      case 'launchAtLogin': next.launchAtLogin = bool(val, k); break;
      case 'openFilesInVSCode': next.openFilesInVSCode = bool(val, k); break;
      case 'shortcutSave': next.shortcutSave = accelerator(val, 'save shortcut'); break;
      case 'shortcutRecap': next.shortcutRecap = accelerator(val, 'recap shortcut'); break;
      case 'aiRecap': next.aiRecap = bool(val, k); break;
      case 'aiModel': {
        const m = str(val, 'model name', 100).trim();
        if (!/^[a-z0-9][a-z0-9.\-]{1,99}$/.test(m)) fail('model name looks wrong');
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
  if (!isPlainObject(raw)) return { ...DEFAULT_SETTINGS };
  const out: Settings = { ...DEFAULT_SETTINGS, browsers: { ...DEFAULT_SETTINGS.browsers } };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof Settings)[]) {
    if (!(key in raw)) continue;
    try {
      Object.assign(out, settingsPatch({ [key]: raw[key] }, out));
    } catch {
      // keep the default for a field that no longer validates
    }
  }
  return out;
}

export function restoreRequest(v: unknown): RestoreRequest {
  if (!isPlainObject(v)) fail('bad restore request');
  if (!Array.isArray(v.keys)) fail('keys must be a list');
  if (v.keys.length > 20) fail('You can reopen at most 20 items at once');
  return {
    projectId: projectId(v.projectId),
    snapshotId: snapshotId(v.snapshotId),
    keys: v.keys.map((k) => str(k, 'item key', 300)),
  };
}

export function apiKey(v: unknown): string {
  const s = str(v, 'API key', 300).trim();
  if (s !== '' && !/^[A-Za-z0-9_\-]{20,300}$/.test(s)) fail('That does not look like an API key');
  return s;
}
