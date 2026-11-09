// Runs "Tidy up after saving": name untitled files, close the job's windows while they fly
// into the menu bar icon, then show a small toast with Undo for 2 seconds.

import os from 'node:os';
import path from 'node:path';
import { screen, type Rectangle } from 'electron';
import type { FlyItem, Item, NamingRequest, OverlayPlay, Route, ToastInfo } from '../shared/types';
import { CHAT_APPS } from './capture';
import { appsToQuit, type Core } from './core';
import { matchKeys } from './urls';
import { iconSource } from './icons';
import { changeChromeGroup, openItems } from './open';
import { usedMemoryMB } from './ram';
import { canName, cleanFileName, closeItems, freePath, saveUntitled, suggestedFileName } from './tidy';
import type { UrlOptions } from './urls';
import { getWindow, prepareWindow, showWindow } from './windows';

// Undo is offered briefly: long enough to catch a slip, short enough to stay out of the way.
const UNDO_MS = 2_000;
/** Tidy all's Desk clear card stays long enough to read where things went (Undo works all that time). */
const DESK_MS = 6_000;
/** An offer stays a little longer than Undo: it needs reading first. */
const OFFER_MS = 8_000;
/** Just longer than the toast's 150ms fade-out, so the window hides after it has gone. */
const TOAST_LEAVE_MS = 170;
/** Windows close once the tray has come in (OverlayPlay APPEAR), so they seem to go into it. */
const CLOSE_AFTER_MS = 200;

export class TidyFlow {
  private payloads = new Map<Route, unknown>();
  private naming: { jobId: string; entryId: string; items: Item[]; resolve: (names: (string | null)[]) => void } | null = null;
  private undo: { items: Item[]; frontKey: string | null; timer: NodeJS.Timeout } | null = null;
  private toastTimer: NodeJS.Timeout | null = null;
  /** When the toast goes by itself, or, while you point at it, how long it has left. */
  private toastEnds = 0;
  private toastLeft: number | null = null;
  /** A card waiting for your answer (automatic saving), resolved by its button, its close, or time running out. */
  private asked: ((a: 'act' | 'dismiss' | 'timeout' | 'replaced') => void) | null = null;
  private overlayDone: (() => void) | null = null;
  /** Tidies run one after another, so a second Pack up never takes over the first one's naming box. */
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly core: Core,
    private readonly trayBounds: () => Rectangle,
    /** Things just landed in the menu bar: the icon winks. */
    private readonly landed: () => void = () => undefined,
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

  /** The Tidy all that's running, if one is. */
  tidyingAll: Promise<void> | null = null;

