// Runs "Tidy up after saving": name untitled files, close the job's windows while they fly
// into the menu bar icon, then show a small toast with Undo for 10 seconds.

import os from 'node:os';
import path from 'node:path';
import { screen, type Rectangle } from 'electron';
import type { FlyItem, Item, NamingRequest, OverlayPlay, Route, ToastInfo } from '../shared/types';
import type { Core } from './core';
import { openItems } from './open';
import { canName, cleanFileName, closeItems, freePath, saveUntitled, suggestedFileName } from './tidy';
import type { UrlOptions } from './urls';
import { getWindow, prepareWindow, showWindow } from './windows';

const UNDO_MS = 10_000;

export class TidyFlow {
  private payloads = new Map<Route, unknown>();
  private naming: { jobId: string; entryId: string; items: Item[]; resolve: (names: (string | null)[]) => void } | null = null;
  private undo: { items: Item[]; frontKey: string | null; timer: NodeJS.Timeout } | null = null;
  private toastTimer: NodeJS.Timeout | null = null;
  private overlayDone: (() => void) | null = null;
  /** Tidies run one after another, so a second Pack up never takes over the first one's naming box. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly core: Core,
    private readonly trayBounds: () => Rectangle,
  ) {}

  /** Make the animation and toast windows ahead of time, so they appear instantly. */
  prepare(): void {
    prepareWindow('overlay');
    prepareWindow('toast');
  }

  payload(route: Route): unknown {
    return this.payloads.get(route) ?? null;
  }

  /** Called right after a save with Tidy up on. */
  run(jobId: string, entryId: string): Promise<void> {
    this.queue = this.queue.then(async () => {
      try {
        await this.tidy(jobId, entryId);
      } catch {
        this.toast({ title: 'Could not tidy up', detail: 'Your job is saved. Its windows stay open.', canUndo: false });
      }
    });
    return this.queue;
  }

  private urlOptions(): UrlOptions {
    const s = this.core.settings.get();
    return { keepQueryStrings: s.keepQueryStrings, excludedDomains: s.excludedDomains };
  }

  private async tidy(jobId: string, entryId: string): Promise<void> {
    let entry = await this.core.store.entry(jobId, entryId);
    const job = await this.core.store.get(jobId);

    // 1. Untitled documents get a name first (pre-filled; Enter saves, Skip leaves them open).
    const untitled = entry.items.filter(canName);
    if (untitled.length) {
      const names = await this.askNames(jobId, entryId, job.name, untitled);
      for (let i = 0; i < untitled.length; i++) {
        const name = names[i];
        if (!name) continue;
        try {
          const target = await freePath(cleanFileName(name), untitled[i].app);
          if (await saveUntitled(untitled[i], target)) {
            entry = await this.core.replaceItem(jobId, entryId, untitled[i].key, {
              ...untitled[i],
              key: `doc:${target}`,
              label: path.basename(target),
              detail: 'Documents',
              path: target,
              untitled: undefined,
            });
          }
        } catch {
          // leave it open; it is skipped below because it is still untitled
        }
      }
    }

    // 2. Animate and close together: icons start flying, then the windows close behind them.
    // Only things that are actually open get closed (kept items that were already closed are skipped).
    const closable = entry.items.filter((i) => i.kind !== 'app' && !i.untitled && !i.notOpen);
    if (!closable.length) {
      this.toast({ title: 'Nothing to tidy', detail: `${job.name} is saved. Its windows stay open.`, canUndo: false });
      return;
    }
    const animation = this.play(closable, false);
    await wait(250);
    const { closed, failed } = await closeItems(closable, this.urlOptions());
    await animation;
    this.setUndo(closed, entry.frontKey);
    const left = failed.length + entry.items.filter((i) => i.untitled).length;
    this.toast({
      title: `${shortName(job.name)} · ${closed.length} packed`,
      detail: left ? `${left} stayed open.` : 'Everything else is still open.',
      canUndo: closed.length > 0,
    });
  }

  // ---------- naming ----------

  private askNames(jobId: string, entryId: string, jobName: string, items: Item[]): Promise<(string | null)[]> {
    const req: NamingRequest = {
      jobName,
      folder: path.join(os.homedir(), 'Documents').replace(os.homedir(), '~'),
      items: items.map((it, i) => ({ key: it.key, app: it.app, label: it.label, suggested: suggestedFileName(jobName, it, i, items.length) })),
    };
    this.payloads.set('naming', req);
    return new Promise((resolve) => {
      this.naming = { jobId, entryId, items, resolve };
      showWindow('naming', { onReady: (w) => w.webContents.send('payload:updated') });
    });
  }

  finishNaming(names: (string | null)[]): void {
    const n = this.naming;
    this.naming = null;
    getWindow('naming')?.close();
    n?.resolve(n.items.map((_, i) => names[i] ?? null));
  }

  // ---------- animation ----------

  private async withIcons(items: Item[]): Promise<FlyItem[]> {
    const shown = items.slice(0, 12);
    const base: FlyItem[] = shown.map((it) => ({ label: it.label, icon: null }));
    try {
      const icons = await this.core.helper.icons(shown.map((it) => (it.kind === 'tab' ? browserAppPath(it.app) : it.path) ?? ''));
      icons.forEach((icon, i) => (base[i].icon = icon));
    } catch {
      // plain cards
    }
    return base;
  }

