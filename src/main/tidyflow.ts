// Runs "Tidy up after saving": name untitled files, close the job's windows while they fly
// into the menu bar icon, then show a small toast with Undo for 2 seconds.

import os from 'node:os';
import path from 'node:path';
import { screen, type Rectangle } from 'electron';
import type { FlyItem, Item, NamingRequest, OverlayPlay, Route, ToastInfo } from '../shared/types';
import { CHAT_APPS } from './capture';
import { appsToQuit, type Core } from './core';
import { iconSource } from './icons';
import { openItems } from './open';
import { canName, cleanFileName, closeItems, freePath, saveUntitled, suggestedFileName } from './tidy';
import type { UrlOptions } from './urls';
import { getWindow, prepareWindow, showWindow } from './windows';

// Undo is offered briefly: long enough to catch a slip, short enough to stay out of the way.
const UNDO_MS = 2_000;
/** An offer stays a little longer than Undo: it needs reading first. */
const OFFER_MS = 8_000;
/** Just longer than the toast's 150ms fade-out, so the window hides after it has gone. */
const TOAST_LEAVE_MS = 170;

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
    // A naming box still waiting for an answer was abandoned: treat it as Skip so this Pack up isn't stuck behind it.
    if (this.naming) this.finishNaming([]);
    this.queue = this.queue.then(async () => {
      try {
        await this.tidy(jobId, entryId);
      } catch {
        this.toast({ title: "Couldn't pack up", detail: 'Your folder is saved. Its windows stay open.', canUndo: false, mood: 'curious' });
      } finally {
        // The save already told the menu bar panel and Home, but while windows were still open. Now that
        // they're closed, look again so the folder shows as packed straight away (not after the 6s cache).
        this.core.notify();
      }
    });
    return this.queue;
  }

  /** Tidy all: save open folders, keep loose tabs in a folder of their own, then close it all at once. */
  tidyAll(): Promise<void> {
    if (this.naming) this.finishNaming([]);
    this.queue = this.queue.then(async () => {
      try {
        const plan = await this.core.tidyAll();
        const saved = await Promise.all(plan.saved.map((s) => this.core.store.entry(s.jobId, s.entryId)));
        const items = [...saved.flatMap((e) => e.items.filter((i) => i.kind !== 'app' && !i.untitled && !i.notOpen)), ...plan.close];
        // The apps of the folders it packed go too, like Pack up: quit (asking about unsaved work),
        // Claude and ChatGPT only hidden. Every other app quits after (see below).
        const apps = saved.flatMap((e) => e.items.filter((i) => i.kind === 'app' && !i.notOpen));

        const animation = this.play([...items, ...apps], false);
        await wait(120);
        // Documents aren't closed one by one: their apps quit below anyway (asking about unsaved work),
        // and some (Preview) are slow to answer a close. Tabs and Finder windows are closed, since
        // Finder stays and a browser might reopen its tabs.
        const docs = items.filter((i) => i.kind === 'doc');
        const [{ closed }, doneNames] = await Promise.all([closeItems(items.filter((i) => i.kind !== 'doc'), this.urlOptions()), this.quitOrHide(apps)]);
        const done = new Set(doneNames.map((n) => n.toLowerCase()));
        closed.push(...apps.filter((a) => done.has(a.app.toLowerCase())));
        // Then every other app except Claude (only Tidy all does this; Pack up quits just the folder's apps).
        // Each quits like ⌘Q, so anything unsaved still asks first.
        const win = await Promise.resolve().then(() => this.core.helper.windows()).catch(() => null);
        if (win) {
          const others = appsToQuit(win.apps.map((a) => a.name).filter((n) => !done.has(n.toLowerCase())));
          const quit = new Set((await this.core.helper.quitApps(others).catch(() => [] as string[])).map((n) => n.toLowerCase()));
          closed.push(...others.filter((n) => quit.has(n.toLowerCase())).map((n): Item => ({ key: `app:${n}`, kind: 'app', label: n, detail: '', app: n })));
          for (const n of quit) done.add(n);
        }
        // A document counts as closed once its app has quit.
        closed.push(...docs.filter((d) => done.has(d.app.toLowerCase())));
        await animation;
        if (!closed.length) {
          this.toast({ title: 'Already tidy', detail: 'Nothing to close.', canUndo: false, mood: 'awake' });
          return;
        }
        this.setUndo(closed, null);
        await this.core.rememberTidied(closed);
        const filed = plan.filed.reduce((n, f) => n + f.count, 0);
        const parts = [
          plan.saved.length ? `${plan.saved.length} ${plan.saved.length === 1 ? 'folder' : 'folders'} packed` : '',
          filed ? `${filed} ${filed === 1 ? 'tab' : 'tabs'} added to ${plan.filed.length === 1 ? shortName(plan.filed[0].name) : `${plan.filed.length} folders`}` : '',
        ].filter(Boolean);
        this.toast({
          title: `Tidied up · ${closed.length} closed`,
          detail: parts.length ? `${parts.join(', ')}. All in Recently closed for 10 min.` : 'In Recently closed for 10 min, in case.',
          canUndo: closed.length > 0,
          mood: 'sleep',
        });
      } catch {
        this.toast({ title: "Couldn't tidy up", detail: 'Nothing was closed.', canUndo: false, mood: 'curious' });
      } finally {
        this.core.notify();
      }
    });
    return this.queue;
  }

  /** Quits apps (⌘Q, so they still ask about unsaved work); Claude and ChatGPT are only hidden. Returns the ones that went. */
  private async quitOrHide(apps: Item[]): Promise<string[]> {
    const hide = apps.filter((a) => CHAT_APPS.includes(a.app)).map((a) => a.app);
    const quit = apps.filter((a) => !CHAT_APPS.includes(a.app)).map((a) => a.app);
    const r = await Promise.all([
      quit.length ? this.core.helper.quitApps(quit).catch(() => [] as string[]) : [],
      hide.length ? this.core.helper.hideApps(hide).catch(() => [] as string[]) : [],
    ]);
    return r.flat();
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
    // Things the save thought were closed are tried too: if an app didn't answer in time (or lost its
    // permission after an update), they may still be open. Closing something that isn't open does nothing.
    // Only in apps that are running: asking an app that isn't would launch it.
    const running = new Set((await Promise.resolve().then(() => this.core.helper.windows()).catch(() => null))?.apps.map((a) => a.name) ?? []);
    const maybeOpen = entry.items.filter((i) => i.kind !== 'app' && !i.untitled && i.notOpen && running.has(i.app));
    // Apps in the folder (Terminal, say) quit like ⌘Q, so they still ask about unsaved work. Claude and
    // ChatGPT are only hidden: other chats may be running there, and Unpack goes back to the saved chat anyway.
    const apps = entry.items.filter((i) => i.kind === 'app' && !i.notOpen);
    const hideOnly = apps.filter((a) => CHAT_APPS.includes(a.app));
    const toQuit = apps.filter((a) => !CHAT_APPS.includes(a.app));
    if (!closable.length && !apps.length && !maybeOpen.length) {
      this.toast({ title: 'Nothing to close', detail: `${job.name} is saved. Its windows stay open.`, canUndo: false, mood: 'awake' });
      return;
    }
    const animation = this.play([...closable, ...apps], false);
    await wait(120);
    const [{ closed, failed }, doneNames] = await Promise.all([
      closeItems([...closable, ...maybeOpen], this.urlOptions()),
      Promise.all([
        toQuit.length ? this.core.helper.quitApps(toQuit.map((a) => a.app)).catch(() => [] as string[]) : [],
        hideOnly.length ? this.core.helper.hideApps(hideOnly.map((a) => a.app)).catch(() => [] as string[]) : [],
      ]).then((r) => r.flat()),
    ]);
    // Only report what was really open: an already-closed item that stayed closed isn't a failure.
    for (let i = failed.length - 1; i >= 0; i--) if (failed[i].notOpen) failed.splice(i, 1);
    const done = new Set(doneNames.map((n) => n.toLowerCase()));
    closed.push(...apps.filter((a) => done.has(a.app.toLowerCase())));
    failed.push(...apps.filter((a) => !done.has(a.app.toLowerCase())));
    await animation;
    this.setUndo(closed, entry.frontKey);
    const left = failed.length + entry.items.filter((i) => i.untitled).length;
    this.toast({
      title: `${shortName(job.name)} · ${closed.length} packed`,
      detail: left ? `${left} stayed open. Undo brings them all back.` : 'Tucked away. Undo brings them back.',
      canUndo: closed.length > 0,
      mood: 'sleep',
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
      const pending = { jobId, entryId, items, resolve };
      this.naming = pending;
      const win = showWindow('naming', { onReady: (w) => w.webContents.send('payload:updated') });
      // Closing the box (⌘W, Window → Close) counts as Skip.
      win.once?.('closed', () => {
        if (this.naming === pending) this.finishNaming([]);
      });
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
    const sources = shown.map(iconSource);
    // Don't hold the animation up for long: whatever isn't back in time flies as a plain card.
    await Promise.race([this.core.icons.get(sources), wait(120)]);
    return shown.map((it, i) => ({ label: it.label, icon: this.core.icons.peek(sources[i]) }));
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
      sound: this.core.settings.get().sounds,
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

  /** Something you opened is in a packed folder: offer to bring back the rest. */
  offerUnpack(name: string, more: number): void {
    this.toast({
      title: 'You were working on this',
      detail: `${shortName(name)} has ${more} more ${more === 1 ? 'thing' : 'things'} packed.`,
      canUndo: false,
      action: 'Unpack',
      mood: 'curious',
    });
  }

  private toast(info: ToastInfo): void {
    this.payloads.set('toast', info);
    const win = prepareWindow('toast');
    win.webContents.send('toast:show', info);
    // Let it draw the new text first, then slide it in under the menu bar icon.
    setTimeout(() => showWindow('toast', { near: this.trayBounds() }), 60);
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.hideToast(), info.action ? OFFER_MS : info.canUndo ? UNDO_MS : 4000);
  }

  /** Let the toast fade up and away, then hide its window. A new toast cancels the hide. */
  private hideToast(): void {
    const win = getWindow('toast');
    if (!win?.isVisible()) return;
    win.webContents.send('toast:leave');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => getWindow('toast')?.hide(), TOAST_LEAVE_MS);
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
    this.hideToast();
    const animation = this.play(u.items, true);
    await openItems(u.items, u.frontKey, this.core.settings.get());
    await this.core.dropTidied(u.items);
    this.core.notify();
    await animation;
    this.toast({ title: 'Back where you left off', detail: `${u.items.length} ${u.items.length === 1 ? 'item' : 'items'} reopened.`, canUndo: false, mood: 'wide' });
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
        this.toast({ title: 'Climate essay · 9 items packed', detail: 'Everything else is still open.', canUndo: true, mood: 'sleep' });
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
    this.hideToast();
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