  /**
   * Tidy all: save open folders, keep loose tabs in a folder of their own, then close it all at once.
   * With "Keep this tab" (keepFront), the tab or window you're on stays open, and so does its app.
   */
  tidyAll(keepFront = false, desk?: { keep: string[] }): Promise<void> {
    if (this.tidyingAll) return this.tidyingAll;
    if (this.naming) this.finishNaming([]);
    this.queue = this.queue.then(async () => {
      try {
        const before = usedMemoryMB();
        const plan = await this.core.tidyAll({ keepFront, keep: desk?.keep, fromDesk: !!desk });
        const keptApp = plan.kept?.app.toLowerCase() ?? null;
        const keptKeys = new Set([...(plan.kept ? matchKeys(plan.kept) : []), ...plan.keptKeys]);
        const keptApps = new Set([...(keptApp ? [keptApp] : []), ...plan.keptApps.map((a) => a.toLowerCase())]);
        const stays = (i: Item) => keptKeys.size > 0 && matchKeys(i).some((k) => keptKeys.has(k));
        const saved = await Promise.all(plan.saved.map((s) => this.core.store.entry(s.jobId, s.entryId)));
        const items = [...saved.flatMap((e) => e.items.filter((i) => i.kind !== 'app' && !i.untitled && !i.notOpen)), ...plan.close].filter(
          // A document's app stays open with it, so its other documents stay too (they close only when their app quits).
          (i) => !stays(i) && !(i.kind === 'doc' && i.app.toLowerCase() === keptApp),
        );
        // The apps of the folders it packed go too, like Pack up: quit (asking about unsaved work),
        // Claude and ChatGPT only hidden. Then every other app except Claude (only Tidy all does this;
        // Pack up quits just the folder's apps). The app you're keeping stays.
        const apps = saved.flatMap((e) => e.items.filter((i) => i.kind === 'app' && !i.notOpen && !keptApps.has(i.app.toLowerCase())));
        const win = await Promise.resolve().then(() => this.core.helper.windows()).catch(() => null);
        const mine = new Set(apps.map((a) => a.app.toLowerCase()));
        const others = win ? appsToQuit(win.apps.map((a) => a.name).filter((n) => !mine.has(n.toLowerCase()) && !keptApps.has(n.toLowerCase()))) : [];
        const otherItems = others.map((n): Item => ({ key: `app:${n}`, kind: 'app', label: n, detail: '', app: n }));

        // Everything that will go flies, the other apps too, so nothing just vanishes on its own.
        const animation = this.play([...items, ...apps, ...otherItems], false);
        await Promise.all([wait(CLOSE_AFTER_MS), releaseChromeGroups(items)]);
        // Documents aren't closed one by one: their apps quit below anyway (asking about unsaved work),
        // and some (Preview) are slow to answer a close. Tabs and Finder windows are closed, since
        // Finder stays and a browser might reopen its tabs.
        const docs = items.filter((i) => i.kind === 'doc');
        const [{ closed }, doneNames] = await Promise.all([closeItems(items.filter((i) => i.kind !== 'doc'), this.urlOptions()), this.quitOrHide(apps)]);
        const done = new Set(doneNames.map((n) => n.toLowerCase()));
        closed.push(...apps.filter((a) => done.has(a.app.toLowerCase())));
        // Each quits like ⌘Q, so anything unsaved still asks first.
        const rest = others.filter((n) => !done.has(n.toLowerCase()));
        if (rest.length) {
          const quit = new Set((await this.core.helper.quitApps(rest).catch(() => [] as string[])).map((n) => n.toLowerCase()));
          closed.push(...otherItems.filter((a) => quit.has(a.app.toLowerCase())));
          for (const n of quit) done.add(n);
        }
        // A document counts as closed once its app has quit.
        closed.push(...docs.filter((d) => done.has(d.app.toLowerCase())));
        await animation;
        if (!closed.length) {
          this.toast({ title: 'Already tidy', detail: plan.kept ? `Only ${shortName(plan.kept.label)} is open.` : 'Nothing to close.', canUndo: false, mood: 'awake' });
          return;
        }
        this.setUndo(closed, null, desk ? DESK_MS : UNDO_MS);
        await this.core.rememberTidied(closed);
        if (desk) {
          // The desk's payoff: where everything went, the memory it gave back, and what's next.
          const [start, end] = await Promise.all([before, wait(600).then(usedMemoryMB)]);
          const closedKeys = new Set(closed.map((i) => i.key));
          const went = [
            ...plan.saved.map((s) => ({ label: `into ${shortName(s.name)}`, count: saved.find((e) => e.jobId === s.jobId)?.items.filter((i) => i.kind !== 'app' && closedKeys.has(i.key)).length ?? 0 })),
            ...plan.filed.map((f) => ({ label: `into ${shortName(f.name)}`, count: f.count })),
            { label: 'on your Break shelf', count: plan.breaks },
            { label: plan.loose === 1 ? 'tab closed' : 'tabs closed', count: plan.loose },
            { label: 'apps quit', count: closed.filter((i) => i.kind === 'app').length },
          ].filter((w) => w.count > 0);
          const next = plan.saved[0]?.name ?? plan.filed[0]?.name ?? null;
          this.toast({
            title: 'Desk clear',
            count: closed.length,
            // Recently closed has them for 10 minutes; the card stays quiet about it (Undo is right there).
            detail: '',
            canUndo: true,
            mood: 'sleep',
            ms: DESK_MS,
            desk: { went, freedMB: start != null && end != null && start - end >= 100 ? start - end : null, next: next ? `Next time, ${shortName(next)} is ready to pick up.` : null },
          }, DESK_MS);
          return;
        }
        const filed = plan.filed.reduce((n, f) => n + f.count, 0);
        const parts = [
          plan.saved.length ? `${plan.saved.length} ${plan.saved.length === 1 ? 'folder' : 'folders'} packed` : '',
          filed ? `${filed} ${filed === 1 ? 'tab' : 'tabs'} added to ${plan.filed.length === 1 ? shortName(plan.filed[0].name) : `${plan.filed.length} folders`}` : '',
          plan.breaks ? `${plan.breaks} on your Break shelf` : '',
        ].filter(Boolean);
        if (plan.kept) parts.unshift(`kept ${shortName(plan.kept.label)} open`);
        this.toast({
          title: 'Tidied up',
          count: closed.length,
          detail: parts.length ? `${capitalise(parts.join(', '))}. All in Recently closed for 10 min.` : 'In Recently closed for 10 min, in case.',
          canUndo: closed.length > 0,
          mood: 'sleep',
        });
      } catch {
        this.toast({ title: "Couldn't tidy up", detail: 'Nothing was closed.', canUndo: false, mood: 'curious' });
      } finally {
        this.core.notify();
        this.tidyingAll = null;
      }
    });
    this.tidyingAll = this.queue;
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
    await Promise.all([wait(CLOSE_AFTER_MS), releaseChromeGroups([...closable, ...maybeOpen])]);
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
      title: `${shortName(job.name)} packed`,
      count: closed.length,
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

  /** One icon per app (8 Chrome tabs are one Chrome icon marked 8), the busiest first, at most 6. */
  private async withIcons(items: Item[]): Promise<FlyItem[]> {
    const groups = new Map<string, { label: string; source: string; count: number }>();
    for (const it of items) {
      const source = iconSource(it);
      const g = groups.get(source);
      if (g) g.count++;
      else groups.set(source, { label: it.kind === 'doc' && !it.app ? it.label : it.app, source, count: 1 });
    }
    const shown = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 6);
    const sources = shown.map((g) => g.source);
    // Don't hold the animation up for long: whatever isn't back in time flies as a plain card.
    await Promise.race([this.core.icons.get(sources), wait(120)]);
    return shown.map((g) => ({ label: g.label, icon: this.core.icons.peek(g.source), count: g.count }));
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
      total: items.length,
    };
    this.payloads.set('overlay', play);
    const win = prepareWindow('overlay');
    win.setBounds(display.bounds);
    const finished = new Promise<void>((resolve) => {
      this.overlayDone = resolve;
      // Safety net in case the window never reports back.
      setTimeout(resolve, 2200);
    });
    win.webContents.send('overlay:play', play);
    win.showInactive();
    await finished;
    this.overlayDone = null;
    if (!reverse) this.landed();
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

