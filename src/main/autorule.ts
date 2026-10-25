// The rule for when an automatic snapshot is worth taking. Pure, so it can be tested.

export const ACTIVITY_WINDOW_MS = 60 * 60_000; // a file must have changed within the last hour
export const MIN_GAP_MS = 30 * 60_000; // at most one auto snapshot per project per 30 min

export function shouldAutoSnapshot(args: {
  now: number;
  newestChangeMs: number;
  lastSnapshotMs: number | null;
  lastAutoMs: number | null;
}): boolean {
  const { now, newestChangeMs, lastSnapshotMs, lastAutoMs } = args;
  if (!newestChangeMs || now - newestChangeMs > ACTIVITY_WINDOW_MS) return false;
  if (lastSnapshotMs !== null && newestChangeMs <= lastSnapshotMs) return false; // nothing new since the last save
  if (lastAutoMs !== null && now - lastAutoMs < MIN_GAP_MS) return false;
  return true;
}
