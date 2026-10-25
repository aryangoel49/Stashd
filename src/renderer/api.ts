import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Api } from '../preload';
import type { Settings } from '../shared/types';

export { timeAgo } from '../shared/time';

declare global {
  interface Window {
    api: Api;
  }
}

export const api = window.api;

/** "Control+S" becomes "⌃S" and "CommandOrControl+Shift+S" becomes "⇧⌘S" (Mac order: Control, Option, Shift, Command). */
export function prettyShortcut(accel: string): string {
  const parts = accel.split('+');
  const key = parts.pop() ?? '';
  const has = (...names: string[]) => parts.some((p) => names.includes(p));
  return `${has('Control', 'Ctrl') ? '⌃' : ''}${has('Alt', 'Option') ? '⌥' : ''}${has('Shift') ? '⇧' : ''}${has('CommandOrControl', 'Command', 'Cmd', 'Super') ? '⌘' : ''}${key}`;
}

export function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  // Electron prefixes errors thrown in the main process; keep only the readable part.
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

/** Settings, kept fresh, with the accent colour applied to the page. */
export function useSettings(): Settings | null {
  const [s, setS] = useState<Settings | null>(null);
  useEffect(() => {
    const load = () => void api.getSettings().then(setS);
    load();
    return api.onSettingsChanged(load);
  }, []);
  useEffect(() => {
    if (s) document.documentElement.dataset.accent = s.accent;
  }, [s]);
  return s;
}

/** Make a floating window exactly as tall as its content. */
export function useFitWindow<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = 0;
    const ro = new ResizeObserver(() => {
      const h = Math.ceil(el.getBoundingClientRect().height);
      if (Math.abs(h - last) > 1) {
        last = h;
        void api.fitWindow(h);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return ref;
}