  /** ⌃S put these videos on the Break shelf: close them (into the menu bar), with Undo. */
  shelve(items: Item[]): Promise<void> {
    this.queue = this.queue.then(async () => {
      try {
        const animation = this.play(items, false);
        await Promise.all([wait(CLOSE_AFTER_MS), releaseChromeGroups(items)]);
        const { closed } = await closeItems(items, this.urlOptions());
        await animation;
        this.setUndo(closed, null);
        this.toast({
          title: closed.length === 1 ? 'On your Break shelf' : `${closed.length} on your Break shelf`,
          detail: 'In Continue watching, ready when you are.',
          canUndo: closed.length > 0,
          mood: 'sleep',
        });
      } catch {
        this.toast({ title: "Couldn't put that away", detail: 'It stays open.', canUndo: false, mood: 'curious' });
      } finally {
        this.core.notify();
      }
    });
    return this.queue;
  }

  /** Things have sat unused for a while: offer Tidy all. */
  offerTidy(apps: string[]): void {
    const names = apps.slice(0, 2).join(' and ') + (apps.length > 2 ? ` and ${apps.length - 2} more` : '');
    this.toast({ title: 'Some things are just sitting open', detail: `${names} ${apps.length === 1 ? "hasn't" : "haven't"} been used in a while.`, canUndo: false, action: 'Tidy all', mood: 'curious' });
  }

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

  /** Shows a card with one button and waits: 'act' (the button), 'dismiss' (closed), 'timeout', or 'replaced'. */
  ask(card: { title: string; detail: string; action: string; seconds: number; subtle?: boolean }): Promise<'act' | 'dismiss' | 'timeout' | 'replaced'> {
    return new Promise((resolve) => {
      this.toast({ title: card.title, detail: card.detail, canUndo: false, action: card.action, subtle: card.subtle, mood: 'curious', ms: card.seconds * 1000 }, card.seconds * 1000);
      this.asked = resolve;
    });
  }

