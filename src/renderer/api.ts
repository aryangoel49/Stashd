import type { Api } from '../preload';

export { timeAgo } from '../shared/time';

declare global {
  interface Window {
    api: Api;
  }
}

export const api = window.api;

/** "CommandOrControl+Shift+S" becomes "⌘⇧S". */
export function prettyShortcut(accel: string): string {
  const map: Record<string, string> = {
    CommandOrControl: '⌘', Command: '⌘', Cmd: '⌘', Control: '⌃', Ctrl: '⌃', Alt: '⌥', Option: '⌥', Shift: '⇧', Super: '⌘', Space: 'Space',
  };
  return accel
    .split('+')
    .map((p) => map[p] ?? p)
    .join('');
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Electron prefixes errors thrown in the main process; keep only the readable part.
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}