  /** Plays the fly-in (or fly-out) animation. Resolves when it has finished. */
  private async play(items: Item[], reverse: boolean): Promise<void> {
    const tray = this.trayBounds();
    const display = screen.getDisplayMatching(tray);
    const flies = await this.withIcons(items);
    const play: OverlayPlay = {
      items: flies,
      target: { x: tray.x + tray.width / 2 - display.bounds.x, y: tray.y + tray.height / 2 - display.bounds.y },
      size: { width: display.bounds.width, height: display.bounds.height },
      reverse,
    };
    this.payloads.set('overlay', play);
    const win = prepareWindow('overlay');
    win.setBounds(display.bounds);
    const finished = new Promise<void>((resolve) => {
      this.overlayDone = resolve;
      // Safety net in case the window never reports back.
      setTimeout(resolve, 1500 + flies.length * 120);
    });
    win.webContents.send('overlay:play', play);
    win.showInactive();
    await finished;
    this.overlayDone = null;
    if (this.payloads.get('overlay') === play) win.hide();
  }

  /** Unpacking: icons fly out of the menu bar icon while things reopen. */
  unpackAnimation(items: Item[]): void {
    void this.play(items.filter((i) => i.kind !== 'app' || items.length <= 3), true);
  }

  /** The animation window says it's done. */
  finishOverlay(): void {
    this.overlayDone?.();
  }

  // ---------- toast and undo ----------

  private toast(info: ToastInfo): void {
    this.payloads.set('toast', info);
    const win = prepareWindow('toast');
    win.webContents.send('toast:show', info);
    // Let it draw the new text first, then slide it in under the menu bar icon.
    setTimeout(() => showWindow('toast', { near: this.trayBounds() }), 60);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => getWindow('toast')?.hide(), info.canUndo ? UNDO_MS : 4000);
  }

  private setUndo(items: Item[], frontKey: string | null): void {
    if (this.undo) clearTimeout(this.undo.timer);
    this.undo = items.length ? { items, frontKey, timer: setTimeout(() => (this.undo = null), UNDO_MS) } : null;
  }

  async undoLast(): Promise<void> {
    const u = this.undo;
    if (!u) return;
    clearTimeout(u.timer);
    this.undo = null;
    getWindow('toast')?.hide();
    const animation = this.play(u.items, true);
    await openItems(u.items, u.frontKey, this.core.settings.get());
    await animation;
    this.toast({ title: 'Brought back', detail: `${u.items.length} ${u.items.length === 1 ? 'item' : 'items'} reopened.`, canUndo: false });
  }

  /** Development only: show the tidy screens with pretend data, without touching any real window. */
  demo(): void {
    this.payloads.set('naming', {
      jobName: 'Climate essay',
      folder: '~/Documents',
      items: [{ key: 'untitled:Microsoft Word:Document1', app: 'Microsoft Word', label: 'Document1', suggested: 'Climate essay' }],
    } satisfies NamingRequest);
    showWindow('naming', { onReady: (w) => w.webContents.send('payload:updated') });
    setTimeout(() => {
      getWindow('naming')?.close();
      if (process.env.WWI_CAPTURE_DIR) {
        // Snap a few frames of the animation to check it.
        for (const ms of [150, 450, 750, 1000]) {
          setTimeout(() => {
            const w = getWindow('overlay');
            void w?.webContents.capturePage().then((img) =>
              import('node:fs/promises').then((fs) => fs.writeFile(path.join(process.env.WWI_CAPTURE_DIR!, `fly-${ms}.png`), img.resize({ width: 1000 }).toPNG())),
            );
          }, ms);
        }
      }
      void this.play(
        [
          { key: 'doc:/Applications/Pages.app', kind: 'doc', label: 'Climate essay.docx', detail: '', app: 'Pages', path: '/Applications/Pages.app' },
          { key: 'tab:x', kind: 'tab', label: 'Sea level rise | JSTOR', detail: '', app: 'Google Chrome' },
          { key: 'tab:y', kind: 'tab', label: 'Google Scholar', detail: '', app: 'Safari' },
        ],
        false,
      ).then(() => {
        this.toast({ title: 'Climate essay · 9 items packed', detail: 'Everything else is still open.', canUndo: true });
        if (process.env.WWI_CAPTURE_DIR) {
          setTimeout(() => {
            void getWindow('toast')
              ?.webContents.executeJavaScript("document.body.classList.add('test-capture')")
              .then(() => getWindow('toast')?.webContents.capturePage())
              .then((img) => img && import('node:fs/promises').then((fs) => fs.writeFile(path.join(process.env.WWI_CAPTURE_DIR!, 'toast-shown.png'), img.toPNG())));
          }, 700);
        }
      });
    }, 5000);
  }

  dismissToast(): void {
    getWindow('toast')?.hide();
  }
}

/** Long job names are cut at a word so the toast stays tidy. */
function shortName(name: string, max = 24): string {
  if (name.length <= max) return name;
  const cut = name.slice(0, max).replace(/\s+\S*$/, '');
  return `${cut || name.slice(0, max)}…`;
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function browserAppPath(appName: string): string | null {
  if (appName === 'Safari') return '/Applications/Safari.app';
  return `/Applications/${appName}.app`;
}
