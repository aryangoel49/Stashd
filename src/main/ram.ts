// How much memory this Mac is using, read from vm_stat (the same pages Activity Monitor counts as
// "Memory Used": app memory, wired and compressed). Used to show what Tidy all freed.

import { run } from './exec';

/** Memory in use, in MB, from vm_stat's output. Null if it can't be read. */
export function usedFromVmStat(text: string): number | null {
  const size = Number(/page size of (\d+) bytes/.exec(text)?.[1]);
  const pages = (label: string) => Number(new RegExp(`${label}:\\s+(\\d+)`).exec(text)?.[1] ?? NaN);
  const anonymous = pages('Anonymous pages');
  const purgeable = pages('Pages purgeable');
  const wired = pages('Pages wired down');
  const compressed = pages('Pages occupied by compressor');
  // App memory is anonymous minus purgeable (as Activity Monitor shows it); older systems lack it, so active.
  const app = Number.isFinite(anonymous) ? anonymous - (Number.isFinite(purgeable) ? purgeable : 0) : pages('Pages active');
  if (!size || ![app, wired, compressed].every(Number.isFinite)) return null;
  return Math.round(((app + wired + compressed) * size) / 1024 / 1024);
}

export async function usedMemoryMB(): Promise<number | null> {
  try {
    return usedFromVmStat((await run('vm_stat', [], { timeoutMs: 3_000 })).stdout);
  } catch {
    return null;
  }
}

/** One of top's MEM values ("355M", "7265K", "2.9G+", "512B") in MB. */
export function parseTopMem(v: string): number | null {
  const m = /^([\d.]+)([BKMG])?[+-]?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return m[2] === 'G' ? n * 1024 : m[2] === 'K' ? n / 1024 : m[2] === 'B' ? n / 1048576 : n;
}

/**
 * Memory each app is using, in MB, as Activity Monitor's Memory column counts it (top's MEM: the app's
 * own memory, not what it shares with others), summed over every process inside the app (its helpers
 * too, like Chrome's one per tab). `top` has "pid mem" lines; `ps` has "pid path" lines.
 */
export function memoryByApp(topText: string, psText: string, appPaths: string[]): Map<string, number> {
  const mem = new Map<string, number>();
  let table = false;
  for (const line of topText.split('\n')) {
    if (/^\s*PID\s+MEM/.test(line)) {
      table = true;
      continue;
    }
    const m = table ? /^\s*(\d+)\s+(\S+)/.exec(line) : null;
    const mb = m ? parseTopMem(m[2]) : null;
    if (m && mb != null) mem.set(m[1], mb);
  }
  const out = new Map<string, number>(appPaths.map((p) => [p, 0]));
  const roots = appPaths.map((p) => ({ p, prefix: `${p.replace(/\/+$/, '')}/` }));
  for (const line of psText.split('\n')) {
    const m = /^\s*(\d+)\s+(.+)$/.exec(line);
    const hit = m && roots.find((r) => m[2].startsWith(r.prefix));
    if (m && hit) out.set(hit.p, (out.get(hit.p) ?? 0) + (mem.get(m[1]) ?? 0));
  }
  for (const [p, mb] of out) out.set(p, Math.round(mb));
  return out;
}

export async function appsMemoryMB(appPaths: string[]): Promise<Map<string, number> | null> {
  if (!appPaths.length) return new Map();
  try {
    const [top, ps] = await Promise.all([
      run('top', ['-l', '1', '-stats', 'pid,mem'], { timeoutMs: 5_000, maxBuffer: 8 * 1024 * 1024 }),
      run('ps', ['-axo', 'pid=,comm='], { timeoutMs: 3_000, maxBuffer: 8 * 1024 * 1024 }),
    ]);
    return memoryByApp(top.stdout, ps.stdout, appPaths);
  } catch {
    return null;
  }
}

/** "3.1 GB" or "640 MB". */
export function memoryLabel(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb / 10) * 10} MB`;
}
