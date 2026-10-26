// Talks to the small Swift helper (native/wwi-helper.swift) through exec.ts.
// No Electron imports, so it can be tested with a fake binary path.

import { run } from './exec';

export interface RunningApp {
  name: string;
  bundleId: string;
  path: string;
  hidden: boolean;
}

export interface WindowsInfo {
  front: string | null;
  frontBundleId: string | null;
  apps: RunningApp[];
  /** App names front to back (may include system services; filter with `apps`). */
  order: string[];
}

export function parseWindows(text: string): WindowsInfo {
  const raw = JSON.parse(text) as Partial<WindowsInfo> & { error?: string };
  if (raw.error) throw new Error(raw.error);
  return {
    front: typeof raw.front === 'string' ? raw.front : null,
    frontBundleId: typeof raw.frontBundleId === 'string' ? raw.frontBundleId : null,
    apps: Array.isArray(raw.apps)
      ? raw.apps
          .filter((a) => a && typeof a.name === 'string' && a.name)
          .map((a) => ({ name: a.name, bundleId: String(a.bundleId ?? ''), path: String(a.path ?? ''), hidden: Boolean(a.hidden) }))
      : [],
    order: Array.isArray(raw.order) ? raw.order.filter((o): o is string => typeof o === 'string') : [],
  };
}

export class Helper {
  constructor(private readonly binary: string) {}

  async windows(): Promise<WindowsInfo> {
    const r = await run(this.binary, ['windows'], { timeoutMs: 4000 });
    return parseWindows(r.stdout);
  }

  async appleStatus(): Promise<'available' | 'unavailable'> {
    try {
      const r = await run(this.binary, ['status'], { timeoutMs: 4000 });
      return (JSON.parse(r.stdout) as { apple?: string }).apple === 'available' ? 'available' : 'unavailable';
    } catch {
      return 'unavailable';
    }
  }

  /** Finder icons for files and apps, as PNG data URLs (null where there is none). */
  async icons(paths: string[]): Promise<(string | null)[]> {
    const r = await run(this.binary, ['icons'], { timeoutMs: 8000, input: JSON.stringify(paths), maxBuffer: 16 * 1024 * 1024 });
    const out = JSON.parse(r.stdout) as { icons?: unknown[] };
    return paths.map((_, i) => (typeof out.icons?.[i] === 'string' ? (out.icons[i] as string) : null));
  }

  /** Hide these apps (like ⌘H) without quitting them. Returns the names that are now hidden. */
  async hideApps(names: string[]): Promise<string[]> {
    if (!names.length) return [];
    const r = await run(this.binary, ['hide'], { timeoutMs: 4000, input: JSON.stringify(names) });
    const out = JSON.parse(r.stdout) as { hidden?: unknown };
    return Array.isArray(out.hidden) ? out.hidden.filter((n): n is string => typeof n === 'string') : [];
  }

  /** Ask Apple's on-device model. Throws if it is unavailable or fails. */
  async appleBrief(instructions: string, prompt: string): Promise<string> {
    const r = await run(this.binary, ['brief'], { timeoutMs: 45_000, input: JSON.stringify({ instructions, prompt }) });
    const out = JSON.parse(r.stdout) as { text?: string; error?: string };
    if (out.error || typeof out.text !== 'string') throw new Error(out.error ?? 'no answer');
    return out.text;
  }
}
