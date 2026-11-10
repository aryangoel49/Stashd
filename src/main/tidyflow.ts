// Runs "Tidy up after saving": name untitled files, close the job's windows while they fly
// into the menu bar icon, then show a small toast with Undo for 2 seconds.

import os from 'node:os';
import path from 'node:path';
import { screen, type Rectangle } from 'electron';
import type { FlyItem, Item, NamingRequest, OverlayPlay, Route, SortingAnswer, SortingRequest, ToastInfo } from '../shared/types';
import { CHAT_APPS } from './capture';
import { appsToQuit, type Core } from './core';
import { matchKeys, siteOf } from './urls';
import { iconSource } from './icons';
import { changeChromeGroup, openItems, screens } from './open';
import { fitFrame } from './frames';
import { usedMemoryMB } from './ram';
import { canName, cleanFileName, closeItems, freePath, saveUntitled, suggestedFileName } from './tidy';
import type { UrlOptions } from './urls';
import { getWindow, prepareWindow, showWindow } from './windows';

// Undo is offered briefly: long enough to catch a slip, short enough to stay out of the way.
const UNDO_MS = 2_000;
/** Tidy all's Desk clear card: long enough to watch the memory roll back and catch Undo, then gone (pointing holds it). */
const DESK_MS = 5_000;
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
  /** The sorting card waiting for your answer. */
  private sorting: ((a: SortingAnswer) => void) | null = null;
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
   * Tidy all: closes everything at once (Smart: once the work is in folders, see Core.tidyAll), then shows
   * the Desk clear card. With "Keep this tab" (keepFront), the tab or window you're on stays open, and so does its app.
   */
  tidyAll(keepFront = false): Promise<void> {
    if (this.tidyingAll) return this.tidyingAll;
    if (this.naming) this.finishNaming([]);
    this.queue = this.queue.then(async () => {
      try {
        const before = usedMemoryMB();
        const plan = await this.core.tidyAll({ keepFront });
        const keptApp = plan.kept?.app.toLowerCase() ?? null;
        const keptKeys = new Set(plan.kept ? matchKeys(plan.kept) : []);
        const keptApps = new Set(keptApp ? [keptApp] : []);
        const stays = (i: Item) => matchKeys(i).some((k) => keptKeys.has(k));
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
        const animation = this.play([...items, ...apps, ...otherItems], false, 'tidy');
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
        this.setUndo(closed, null, DESK_MS);
        await this.core.rememberTidied(closed);
        // The new folders "Sort into folders" made: name them one by one, without holding anything up.
        if (plan.made.length) void this.askSorted(plan.made);
        // The desk's payoff: where everything went, the memory it gave back, and what's next.
        // Apps take a moment to hand their memory back after quitting.
        const [start, end] = await Promise.all([before, wait(1200).then(usedMemoryMB)]);
        const freedMB = start != null && end != null && start - end >= 100 ? start - end : null;
        const total = freedMB ? await this.core.addFreed(freedMB).catch(() => null) : null;
        const closedKeys = new Set(closed.map((i) => i.key));
        const went = [
          ...plan.saved.map((s) => ({ label: `into ${shortName(s.name)}`, count: saved.find((e) => e.jobId === s.jobId)?.items.filter((i) => i.kind !== 'app' && closedKeys.has(i.key)).length ?? 0 })),
          ...plan.filed.map((f) => ({ label: `into ${shortName(f.name)}`, count: f.count })),
          { label: 'on your Break shelf', count: plan.breaks },
          { label: plan.loose === 1 ? 'tab closed' : 'tabs closed', count: plan.loose },
          { label: 'apps quit', count: closed.filter((i) => i.kind === 'app').length },
        ].filter((w) => w.count > 0);
        const next = plan.saved[0]?.name ?? plan.filed[0]?.name ?? null;
        // What flies into the folder: the apps that quit (with their real icons), then documents and tabs, one per app or site.
        const appPath = new Map((win?.apps ?? []).filter((a) => a.path).map((a) => [a.name.toLowerCase(), a.path]));
        const seen = new Set<string>();
        const flying = [...closed.filter((i) => i.kind === 'app'), ...closed.filter((i) => i.kind === 'doc'), ...closed.filter((i) => i.kind === 'tab')]
          .filter((i) => {
            const id = (i.kind === 'tab' && i.url ? siteOf(i.url) : null) ?? i.app.toLowerCase();
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
          })
          .slice(0, 6)
          .map((i): Item => (i.kind === 'app' && appPath.has(i.app.toLowerCase()) ? { ...i, path: appPath.get(i.app.toLowerCase()) } : i));
        this.toast({
          title: 'Desk clear',
          count: closed.length,
          // Recently closed has them for 10 minutes; the card stays quiet about it (Undo is right there).
          detail: '',
          canUndo: true,
          mood: 'sleep',
          ms: DESK_MS,
          desk: {
            went,
            freedMB,
            next: next ? `Next time, ${shortName(next)} is ready to pick up.` : null,
            beforeMB: start,
            afterMB: end,
            totalMB: Math.round(os.totalmem() / 1024 / 1024),
            lifetimeMB: total?.mb,
            times: total?.times,
            items: flying,
          },
        }, DESK_MS);
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

  /** One card per new folder: a name (its guess filled in) and what you were doing. Skip leaves it as it is. */
  private async askSorted(made: { jobId: string; name: string; items: Item[] }[]): Promise<void> {
    for (const [i, m] of made.entries()) {
      this.payloads.set('sorting', { jobId: m.jobId, name: m.name, index: i + 1, total: made.length, summary: whatsIn(m.items) } satisfies SortingRequest);
      showWindow('sorting', { onReady: (w) => w.webContents.send('payload:updated') });
      const answer = await new Promise<SortingAnswer>((resolve) => (this.sorting = resolve));
      this.sorting = null;
      if (answer === 'rest') break;
      if (answer) await this.core.describeFolder(m.jobId, answer.name, answer.note).catch(() => undefined);
    }
    getWindow('sorting')?.hide();
  }

  finishSorting(answer: SortingAnswer): void {
    this.sorting?.(answer);
  }

  finishNaming(names: (string | null)[]): void {
    const n = this.naming;
    this.naming = null;
    getWindow('naming')?.close();
    n?.resolve(n.items.map((_, i) => names[i] ?? null));
  }

  // ---------- animation ----------

  /** One icon per app (8 Chrome tabs are one Chrome icon marked 8), the busiest first, at most 6. */
  private async withIcons(items: Item[], placesOn?: Rectangle): Promise<FlyItem[]> {
    const groups = new Map<string, { label: string; source: string; count: number; frame?: Item['frame'] }>();
    for (const it of items) {
      const source = iconSource(it);
      const g = groups.get(source);
      if (g) {
        g.count++;
        g.frame ??= it.frame;
      } else groups.set(source, { label: it.kind === 'doc' && !it.app ? it.label : it.app, source, count: 1, frame: it.frame });
    }
    const shown = [...groups.values()].sort((a, b) => b.count - a.count).slice(0, 6);
    const sources = shown.map((g) => g.source);
    // Don't hold the animation up for long: whatever isn't back in time flies as a plain card.
    await Promise.race([this.core.icons.get(sources), wait(120)]);
    // Where each window will open (window places on), as Unpack fits it to today's screens; only the ones
    // on the overlay's screen can be shown.
    const here = placesOn ? screens() : [];
    const place = (f: Item['frame']): FlyItem['frame'] => {
      if (!placesOn || !f) return undefined;
      const r = fitFrame(f, here);
      const d = placesOn;
      const box = r.full ? { x: d.x, y: d.y, w: d.width, h: d.height } : r;
      const inside = box.x >= d.x && box.y >= d.y && box.x + box.w <= d.x + d.width && box.y + box.h <= d.y + d.height;
      return inside ? { x: box.x - d.x, y: box.y - d.y, w: box.w, h: box.h } : undefined;
    };
    return shown.map((g) => ({ label: g.label, icon: this.core.icons.peek(g.source), count: g.count, frame: place(g.frame) }));
  }

  /**
   * Plays the fly-in animation, or the unpack one (reverse). Unpacking holds its window shapes until
   * `opened` settles (everything has been asked to open). Resolves when it has finished.
   */
  private async play(items: Item[], reverse: boolean, kind: 'pack' | 'tidy' = 'pack', opened?: Promise<void>): Promise<void> {
    const tray = this.trayBounds();
    const display = screen.getDisplayMatching(tray);
    const flies = await this.withIcons(items, reverse && this.core.settings.get().windowPlaces ? display.bounds : undefined);
    const play: OverlayPlay = {
      items: flies,
      target: { x: tray.x + tray.width / 2 - display.bounds.x, y: tray.y + tray.height / 2 - display.bounds.y },
      size: { width: display.bounds.width, height: display.bounds.height },
      reverse,
      sound: this.core.settings.get().sounds ? (reverse ? 'unpack' : kind) : null,
      total: items.length,
    };
    this.payloads.set('overlay', play);
    const win = prepareWindow('overlay');
    win.setBounds(display.bounds);
    const finished = new Promise<void>((resolve) => {
      this.overlayDone = resolve;
      // Safety net in case the window never reports back (Unpack waits for things to open, up to 6 s).
      setTimeout(resolve, reverse ? 7000 : 2200);
    });
    win.webContents.send('overlay:play', play);
    win.showInactive();
    const release = () => {
      if (this.payloads.get('overlay') === play) win.webContents.send('overlay:release');
    };
    if (reverse) void (opened ?? Promise.resolve()).then(release, release);
    await finished;
    this.overlayDone = null;
    if (!reverse) this.landed();
    if (this.payloads.get('overlay') === play) win.hide();
  }

  /** Unpacking: things come out of Stashd while they reopen. Call what it returns once they've been opened. */
  unpackAnimation(items: Item[]): () => void {
    let opened!: () => void;
    const done = new Promise<void>((r) => (opened = r));
    void this.play(items.filter((i) => i.kind !== 'app' || items.length <= 3), true, 'pack', done);
    return opened;
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
    let opened!: () => void;
    const animation = this.play(u.items, true, 'pack', new Promise<void>((r) => (opened = r)));
    await openItems(u.items, u.frontKey, this.core.settings.get()).finally(opened);
    await this.core.dropTidied(u.items);
    this.core.notify();
    await animation;
    this.toast({ title: 'Back where you left off', detail: `${u.items.length} ${u.items.length === 1 ? 'item' : 'items'} reopened.`, canUndo: false, mood: 'wide' });
  }

  /** Development only: show the tidy screens with pretend data, without touching any real window. */
  /** Development only (WWI_DEMO_DESK): the Desk clear card with sample numbers, to check how it looks. */
  demoDesk(): void {
    // WWI_DEMO_DESK_MS keeps it up longer, to look at it frame by frame.
    const ms = Number(process.env.WWI_DEMO_DESK_MS) || 4_500;
    this.toast(
      {
        title: 'Desk clear',
        count: 23,
        detail: '',
        canUndo: true,
        mood: 'sleep',
        ms,
        desk: {
          went: [{ label: 'into Climate essay', count: 7 }, { label: 'on your Break shelf', count: 2 }, { label: 'tabs closed', count: 7 }, { label: 'apps quit', count: 4 }],
          freedMB: 3174,
          next: 'Next time, Climate essay is ready to pick up.',
          beforeMB: 28774,
          afterMB: 25600,
          totalMB: 49152,
          lifetimeMB: 42700,
          times: 12,
          items: [
            { key: 'app:Google Chrome', kind: 'app', label: 'Google Chrome', detail: '', app: 'Google Chrome', path: '/Applications/Google Chrome.app' },
            { key: 'app:Spotify', kind: 'app', label: 'Spotify', detail: '', app: 'Spotify', path: '/Applications/Spotify (old).app' },
            { key: 'app:Wispr Flow', kind: 'app', label: 'Wispr Flow', detail: '', app: 'Wispr Flow', path: '/Applications/Wispr Flow.app' },
            { key: 'app:Notes', kind: 'app', label: 'Notes', detail: '', app: 'Notes', path: '/System/Applications/Notes.app' },
            { key: 'tab:https://www.youtube.com/watch?v=x', kind: 'tab', label: 'lofi - YouTube', detail: '', app: 'Google Chrome', url: 'https://www.youtube.com/watch?v=x' },
          ],
        },
      },
      ms,
    );
  }

  /**
   * Development only (WWI_DEMO_UNPACK=places or tray): the unpack animation with pretend things, opening
   * "finishing" after 1.5 s, and a few frames saved to WWI_CAPTURE_DIR. Opens nothing.
   */
  async demoUnpack(mode: string): Promise<void> {
    await this.core.settings.update({ windowPlaces: mode === 'places' });
    const d = screen.getPrimaryDisplay().workArea;
    const at = (x: number, y: number, w: number, h: number) => ({ x: Math.round(d.x + d.width * x), y: Math.round(d.y + d.height * y), w: Math.round(d.width * w), h: Math.round(d.height * h) });
    const items: Item[] = [
      { key: 'tab:a', kind: 'tab', label: 'Sea level rise', detail: '', app: 'Google Chrome', frame: at(0.04, 0.04, 0.48, 0.5) },
      { key: 'tab:b', kind: 'tab', label: 'Google Scholar', detail: '', app: 'Google Chrome', frame: at(0.04, 0.04, 0.48, 0.5) },
      { key: 'doc:/Applications/Pages.app', kind: 'doc', label: 'Climate essay', detail: '', app: 'Pages', path: '/Applications/Pages.app', frame: at(0.55, 0.06, 0.4, 0.45) },
      { key: 'app:Notes', kind: 'app', label: 'Notes', detail: '', app: 'Notes', path: '/System/Applications/Notes.app', frame: at(0.08, 0.58, 0.36, 0.38) },
    ];
    const opened = this.unpackAnimation(items);
    setTimeout(opened, 1500);
    if (!process.env.WWI_CAPTURE_DIR) return;
    for (const ms of [250, 450, 650, 900, 1500, 1800, 2100]) {
      setTimeout(() => {
        void getWindow('overlay')?.webContents.capturePage().then((img) =>
          import('node:fs/promises').then((fs) => fs.writeFile(path.join(process.env.WWI_CAPTURE_DIR!, `unpack-${mode}-${ms}.png`), img.resize({ width: 1000 }).toPNG())),
        );
      }, ms);
    }
  }

  /**
   * Development only (WWI_DEMO_SORT, with WWI_FAKE_CAPTURE): Tidy all's sorting on the pretend desk, without
   * closing anything, then each naming card in turn (saved to WWI_CAPTURE_DIR, then answered).
   */
  async demoSort(): Promise<void> {
    const plan = await this.core.tidyAll({});
    console.log('[demo-sort] new folders:', JSON.stringify(plan.made.map((m) => ({ name: m.name, items: m.items.map((i) => i.label) }))));
    console.log('[demo-sort] closed, not saved:', JSON.stringify(plan.close.map((i) => i.label)));
    const answers = plan.made.map((m, i) => setTimeout(() => {
      const win = getWindow('sorting');
      void win?.webContents.capturePage().then(async (img) => {
        if (process.env.WWI_CAPTURE_DIR) await import('node:fs/promises').then((fs) => fs.writeFile(path.join(process.env.WWI_CAPTURE_DIR!, `sort-${i + 1}.png`), img.toPNG()));
        this.finishSorting(i === 0 ? { name: `${m.name} (renamed)`, note: 'Checking the sorting cards' } : null);
      });
    }, 2500 * (i + 1)));
    await this.askSorted(plan.made);
    answers.forEach(clearTimeout);
    const jobs = await this.core.store.list();
    console.log('[demo-sort] folders now:', JSON.stringify(jobs.map((j) => j.name)));
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

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** "3 tabs", "2 tabs and a document", "a document, a folder and a chat". */
export function whatsIn(items: Item[]): string {
  const kinds: [Item['kind'] | 'chat', string, string][] = [
    ['tab', 'a tab', 'tabs'],
    ['doc', 'a document', 'documents'],
    ['folder', 'a folder', 'folders'],
    ['chat', 'a chat', 'chats'],
  ];
  const kindOf = (i: Item) => (i.kind === 'app' ? 'chat' : i.kind);
  const parts = kinds
    .map(([k, one, many]) => {
      const n = items.filter((i) => kindOf(i) === k).length;
      return n === 0 ? '' : n === 1 ? one : `${n} ${many}`;
    })
    .filter(Boolean);
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : (parts[0] ?? '');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
