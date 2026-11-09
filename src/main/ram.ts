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

/** "3.1 GB" or "640 MB". */
export function memoryLabel(mb: number): string {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb / 10) * 10} MB`;
}