  /** The toast's button was pressed: true if it answered a waiting card (the caller then does nothing else). */
  toastActed(): boolean {
    if (!this.asked) return false;
    this.settle('act');
    this.hideToast();
    return true;
  }

  private settle(a: 'act' | 'dismiss' | 'timeout' | 'replaced'): void {
    const done = this.asked;
    this.asked = null;
    done?.(a);
  }

  private toast(info: ToastInfo, ms?: number): void {
    this.settle('replaced');
    this.payloads.set('toast', info);
    const win = prepareWindow('toast');
    win.webContents.send('toast:show', info);
    // Let it draw the new text first, then slide it in under the menu bar icon.
    setTimeout(() => showWindow('toast', { near: this.trayBounds() }), 60);
    this.toastLeft = null;
    this.runToastTimer(ms ?? (info.action ? OFFER_MS : info.canUndo ? UNDO_MS : 4000));
  }

  private runToastTimer(ms: number): void {
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastEnds = Date.now() + ms;
    this.toastTimer = setTimeout(() => {
      this.settle('timeout');
      this.hideToast();
    }, ms);
  }

  /** You're pointing at the toast: it waits for you, then takes up where it left off (with a moment to spare). */
  holdToast(on: boolean): void {
    if (!getWindow('toast')?.isVisible()) return;
    if (on && this.toastLeft == null) {
      if (this.toastTimer) clearTimeout(this.toastTimer);
      this.toastLeft = Math.max(0, this.toastEnds - Date.now());
    } else if (!on && this.toastLeft != null) {
      const left = Math.max(this.toastLeft, 1500);
      this.toastLeft = null;
      this.runToastTimer(left);
    }
  }

  /** Let the toast fade up and away, then hide its window. A new toast cancels the hide. */
  private hideToast(): void {
    const win = getWindow('toast');
    if (!win?.isVisible()) return;
    this.toastLeft = null;
    win.webContents.send('toast:leave');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => getWindow('toast')?.hide(), TOAST_LEAVE_MS);
  }

  private setUndo(items: Item[], frontKey: string | null, ms = UNDO_MS): void {
    if (this.undo) clearTimeout(this.undo.timer);
    this.undo = items.length ? { items, frontKey, timer: setTimeout(() => (this.undo = null), ms) } : null;
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
  /** Development only (WWI_DEMO_DESK): the Desk clear card with sample numbers, to check how it looks. */
  demoDesk(): void {
    this.toast(
      {
        title: 'Desk clear',
        count: 23,
        detail: '',
        canUndo: true,
        mood: 'sleep',
        ms: 60_000,
        desk: { went: [{ label: 'into Climate essay', count: 7 }, { label: 'on your Break shelf', count: 2 }, { label: 'tabs closed', count: 7 }, { label: 'apps quit', count: 4 }], freedMB: 3174, next: 'Next time, Climate essay is ready to pick up.' },
      },
      60_000,
    );
  }

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
        for (const ms of [800, 1000, 1100, 1200, 1300, 1420]) {
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
    this.settle('dismiss');
    this.hideToast();
  }
}

/** Long job names are cut at a word so the toast stays tidy. */
function shortName(name: string, max = 24): string {
  if (name.length <= max) return name;
  const cut = name.slice(0, max).replace(/\s+\S*$/, '');
  return `${cut || name.slice(0, max)}…`;
}

/**
 * Takes Chrome tabs out of their tab group just before they close. A group whose tabs are closed stays in
 * Chrome's saved groups (the bookmarks bar), and the next Unpack makes a new one with the same name, so
 * copies pile up. A group emptied by ungrouping is gone instead. Never holds the tidy up for long.
 */
async function releaseChromeGroups(items: Item[]): Promise<void> {
  const byGroup = new Map<string, string[]>();
  for (const i of items) if (i.kind === 'tab' && i.browser === 'chrome' && i.group && i.url) byGroup.set(i.group, [...(byGroup.get(i.group) ?? []), i.url]);
  if (!byGroup.size) return;
  const all = (async () => {
    for (const [name, urls] of byGroup) await changeChromeGroup('ungroup', name, urls);
  })();
  await Promise.race([all, wait(3000)]);
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}


