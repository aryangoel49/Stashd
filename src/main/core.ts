// The app's actions, shared by the menu bar, keyboard shortcuts and the windows.

import os from 'node:os';
import path from 'node:path';
import { mostlyOpen, type BriefView, type Capture, type DeskPile, type TidyDesk, type BreakItem, type BreakPlace, type BreakShelf, type BrowserName, type Item, type Job, type JobSummary, type ProjectCard, type OpenResult, type OpenState, type Suggestion, type SaveEntry, type SavePreview, type SaveRequest, type SaveResult, type TidyFront } from '../shared/types';
import { aiJobName, writeBrief, type BriefWriter } from './brief';
import { basicBrief } from './brief/basic';
import { capture, CHAT_APPS, frontItemKey, frontThing } from './capture';
import type { Helper, WindowsInfo } from './helper';
import {
  classify,
  isLifestyle,
  learn,
  learnedAvoid,
  learnedLifestyleApps,
  recordAppUnticks,
  suggestName,
  type Classified,
} from './jobs/match';
import { documentFrequency, FIT_SUGGEST, hasProof, jobFit, jobProfile, meaningText, profileTexts, scoreItem, SURE, type MeaningLookup, type Profile } from './jobs/relevance';
import { suggest, type FolderData } from './jobs/suggest';
import { sortIntoWorks } from './jobs/sort';
import { buildCard } from './jobs/card';
import type { Meaning } from './meaning';
import type { SiteSorter } from './sites';
import { BROWSER_APPS } from './collectors/browsers';
import { changeChromeGroup, finished, openForBreak, openItems, videoProgress } from './open';
import { BreakStore, isBreakItem, videoKey } from './breaks';
import { isListedApp, listApps, type MacApp } from './apps';
import { appPathOf } from '../shared/places';
import { run } from './exec';
import { findDocument } from './capture/spotlight';
import { shortDir } from './capture/docs';
import { appsMemoryMB, usedMemoryMB } from './ram';
import type { SettingsStore } from './settings';
import { readJsonSafely } from './safety';
import { JobStore, writeFileKeepingLast } from './store';
import { IconCache, iconSource } from './icons';
import { Memory } from './memory';
import { cleanTabUrl, looseKey, matchKeys, siteOf } from './urls';

interface State {
  currentJobId: string | null;
  appUnticks: Record<string, string[]>;
  /** What was open just after a job was unpacked, so later additions can be suggested. */
  baseline: { jobId: string; keys: string[] } | null;
  /** What the last Tidy all closed, and when (shown for 10 minutes, then forgotten). */
  recentTidy?: { at: string; items: Item[] } | null;
  /** Suggestions the person said no to: id → until when (ISO date), or 'never' to never ask again. */
  dismissed: Record<string, string>;
  /** macOS has been asked once for Accessibility (to see which Claude or ChatGPT chat is open). */
  askedChatAccess?: boolean;
  /** Memory Tidy all has freed so far (MB), and how many times it has run from the desk. */
  freed?: { mb: number; times: number };
}

interface PendingSave {
  capture: Promise<Capture>;
  /** What the save box last showed, to learn from what the user changed. */
  offered?: Classified;
  /** Items from the job that aren't open right now (kept unless unticked). */
  kept?: Item[];
  /** The folder you pressed Pack up on, so the box doesn't have to guess. */
  target?: string;
}

export interface OpenLook {
  state: Record<string, OpenState>;
  /** Loose keys of every tab, document and folder open right now. */
  open: Set<string>;
  jobs: Job[];
  latest: (SaveEntry | null)[];
  /** Everything open right now. */
  items: Item[];
  /** The whole look, as a save would see it. */
  cap: Capture;
  /** The item in front (the tab or document you're on), if any. */
  front: string | null;
}

export interface TidyAllPlan {
  /** Folders saved just now (open ones, and the loose tabs' folder): their open things close. */
  saved: { jobId: string; entryId: string; name: string }[];
  /** Other things to close: open, and already in a folder. */
  close: Item[];
  /** Stray tabs added to a folder they clearly belong to (and closed). */
  filed: { jobId: string; name: string; count: number }[];
  loose: number;
  /** Break tabs put on the Break shelf. */
  breaks: number;
  /** "Keep this tab": the tab or window you were on, saved like the rest but left open. */
  kept: Item | null;
  /** What you chose to keep open on the desk (loose keys), and apps you kept running. */
  keptKeys: string[];
  keptApps: string[];
  /** "Sort into folders": new folders made just now from open work that belonged to no folder. */
  made: { jobId: string; entryId: string; name: string; items: Item[] }[];
}

/** How long the desk's look at what's open is used when you press Tidy up. */
const DESK_FRESH_MS = 3 * 60_000;

/** Tidy all quits every app except these: Claude (you work with it alongside everything), Finder and Stashd. */
const KEEP_RUNNING = ['Claude', 'Finder', 'Stashd', 'Electron'];

/** After Tidy all has closed things, the apps still running that should quit. Each quits like ⌘Q, so unsaved work still asks. */
export function appsToQuit(running: string[]): string[] {
  const keep = new Set(KEEP_RUNNING.map((a) => a.toLowerCase()));
  return running.filter((a) => !keep.has(a.toLowerCase()));
}

/**
 * A stray tab joins a folder only when it clearly belongs: a sure match, and clearly a better match
 * than for any other folder. Otherwise it's left out.
 */
export const HOME_MARGIN = 1.5;

/** What Tidy all closed stays listed this long, so a tab closed by mistake can come back. */
export const RECENT_TIDY_MS = 10 * 60_000;

/** How long one look at what's open is reused. */
const OPEN_CHECK_MS = 6_000;

/** What Tidy all closes when it's in no folder: tabs, and Finder windows (Finder itself never quits, so
 *  its windows would otherwise stay open). Documents close when their apps quit. */
const isLoose = (i: Item): boolean => i.kind === 'tab' || i.kind === 'folder';

export class Core {
  private listeners: (() => void)[] = [];
  private state: State;
  private readonly stateFile: string;
  private pending: PendingSave | null = null;
  /** What the Tidy all desk last looked at (Tidy up acts on it). */
  private deskCapture: { at: number; cap: Capture } | null = null;
  private writing = new Set<string>();
  writers: BriefWriter[] = [];
  private openCache: { at: number; result: Promise<OpenLook> } | null = null;
  private suggestCache: { at: number; result: Promise<Suggestion[]> } | null = null;
  /** The last accepted suggestion, so it can be undone for a few seconds. */
  private lastUndo: { id: string; run: () => Promise<void> } | null = null;
  /** Items just taken out of a folder ("jobId\nkey"), so Undo can put them back for a minute. */
  private removed = new Map<string, Item>();
  /** Real file and app icons, fetched once and kept. */
  readonly icons: IconCache;
  /** The Break shelf (what you watch and listen to). */
  readonly breaks: BreakStore;
  /** The on-device meaning model (optional: sorting works without it). */
  meaning?: Meaning;
  /** Stashd's memory (memory.db): what happened and what it learned. Optional: Stashd works without it. */
  memory?: Memory;
  /** Learns which unknown sites are for breaks (sites.ts). Optional. */
  sites?: SiteSorter;

  constructor(
    readonly settings: SettingsStore,
    readonly store: JobStore,
    readonly helper: Helper,
    dataDir: string,
    private readonly selfNames: string[],
    /** Development only: a canned capture, so testing the UI never asks other apps anything. */
    private readonly fakeCapture?: () => Promise<Capture>,
  ) {
    this.icons = new IconCache(helper);
    this.breaks = new BreakStore(dataDir);
    this.stateFile = path.join(dataDir, 'state.json');
    const raw = (readJsonSafely(dataDir, 'state.json') ?? {}) as Partial<State>;
    this.state = {
      currentJobId: typeof raw.currentJobId === 'string' ? raw.currentJobId : null,
      appUnticks: raw.appUnticks && typeof raw.appUnticks === 'object' ? raw.appUnticks : {},
      baseline:
        raw.baseline && typeof raw.baseline.jobId === 'string' && Array.isArray(raw.baseline.keys)
          ? { jobId: raw.baseline.jobId, keys: raw.baseline.keys.filter((k): k is string => typeof k === 'string') }
          : null,
      dismissed: raw.dismissed && typeof raw.dismissed === 'object' ? raw.dismissed : {},
      askedChatAccess: raw.askedChatAccess === true,
      recentTidy: raw.recentTidy && typeof raw.recentTidy.at === 'string' && Array.isArray(raw.recentTidy.items) ? raw.recentTidy : null,
    };
  }

  onChanged(l: () => void): void {
    this.listeners.push(l);
  }

  notify(): void {
    this.openCache = null;
    this.suggestCache = null;
    for (const l of this.listeners) l();
  }

  private async saveState(): Promise<void> {
    await writeFileKeepingLast(this.stateFile, JSON.stringify(this.state, null, 2));
  }

  get currentJobId(): string | null {
    return this.state.currentJobId;
  }

  private async setCurrent(id: string | null): Promise<void> {
    this.state.currentJobId = id;
    await this.saveState();
  }

  // ---------- saving ----------

  /** Called the moment the shortcut is pressed. `early` is the window order taken before our box appeared. */
  beginSave(early?: Promise<WindowsInfo>, target?: string): void {
    this.pending = { capture: this.fakeCapture ? this.fakeCapture() : capture(this.settings.get(), this.helper, this.selfNames, early, undefined, !this.state.askedChatAccess), target };
    this.pending.capture.catch(() => undefined);
    if (!this.state.askedChatAccess) {
      void this.pending.capture.then((cap) => {
        if (!cap.items.some((i) => CHAT_APPS.includes(i.app))) return;
        this.state.askedChatAccess = true;
        return this.saveState();
      }).catch(() => undefined);
    }
  }

  /** `asFolder`: you said "Save as a folder instead" to the Break offer, so the videos go in a folder. */
  async preview(opts: { asNew?: boolean; asFolder?: boolean; jobId?: string } = {}, own?: PendingSave): Promise<SavePreview> {
    if (!own && !this.pending) this.beginSave();
    // Hold on to this save: Escape or a new shortcut press may replace this.pending while we work.
    const pending = own ?? this.pending!;
    const cap = await pending.capture;
    const settings = this.settings.get();
    const learned = learnedLifestyleApps(this.state.appUnticks);
    const candidates = cap.items.filter((i) => !isLifestyle(i, settings, learned));
    const frontKey = frontItemKey(candidates, cap.appOrder);
    // A streaming site Stashd hasn't seen before? Sort it first, so it doesn't land in a work folder.
    await this.sites?.look(candidates);

    // Your jobs and what was in each, ready to compare against.
    const jobs: { job: Job; latest: SaveEntry | null; profile: ReturnType<typeof jobProfile> | null }[] = [];
    for (const j of (await this.store.list()).filter((x) => !x.done).slice(0, 40)) {
      const latest = await this.store.latest(j.id);
      // Folders saved before project cards existed get theirs now (once).
      const card = j.card ?? (latest ? await this.refreshCard(j.id).catch(() => undefined) : undefined);
      jobs.push({ job: j, latest, profile: latest ? jobProfile(j.name, latest.note, latest.items, learnedAvoid(j.prefs), card) : null });
    }

    // Meaning vectors from the on-device model, for everything open and every job. (Skipped if it's unavailable.)
    const vectors = new Map<string, number[]>();
    const lookup: MeaningLookup = (t) => vectors.get(t);
    const addVectors = async (texts: string[]) => {
      const got = await this.meaning?.vectors(texts.filter((t) => !vectors.has(t)));
      got?.forEach((v, t) => vectors.set(t, v));
    };
    await addVectors([
      ...candidates.map(meaningText).filter((t): t is string => !!t),
      ...jobs.flatMap((j) => (j.profile ? profileTexts(j.profile) : [])),
    ]);

    // How well does what's open fit each of your jobs? (Best first, for the "Save to" picker.)
    const fits = jobs.map((j) => ({ job: j.job, latest: j.latest, fit: j.profile ? jobFit(candidates, j.profile, lookup, frontKey) : 0 }));
    fits.sort((a, b) => b.fit - a.fit);

    // Which job is this? The one you picked, the one you have open, or a clear match. Otherwise new.
    // Only a chat (Claude, ChatGPT) and break things open: a chat on its own doesn't mean you're back on
    // a folder, so no folder is guessed. With a video or show open, ⌃S offers to put it on your Break shelf.
    const workThere = candidates.some((i) => i.kind !== 'app' && !isBreakItem(i));
    let job: Job | null = null;
    let isSuggestion = false;
    if (!opts.asNew) {
      const wanted = opts.jobId ?? pending.target ?? this.state.currentJobId;
      if (wanted && (await this.store.exists(wanted))) job = await this.store.get(wanted);
      if (job?.done && !opts.jobId) job = null;
      if (!job && workThere && fits[0] && fits[0].fit >= FIT_SUGGEST) {
        job = fits[0].job;
        isSuggestion = true;
      }
    }

    const latest = job ? (fits.find((f) => f.job.id === job!.id)?.latest ?? (await this.store.latest(job.id))) : null;
    const previous = latest?.items ?? [];
    const baseline = job && this.state.baseline?.jobId === job.id ? new Set(this.state.baseline.keys) : undefined;
    if (job) await addVectors(profileTexts(jobProfile(job.name, latest?.note ?? '', previous, learnedAvoid(job.prefs), job.card)));
    const classified = classify({
      items: cap.items,
      job,
      previous,
      name: job?.name ?? '',
      note: latest?.note ?? '',
      settings,
      learnedLifestyleApps: learned,
      baseline,
      frontKey,
      meaning: vectors.size ? lookup : undefined,
    });
    const offered = opts.asFolder ? { ...classified, sure: [...classified.sure, ...classified.breaks], breaks: [] } : classified;
    // Things that belong to this job but aren't open right now (closed by accident, say) are kept.
    const openKeys = new Set(cap.items.map(looseKey));
    const kept = previous
      .filter((i) => !matchKeys(i).some((k) => openKeys.has(k)) && (job?.prefs.hide[i.key] ?? 0) < 2 && !isLifestyle(i, settings, learned))
      .map((i) => ({ ...i, notOpen: true, active: false }));
    pending.offered = offered;
    pending.kept = kept;
    // Nothing to work on is open, or you're on a video and nothing else would go in a new folder:
    // ⌃S offers the Break shelf instead of making a folder out of the video.
    const breakTime = !opts.asFolder && !opts.jobId && !pending.target && (!workThere || (!job && !offered.sure.some((i) => !isBreakItem(i))));
    const visibleItems = [...offered.sure, ...offered.likely, ...offered.maybe];
    const front = frontItemKey(visibleItems, cap.appOrder);
    const before = new Set(previous.flatMap(matchKeys));
    return {
      jobId: job?.id ?? null,
      jobName: job?.name ?? null,
      isSuggestion,
      lastSavedAt: latest?.savedAt ?? null,
      newCount: job ? offered.sure.filter((i) => !before.has(looseKey(i))).length : 0,
      suggestedName: job?.name ?? suggestName(offered.sure, front),
      sure: offered.sure,
      likely: offered.likely,
      maybe: offered.maybe,
      kept,
      hiddenCount: offered.hidden.length,
      breakCount: offered.breaks.length,
      onlyBreaks: breakTime ? candidates.filter((i) => isBreakItem(i) && !/^\/?$/.test(new URL(i.url!).pathname)) : [],
      frontKey: front,
      tidyUp: settings.tidyUp,
      errors: cap.errors,
      why: offered.why,
      jobOptions: fits.map((f) => ({
        id: f.job.id,
        name: f.job.name,
        match: f.fit >= FIT_SUGGEST ? 'strong' : f.fit > 0.1 ? 'some' : 'none',
        current: f.job.id === this.state.currentJobId,
      })),
    };
  }

  async commitSave(req: SaveRequest, own?: PendingSave): Promise<SaveResult> {
    const pending = own ?? this.pending;
    if (!pending) throw new Error('Nothing to save. Press the shortcut again.');
    const cap = await pending.capture;
    const offered = pending.offered ?? { sure: cap.items, likely: [], maybe: [], hidden: [], breaks: [], why: {} };
    const wanted = new Set(req.keys);
    // A tab sitting where it redirected after Unpack (a sign-in page) is saved as the original address.
    const before = req.jobId ? ((await this.store.latest(req.jobId).catch(() => null))?.items ?? []) : [];
    const original = (i: Item) => before.find((p) => p.kind === 'tab' && looseKey(p) !== looseKey(i) && (p.seenAs ?? []).includes(looseKey(i)));
    const open = cap.items
      .filter((i) => wanted.has(i.key))
      .map((i) => {
        const p = i.kind === 'tab' ? original(i) : undefined;
        return p ? { ...p, window: i.window, active: i.active, notOpen: undefined } : { ...i, notOpen: undefined };
      });
    const openKeys = new Set(open.map((i) => i.key));
    const items = [...open, ...(pending.kept ?? []).filter((i) => wanted.has(i.key) && !openKeys.has(i.key))];
    const now = new Date();

    let job: Job;
    if (req.jobId && (await this.store.exists(req.jobId))) {
      job = await this.store.get(req.jobId);
      job.name = req.name;
    } else {
      // A second folder with the same name gets a number, so the two can be told apart.
      const taken = new Set((await this.store.list()).map((j) => j.name.trim().toLowerCase()));
      let name = req.name.trim();
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${req.name.trim()} ${n}`;
      job = await this.store.create(name, now);
    }
    // What you tick and untick teaches a folder; an automatic save made no choices, so it teaches nothing.
    if (!req.auto) job.prefs = learn(job.prefs, offered, req.keys);
    job.updatedAt = now.toISOString();
    job.done = false;
    await this.store.put(job);

    // Only apps that were ticked for you and that you unticked count. Bare apps start unticked, so
    // leaving them alone says nothing (otherwise Xcode or Figma would soon be treated as everyday).
    if (!req.auto) this.state.appUnticks = recordAppUnticks(this.state.appUnticks, job.id, offered.sure, req.keys);
    const entry: SaveEntry = {
      version: 2,
      id: await this.store.freeEntryId(job.id, now),
      jobId: job.id,
      savedAt: now.toISOString(),
      note: req.note,
      items,
      frontKey: frontItemKey(open, cap.appOrder) ?? frontItemKey(items, cap.appOrder),
      appOrder: cap.appOrder,
      tidied: req.tidy,
      errors: cap.errors,
      ...(req.auto ? { auto: true } : {}),
    };
    const previousAuto = req.auto ? await this.store.latest(job.id).catch(() => null) : null;
    await this.store.saveEntry(entry);
    // Each folder keeps only its latest automatic save, so they never pile up. Your own saves always stay.
    if (previousAuto?.auto) await this.store.deleteEntry(job.id, previousAuto.id).catch(() => undefined);
    await this.store.prune(job.id);
    if (!req.auto) {
      try {
        this.memory?.recordSave({ folder: job.id, file: entry.id, how: 'manual', kind: 'manual', items, at: now });
      } catch {
        // The memory is a helper; a save never fails because of it.
      }
      await this.settings.update({ tidyUp: req.tidy });
      await this.setCurrent(req.tidy ? null : job.id);
      // After a save, "new since you unpacked" starts again from what's open now.
      this.state.baseline = req.tidy ? null : { jobId: job.id, keys: cap.items.map((i) => i.key) };
      await this.saveState();
    }
    // Only clear it if no newer save box has started in the meantime.
    if (this.pending === pending) this.pending = null;
    this.notify();
    await this.refreshCard(job.id).catch(() => undefined);
    // The folder may be deleted while its brief is still being written; that's fine. An automatic save's brief
    // is written when you come back to it, so saves made while you're away don't use up AI calls.
    if (!req.auto) void this.ensureBrief(job.id, entry.id).catch(() => undefined);
    return { jobId: job.id, entryId: entry.id, needsNaming: req.tidy ? items.filter((i) => i.untitled) : [] };
  }

  /**
   * Tidy all. Every folder you have open is saved (what clearly belongs to it, like Pack up), anything
   * open that's already in another folder is just closed, and so are the tabs left over that belong
   * nowhere (listed under "Recently closed" for 10 minutes). Everyday sites (mail, music) stay.
   * Returns the things to close; closing is up to the caller.
   */
  /**
   * The Tidy all desk: what Tidy all would do right now, sorted into piles (into a folder, onto the Break
   * shelf, closed, apps that quit, staying open). Nothing is saved, closed or moved. What it saw is kept
   * for a couple of minutes, so pressing Tidy up acts on exactly what you were shown.
   */
  async planTidy(opts: { keepFront?: boolean } = {}): Promise<TidyDesk> {
    const settings = this.settings.get();
    const [cap, win, memoryMB] = await Promise.all([
      this.fakeCapture ? this.fakeCapture() : capture(settings, this.helper, this.selfNames),
      this.fakeCapture ? Promise.resolve(null) : this.helper.windows().catch(() => null),
      usedMemoryMB(),
    ]);
    this.deskCapture = { at: Date.now(), cap };
    await this.sites?.look(cap.items);
    const learned = learnedLifestyleApps(this.state.appUnticks);
    const openKeys = new Set(cap.items.map(looseKey));
    const front = frontThing(cap.items, cap.appOrder);
    const isFront = (i: Item) => !!front && matchKeys(i).includes(looseKey(front));
    const claimed = new Set<string>();
    const claim = (items: Item[]) => items.forEach((i) => matchKeys(i).forEach((k) => claimed.add(k)));
    const openItem = (i: Item) => cap.items.find((c) => matchKeys(i).includes(looseKey(c)));
    const folders = new Map<string, DeskPile>();
    const folderPile = (jobId: string, name: string, note: string) => {
      const p = folders.get(jobId) ?? { id: `folder:${jobId}`, kind: 'folder' as const, title: name, note, items: [] };
      folders.set(jobId, p);
      return p;
    };
    // Apps quit in their own pile, so a folder's pile shows its tabs and documents.
    const shown = (items: Item[]) => items.filter((i) => i.kind !== 'app' && !(opts.keepFront && isFront(i)));

    for (const job of await this.store.list()) {
      const latest = await this.store.latest(job.id);
      if (!latest) continue;
      const content = latest.items.filter((i) => i.kind !== 'app');
      const openNow = content.filter((i) => matchKeys(i).some((k) => openKeys.has(k)));
      if (!openNow.length) continue;
      const isOpen = !job.done && (job.id === this.state.currentJobId || mostlyOpen({ open: openNow.length, total: content.length }));
      if (!isOpen) {
        claim(openNow);
        folderPile(job.id, job.name, 'Already saved here').items.push(...shown(openNow.map(openItem).filter((i): i is Item => !!i)));
        continue;
      }
      // What Pack up would save (the save box's own guess), without saving it.
      const p = await this.preview({ jobId: job.id }, { capture: Promise.resolve(cap), target: job.id });
      const keys = new Set([...p.sure, ...p.kept].filter((i) => !matchKeys(i).some((k) => claimed.has(k))).map((i) => i.key));
      folderPile(job.id, job.name, 'Saved and put away').items.push(...shown(cap.items.filter((i) => keys.has(i.key))));
      claim(p.sure);
      claim(content);
    }

    const strays = cap.items.filter((i) => isLoose(i) && !claimed.has(looseKey(i)) && !isLifestyle(i, settings, learned));
    const homes = await this.homesFor(strays, new Set([...folders.keys()].filter((id) => folders.get(id)!.note !== 'Already saved here')));
    for (const [jobId, items] of homes) {
      const name = (await this.store.get(jobId).catch(() => null))?.name ?? 'A folder';
      const pile = folderPile(jobId, name, 'These belong here');
      pile.items.push(...shown(items));
    }
    const homed = new Set([...homes.values()].flat().map((i) => i.key));
    const left = strays.filter((i) => !homed.has(i.key) && !(opts.keepFront && isFront(i)));
    const breaks = left.filter(isBreakItem);
    const loose = left.filter((i) => !isBreakItem(i));

    // Every app quits except a few (Claude, Finder), like Tidy all does.
    const running = win ? win.apps.map((a) => a.name) : [...new Set(cap.items.map((i) => i.app))];
    const quitting = appsToQuit(running).filter((n) => !(opts.keepFront && front?.kind === 'app' && front.app === n));
    // With the app's own location, so its real icon shows (looking an app up by name misses some, like Spotify).
    const appPath = new Map([
      ...cap.items.filter((i) => i.kind === 'app' && i.path).map((i): [string, string] => [i.app, i.path!]),
      ...(win?.apps ?? []).filter((a) => a.path).map((a): [string, string] => [a.name, a.path]),
    ]);
    const appItem = (n: string): Item => ({ key: `app:${n}`, kind: 'app', label: n, detail: '', app: n, ...(appPath.has(n) ? { path: appPath.get(n) } : {}) });
    const staying = [
      ...(opts.keepFront && front ? [front] : []),
      ...cap.items.filter((i) => i.kind === 'tab' && isLifestyle(i, settings, learned)),
      ...running.filter((n) => !appsToQuit([n]).length && n !== 'Stashd' && n !== 'Electron').map(appItem),
    ];

    const piles: DeskPile[] = [
      ...[...folders.values()].filter((p) => p.items.length),
      { id: 'break', kind: 'break', title: 'Break shelf', note: 'Pick these up later', items: breaks },
      { id: 'close', kind: 'close', title: 'Closing', note: 'You can reopen them for 10 min', items: loose },
      { id: 'apps', kind: 'apps', title: 'Quitting', note: 'Unsaved work still asks first', items: quitting.map(appItem) },
      { id: 'stay', kind: 'stay', title: 'Staying open', note: '', items: staying },
    ];
    // What the apps that quit are using now: what Tidy up should give back.
    const quittingItems = quitting.map(appItem).filter((i) => i.path);
    const byPath = await appsMemoryMB(quittingItems.map((i) => i.path!));
    const appMB = Object.fromEntries(quittingItems.filter((i) => (byPath?.get(i.path!) ?? 0) > 0).map((i) => [i.key, byPath!.get(i.path!)!]));
    return { piles: piles.filter((p) => p.items.length || p.kind === 'stay'), frontKey: front?.key ?? null, memoryMB, totalMB: Math.round(os.totalmem() / 1024 / 1024), appMB };
  }

  async tidyAll(opts: { keepFront?: boolean; keep?: string[]; fromDesk?: boolean } = {}): Promise<TidyAllPlan> {
    const settings = this.settings.get();
    // After the desk: act on what you were shown (if it's recent), not on a fresh look.
    const desk = opts.fromDesk && this.deskCapture && Date.now() - this.deskCapture.at < DESK_FRESH_MS ? this.deskCapture.cap : null;
    this.deskCapture = null;
    const cap = desk ?? (this.fakeCapture ? await this.fakeCapture() : await capture(settings, this.helper, this.selfNames));
    await this.sites?.look(cap.items);
    const learned = learnedLifestyleApps(this.state.appUnticks);
    const openKeys = new Set(cap.items.map(looseKey));
    const kept = opts.keepFront ? frontThing(cap.items, cap.appOrder) : null;
    // What you chose to keep open on the desk (tap a tab or app there).
    const keepKeys = new Set(opts.keep ?? []);
    const keptLoose = new Set(cap.items.filter((i) => keepKeys.has(i.key)).map(looseKey));
    const isKept = (i: Item) => (!!kept && matchKeys(i).includes(looseKey(kept))) || keepKeys.has(i.key) || matchKeys(i).some((k) => keptLoose.has(k));
    const plan: TidyAllPlan = { saved: [], close: [], filed: [], loose: 0, breaks: 0, kept, keptKeys: [...keptLoose], keptApps: [...keepKeys].filter((k) => k.startsWith('app:')).map((k) => k.slice(4)), made: [] };
    const claimed = new Set<string>();
    const claim = (items: Item[]) => items.forEach((i) => matchKeys(i).forEach((k) => claimed.add(k)));
    const openItem = (i: Item) => cap.items.find((c) => matchKeys(i).includes(looseKey(c)));

    for (const job of await this.store.list()) {
      const latest = await this.store.latest(job.id);
      if (!latest) continue;
      const content = latest.items.filter((i) => i.kind !== 'app');
      const openNow = content.filter((i) => matchKeys(i).some((k) => openKeys.has(k)));
      if (!openNow.length) continue;
      const isOpen = !job.done && (job.id === this.state.currentJobId || mostlyOpen({ open: openNow.length, total: content.length }));
      if (!isOpen) {
        // Already saved in this folder: close it, nothing to save.
        claim(openNow);
        plan.close.push(...openNow.map(openItem).filter((i): i is Item => !!i && !isKept(i)));
        continue;
      }
      // An open folder: save it the way Pack up would, then close what was saved.
      this.pending = { capture: Promise.resolve(cap), target: job.id };
      const p = await this.preview({ jobId: job.id });
      // (Not what another folder already holds.)
      const keys = [...p.sure, ...p.kept].filter((i) => !matchKeys(i).some((k) => claimed.has(k))).map((i) => i.key);
      const r = await this.commitSave({ jobId: job.id, name: job.name, note: latest.note ?? '', keys, tidy: true });
      claim(p.sure);
      claim(content);
      plan.saved.push({ jobId: r.jobId, entryId: r.entryId, name: job.name });
    }

    // Tabs and Finder windows left over: one that clearly belongs to one of your other folders is added
    // to it. The rest belong nowhere and just close (they stay in "Recently closed" for a while, in case one mattered).
    // (The one you're keeping open stays where it is: not filed, not on the Break shelf.)
    const strays = cap.items.filter((i) => isLoose(i) && !claimed.has(looseKey(i)) && !isLifestyle(i, settings, learned) && !isKept(i));
    // "Sort into folders" looks after open documents and AI chats that belong to no folder too.
    const otherWork = settings.tidySort
      ? cap.items.filter(
          (i) =>
            ((i.kind === 'doc' && !i.untitled) || (i.kind === 'app' && !!i.chat)) &&
            !matchKeys(i).some((k) => claimed.has(k)) &&
            !isLifestyle(i, settings, learned) &&
            !isKept(i),
        )
      : [];
    const homes = await this.homesFor([...strays, ...otherWork], new Set(plan.saved.map((s) => s.jobId)));
    for (const [jobId, items] of homes) {
      const name = await this.addToFolder(jobId, items);
      plan.filed.push({ jobId, name, count: items.length });
    }
    const homed = new Set([...homes.values()].flat().map((i) => i.key));
    // "Sort into folders": what's left that is real work (two or more things that belong together; not
    // videos, not what you keep) becomes new folders, one per piece of work, saved now so nothing is lost;
    // you name them afterwards. Things that fit with nothing else close, as always.
    const sorted = new Set<string>();
    if (settings.tidySort) {
      const work = [...strays, ...otherWork].filter((i) => !homed.has(i.key) && !isBreakItem(i));
      const texts = work.map(meaningText).filter((t): t is string => !!t);
      const vectors = texts.length ? await this.meaning?.vectors(texts, 4000).catch(() => null) : null;
      for (const items of sortIntoWorks(work, vectors ? (t) => vectors.get(t) : undefined)) {
        this.pending = { capture: Promise.resolve(cap) };
        // Claude (or Stashd AI) names it, when one is set up and answers quickly; otherwise the words it shares.
        const ai = await Promise.race([aiJobName(this.writers, items).catch(() => null), new Promise<null>((r) => setTimeout(() => r(null), 3000))]);
        const r = await this.commitSave({ jobId: null, name: ai ?? suggestName(items, null), note: '', keys: items.map((i) => i.key), tidy: true });
        const job = await this.store.get(r.jobId);
        plan.saved.push({ jobId: r.jobId, entryId: r.entryId, name: job.name });
        plan.made.push({ jobId: r.jobId, entryId: r.entryId, name: job.name, items });
        for (const i of items) sorted.add(i.key);
      }
    }
    plan.close.push(...strays.filter((i) => !sorted.has(i.key)));
    // What you were watching or listening to goes on the Break shelf, to pick up later.
    const breakItems = strays.filter((i) => !homed.has(i.key) && isBreakItem(i));
    // A site's home page (youtube.com) isn't something to pick up: it's already one of your places.
    const toShelf = breakItems.filter((i) => {
      try {
        return new URL(i.url!).pathname.replace(/\/+$/, '') !== '';
      } catch {
        return false;
      }
    });
    if (toShelf.length) {
      // Videos you watched to the end don't need picking up.
      const { finishedOnes, rest } = await this.splitFinished(toShelf);
      for (const f of finishedOnes) await this.breaks.removeLoose(videoKey(f.url ?? ''));
      if (rest.length) await this.breaks.add(rest);
    }
    plan.breaks = breakItems.length;
    plan.loose = strays.filter((i) => !homed.has(i.key) && !sorted.has(i.key)).length - breakItems.length;
    this.pending = null;
    this.notify();
    return plan;
  }

  /** What "Keep this tab" would leave open: the tab or window you're on, with its app's icon. */
  async tidyFront(): Promise<TidyFront | null> {
    // What's open can be a few seconds old, but which app is in front must be now: you may just have switched.
    const [look, win] = await Promise.all([this.lookAtOpen(), this.fakeCapture ? null : this.helper.windows().catch(() => null)]);
    const known = new Set(look.cap.appOrder);
    const order = win ? [...win.order.filter((n) => known.has(n)), ...look.cap.appOrder.filter((n) => !win.order.includes(n))] : look.cap.appOrder;
    const item = frontThing(look.items, order);
    if (!item) return null;
    const source = iconSource(item);
    await Promise.race([this.icons.get([source]), new Promise((r) => setTimeout(r, 300))]);
    return { label: item.label, app: item.app, kind: item.kind, icon: this.icons.peek(source) };
  }

  /** For each stray item, the one folder it clearly belongs to (if any). Finished folders and `skip` aren't offered. */
  private async homesFor(strays: Item[], skip: Set<string>): Promise<Map<string, Item[]>> {
    const homes = new Map<string, Item[]>();
    if (!strays.length) return homes;
    const folders: { id: string; profile: Profile }[] = [];
    for (const j of (await this.store.list()).filter((x) => !x.done && !skip.has(x.id))) {
      const latest = await this.store.latest(j.id);
      if (latest) folders.push({ id: j.id, profile: jobProfile(j.name, latest.note, latest.items, learnedAvoid(j.prefs), j.card) });
    }
    if (!folders.length) return homes;
    const vectors = new Map<string, number[]>();
    const texts = [...strays.map(meaningText).filter((t): t is string => !!t), ...folders.flatMap((f) => profileTexts(f.profile))];
    (await this.meaning?.vectors(texts).catch(() => undefined))?.forEach((v, t) => vectors.set(t, v));
    const lookup: MeaningLookup | undefined = vectors.size ? (t) => vectors.get(t) : undefined;
    const df = documentFrequency(strays);
    for (const item of strays) {
      const ranked = folders.map((f) => ({ id: f.id, ...scoreItem(item, f.profile, df, null, lookup) })).sort((a, b) => b.score - a.score);
      const [best, next] = ranked;
      if (best.score < SURE || (next && best.score < next.score * HOME_MARGIN)) continue;
      // A video joins a work folder only with real evidence (shared words, the folder's group), else it's a break.
      if (isBreakItem(item) && !hasProof(best.why)) continue;
      homes.set(best.id, [...(homes.get(best.id) ?? []), item]);
    }
    return homes;
  }

  /** Adds items to a folder's latest save (a new save, so the brief is rewritten). Returns the folder's name. */
  async addToFolder(jobId: string, items: Item[]): Promise<string> {
    const job = await this.store.get(jobId);
    const latest = await this.store.latest(jobId);
    const now = new Date();
    const have = new Set((latest?.items ?? []).flatMap(matchKeys));
    const added = items.filter((i) => !have.has(looseKey(i))).map((i) => ({ ...i, notOpen: undefined, active: false }));
    const entry: SaveEntry = {
      ...(latest ?? { version: 2, jobId, note: '', items: [], frontKey: null }),
      id: await this.store.freeEntryId(jobId, now),
      savedAt: now.toISOString(),
      items: [...(latest?.items ?? []), ...added],
      brief: undefined,
      tidied: true,
    } as SaveEntry;
    await this.store.saveEntry(entry);
    await this.store.prune(jobId);
    job.updatedAt = now.toISOString();
    await this.store.put(job);
    await this.refreshCard(jobId).catch(() => undefined);
    void this.ensureBrief(jobId, entry.id).catch(() => undefined);
    return job.name;
  }

  // ---------- the Break shelf ----------

  /**
   * Videos that just closed: the ones you watched to the end leave Continue watching, the rest go to the
   * top of it. How far you got is looked at again when you open the Break page, in case the extension's
   * last note of it arrived after this.
   */
  async videosClosed(items: Item[]): Promise<void> {
    const { finishedOnes, rest } = await this.splitFinished(items);
    for (const f of finishedOnes) await this.breaks.removeLoose(videoKey(f.url ?? ''));
    if (rest.length) await this.breaks.add(rest);
    this.progressDue = true;
    this.notify();
  }

  private progressDue = false;

  /** Videos you finished leave Continue watching; the rest get their progress bar. */
  private async refreshProgress(): Promise<void> {
    this.progressDue = false;
    const shelf = await this.breaks.get();
    const { finishedOnes, rest } = await this.splitFinished(shelf.items);
    if (!finishedOnes.length && !rest.some((i) => i.progress)) return;
    for (const f of finishedOnes) await this.breaks.removeLoose(videoKey(f.url ?? ''));
    await this.breaks.setProgress(rest);
    this.notify();
  }

  /** The rest keep how far in you got, for the progress bar on Continue watching. */
  private async splitFinished(items: Item[]): Promise<{ finishedOnes: Item[]; rest: (Item & Pick<BreakItem, 'progress'>)[] }> {
    const s = this.settings.get();
    const progress = await videoProgress((u) => cleanTabUrl(u, { keepQueryStrings: s.keepQueryStrings, excludedDomains: s.excludedDomains })).catch(() => new Map<string, { t: number; d: number }>());
    const finishedOnes = items.filter((i) => finished(progress.get(videoKey(i.url ?? ''))));
    const rest = items.filter((i) => !finishedOnes.includes(i)).map((i) => {
      const p = progress.get(videoKey(i.url ?? ''));
      return p ? { ...i, progress: p } : i;
    });
    return { finishedOnes, rest };
  }

  breakShelf(): Promise<BreakShelf> {
    if (this.progressDue) void this.refreshProgress().catch(() => undefined);
    return this.breaks.get();
  }

  /** The apps on this Mac, for adding one to Your places. */
  macApps(): Promise<MacApp[]> {
    return listApps();
  }

  /** Open something from the Break shelf (or one of your places) where you chose. An app place opens the app. */
  async openBreak(url: string): Promise<void> {
    const app = appPathOf(url);
    if (app) {
      if (!(await isListedApp(app))) throw new Error('That app isn’t on this Mac any more.');
      await run('open', [app], { timeoutMs: 10_000 });
      return;
    }
    const shelf = await this.breaks.get();
    await openForBreak(url, shelf.browser);
    await this.breaks.opened(url);
    this.notify();
  }

  async changeBreak(change: { browser?: BrowserName | 'window'; removeItem?: string; addPlace?: BreakPlace; renamePlace?: BreakPlace; removePlace?: string; orderPlaces?: string[] }): Promise<BreakShelf> {
    if (change.browser) await this.breaks.setBrowser(change.browser);
    if (change.removeItem) await this.breaks.remove(change.removeItem);
    if (change.addPlace) {
      const app = appPathOf(change.addPlace.url);
      if (app ? !(await isListedApp(app)) : !/^https?:$/.test(new URL(change.addPlace.url).protocol)) throw new Error('That can’t be added as a place.');
      await this.breaks.addPlace(change.addPlace);
    }
    if (change.renamePlace) await this.breaks.renamePlace(change.renamePlace.url, change.renamePlace.name);
    if (change.removePlace) await this.breaks.removePlace(change.removePlace);
    if (change.orderPlaces) await this.breaks.orderPlaces(change.orderPlaces);
    this.notify();
    return this.breaks.get();
  }

  /** Adds what one Tidy all freed to the running total; returns the new total. */
  async addFreed(mb: number): Promise<{ mb: number; times: number }> {
    const was = this.state.freed ?? { mb: 0, times: 0 };
    this.state.freed = { mb: was.mb + Math.max(0, Math.round(mb)), times: was.times + 1 };
    await this.saveState();
    return this.state.freed;
  }

  /** What Tidy all just closed: kept for 10 minutes, then forgotten. */
  async rememberTidied(items: Item[]): Promise<void> {
    items = withoutRepeats(items);
    this.state.recentTidy = items.length ? { at: new Date().toISOString(), items } : null;
    await this.saveState();
    this.notify();
  }

  recentlyTidied(): { at: string; until: string; items: Item[] } | null {
    const r = this.state.recentTidy;
    if (!r) return null;
    const until = Date.parse(r.at) + RECENT_TIDY_MS;
    if (!r.items.length || Date.now() > until) {
      this.state.recentTidy = null;
      void this.saveState().catch(() => undefined);
      return null;
    }
    return { at: r.at, until: new Date(until).toISOString(), items: r.items };
  }

  /** Undo brought these back: they're no longer "recently closed". */
  async dropTidied(items: Item[]): Promise<void> {
    const r = this.state.recentTidy;
    if (!r) return;
    const back = new Set(items.map((i) => i.key));
    await this.rememberTidied(r.items.filter((i) => !back.has(i.key)));
  }

  /** Bring back things Tidy all closed (one, or all when no key is given). They leave the list. */
  async reopenTidied(key?: string): Promise<OpenResult> {
    const r = this.recentlyTidied();
    if (!r) throw new Error('That list has gone (it only stays for 10 minutes).');
    const items = key ? r.items.filter((i) => i.key === key) : r.items;
    const result = await openItems(items, null, this.settings.get());
    const back = new Set(items.map((i) => i.key));
    await this.rememberTidied(r.items.filter((i) => !back.has(i.key)));
    return result;
  }

  /**
   * ⌃S with only break things open: put these (by key) on the Break shelf. Videos you finished are left
   * off. Returns the items, so they can be closed.
   */
  async shelveBreaks(keys: string[]): Promise<Item[]> {
    const pending = this.pending;
    if (!pending) throw new Error('Nothing to put away. Press the shortcut again.');
    const cap = await pending.capture;
    const wanted = new Set(keys);
    const items = cap.items.filter((i) => wanted.has(i.key) && isBreakItem(i));
    const { finishedOnes, rest } = await this.splitFinished(items);
    for (const f of finishedOnes) await this.breaks.removeLoose(videoKey(f.url ?? ''));
    if (rest.length) await this.breaks.add(rest);
    if (this.pending === pending) this.pending = null;
    this.notify();
    return items;
  }

  /** A better name for a new job from Claude or Apple Intelligence, if either is set up. */
  async aiName(keys: string[]): Promise<string | null> {
    if (!this.pending) return null;
    const cap = await this.pending.capture;
    const wanted = new Set(keys);
    const items = cap.items.filter((i) => wanted.has(i.key));
    return items.length ? aiJobName(this.writers, items) : null;
  }

  cancelSave(): void {
    this.pending = null;
  }

  // ---------- jobs and briefs ----------

  async listJobs(): Promise<JobSummary[]> {
    const out: JobSummary[] = [];
    for (const j of await this.store.list()) {
      const latest = await this.store.latest(j.id);
      out.push({
        id: j.id,
        name: j.name,
        renamed: !!j.renamed,
        pinned: !!j.pinned,
        updatedAt: j.updatedAt,
        done: j.done,
        hint: latest ? hintFrom(latest) : '',
        itemCount: latest?.items.length ?? 0,
        current: j.id === this.state.currentJobId,
        icon: latest ? iconFor(latest.items) : 'stack',
        preview: (latest?.items ?? []).slice(0, 8),
        counts: {
          tabs: latest?.items.filter((i) => i.kind === 'tab').length ?? 0,
          files: latest?.items.filter((i) => i.kind === 'doc' || i.kind === 'folder').length ?? 0,
          apps: latest?.items.filter((i) => i.kind === 'app').length ?? 0,
        },
      });
    }
    return out;
  }

  /**
   * How much of each folder is open right now, from one quick look at what's open. Used so a folder
   * whose tabs and files are all open says so instead of offering an Unpack that would do nothing.
   * Apps don't count (Slack being open doesn't mean a folder is). Kept for a few seconds.
   */
  async openState(): Promise<Record<string, OpenState>> {
    return (await this.lookAtOpen()).state;
  }

  /** One look at what's open: each folder's open count, and the loose keys of everything open. */
  lookAtOpen(): Promise<OpenLook> {
    // Asking browsers and apps what's open costs a little battery, so one look is reused for a few seconds
    // (and thrown away as soon as you save, unpack or change a folder, via notify()).
    if (this.openCache && Date.now() - this.openCache.at < OPEN_CHECK_MS) return this.openCache.result;
    const result = (async (): Promise<OpenLook> => {
      // Only ask the apps your folders actually use (no folder has a Word file? Word isn't asked).
      const jobs = await this.store.list();
      const latest = await Promise.all(jobs.map((j) => this.store.latest(j.id)));
      // (Browsers always: videos you close yourself go to Continue watching.)
      const apps = new Set([...latest.flatMap((e) => (e?.items ?? []).map((i) => i.app)), ...Object.values(BROWSER_APPS).map((b) => b.appName)]);
      const win = this.fakeCapture ? null : await this.helper.windows().catch(() => null);
      const cap = this.fakeCapture
        ? await this.fakeCapture()
        : await capture(this.settings.get(), this.helper, this.selfNames, win ? Promise.resolve(win) : undefined, apps);
      const open = new Set(cap.items.map(looseKey));
      // An app counts as open only with a window showing, not just running in the background or hidden.
      const hidden = new Set(win?.apps.filter((a) => a.hidden).map((a) => a.name) ?? []);
      const showing = win ? new Set(win.order.filter((n) => !hidden.has(n))) : null;
      const isOpen = (i: Item) => (i.kind === 'app' && showing ? showing.has(i.app) : matchKeys(i).some((k) => open.has(k)));
      const out: Record<string, OpenState> = {};
      for (const [n, j] of jobs.entries()) {
        // Apps don't count (Slack being open doesn't mean a folder is), unless a folder holds only apps.
        const all = latest[n]?.items ?? [];
        const content = all.filter((i) => i.kind !== 'app');
        const items = content.length ? content : all;
        out[j.id] = { open: items.filter(isOpen).length, total: items.length };
      }
      void this.sites?.look(cap.items);
      return { state: out, open, jobs, latest, items: cap.items, cap, front: frontItemKey(cap.items, cap.appOrder) };
    })();
    this.openCache = { at: Date.now(), result };
    result.catch(() => (this.openCache = null));
    return result;
  }

  // ---------- automatic saving (see autosave.ts for when) ----------

  /** The folders you're working in right now: the one you're in, and any that are mostly open. */
  foldersInUse(look: OpenLook): string[] {
    return look.jobs.filter((j) => !j.done && (j.id === this.state.currentJobId || mostlyOpen(look.state[j.id]))).map((j) => j.id);
  }

  /**
   * What the thing in front belongs to: a folder (its id), "neutral" (nothing in front, or an everyday app like
   * Mail or Messages, which doesn't mean you left your work), or "other" (anything else: new work, a video).
   */
  frontFolder(look: OpenLook): string | 'neutral' | 'other' {
    const item = look.items.find((i) => i.key === look.front);
    if (!item) return 'neutral';
    if (isLifestyle(item, this.settings.get(), learnedLifestyleApps(this.state.appUnticks))) return 'neutral';
    const keys = matchKeys(item);
    for (const [n, job] of look.jobs.entries()) {
      if (job.done) continue;
      if ((look.latest[n]?.items ?? []).some((i) => matchKeys(i).some((k) => keys.includes(k)))) return job.id;
    }
    return 'other';
  }

  /**
   * Saves these folders by themselves, quietly: only what clearly belongs (what ⌃S would tick), nothing
   * closed, and only if something changed. Never while you have the save box open.
   */
  async autoSave(cap: Capture, jobIds: string[]): Promise<{ jobId: string; entryId: string; name: string }[]> {
    const out: { jobId: string; entryId: string; name: string }[] = [];
    for (const id of jobIds) {
      const plan = await this.autoPlan(cap, id);
      if (!plan) continue;
      const r = await this.commitSave({ jobId: id, name: plan.job.name, note: plan.latest?.note ?? '', keys: plan.keep.map((i) => i.key), tidy: false, auto: true }, plan.own);
      out.push({ jobId: r.jobId, entryId: r.entryId, name: plan.job.name });
    }
    return out;
  }

  /** Would an automatic save of this folder change anything right now? */
  async wouldSave(cap: Capture, jobId: string): Promise<boolean> {
    return !!(await this.autoPlan(cap, jobId));
  }

  /** What an automatic save would hold. Null if there's nothing new, or the folder is gone or finished. */
  private async autoPlan(cap: Capture, id: string): Promise<{ job: Job; latest: SaveEntry | null; keep: Item[]; own: PendingSave } | null> {
    if (this.pending || !(await this.store.exists(id))) return null;
    const job = await this.store.get(id);
    if (job.done) return null;
    const latest = await this.store.latest(id);
    // Its own save, not this.pending: a save box you open in the meantime is left alone.
    const own: PendingSave = { capture: Promise.resolve(cap), target: id };
    const p = await this.preview({ jobId: id }, own);
    if (!p.sure.length) return null;
    const keep = [...p.sure, ...p.kept];
    const now = new Set(keep.map(looseKey));
    const before = new Set((latest?.items ?? []).map(looseKey));
    if (now.size === before.size && [...now].every((k) => before.has(k))) return null;
    return { job, latest, keep, own };
  }

  /** The one folder the thing in front clearly belongs to, though it isn't saved there yet (a new tab on the topic). */
  async homeOf(look: OpenLook): Promise<string | null> {
    const item = look.items.find((i) => i.key === look.front);
    if (!item || item.kind === 'app') return null;
    const [home] = (await this.homesFor([item], new Set())).keys();
    return home ?? null;
  }

  /** "Remove" on an automatic save: it goes, and the folder is back to how it was. Your own saves can't go this way. */
  async removeAutoSave(jobId: string, entryId: string): Promise<void> {
    const entry = await this.store.entry(jobId, entryId).catch(() => null);
    if (!entry?.auto) return;
    await this.store.deleteEntry(jobId, entryId);
    this.notify();
  }

  // ---------- suggestions (merge folders, move strays) ----------

  /** Up to 3 suggestions for tidying folders. Uses the meaning model when it's ready; kept for a few seconds. */
  suggestions(): Promise<Suggestion[]> {
    if (this.suggestCache && Date.now() - this.suggestCache.at < 10_000) return this.suggestCache.result;
    const result = (async () => {
      const folders: FolderData[] = [];
      for (const j of await this.store.list()) {
        if (j.done) continue;
        const latest = await this.store.latest(j.id);
        if (latest) folders.push({ id: j.id, name: j.name, note: latest.note, items: latest.items, keep: !!j.pinned || !!j.renamed });
      }
      const texts = [...new Set(folders.flatMap((f) => [f.name, f.note, ...f.items.map(meaningText)]).filter((t): t is string => !!t && t.trim().length > 1))];
      const vectors = await this.meaning?.vectors(texts, 4000).catch(() => null);
      const now = new Date().toISOString();
      const dismissed = new Set(Object.entries(this.state.dismissed).filter(([, until]) => until === 'never' || until > now).map(([id]) => id));
      return suggest(folders, { meaning: vectors?.size ? (t) => vectors.get(t) : undefined, dismissed });
    })();
    this.suggestCache = { at: Date.now(), result };
    result.catch(() => (this.suggestCache = null));
    return result;
  }

  /** Do what a suggestion says. Undo is available for a few seconds after. */
  async acceptSuggestion(id: string): Promise<void> {
    const s = (await this.suggestions()).find((x) => x.id === id);
    if (!s) throw new Error('That suggestion is out of date.');
    if (s.kind === 'move') {
      await this.moveItem(s.from, s.itemKey, s.to);
      this.lastUndo = { id, run: () => this.moveItem(s.to, s.itemKey, s.from) };
    } else {
      const into = await this.store.latest(s.into);
      const from = await this.store.latest(s.from);
      if (!into || !from) throw new Error('One of those folders has no saves yet.');
      const before = { items: into.items, brief: into.brief };
      into.items = withoutRepeats([...into.items, ...from.items]);
      delete into.brief; // written again for the merged folder
      await this.store.saveEntry(into);
      await this.refreshCard(s.into).catch(() => undefined);
      await this.setDone(s.from, true); // the merged-in folder moves to Finished, history intact
      this.lastUndo = { id, run: async () => {
        const now = await this.store.entry(s.into, into.id);
        now.items = before.items;
        if (before.brief) now.brief = before.brief;
        await this.store.saveEntry(now);
        await this.setDone(s.from, false);
      } };
    }
    this.notify();
  }

  async undoSuggestion(): Promise<void> {
    const undo = this.lastUndo;
    this.lastUndo = null;
    if (undo) {
      await undo.run();
      // Undoing says "not this": don't offer the same thing again straight away.
      await this.dismissSuggestion(undo.id, false);
    }
    this.notify();
  }

  /** "Not now" hides a suggestion for a week; "Never" for good. */
  async dismissSuggestion(id: string, forever: boolean): Promise<void> {
    this.state.dismissed[id] = forever ? 'never' : new Date(Date.now() + 7 * 24 * 3600_000).toISOString();
    await this.saveState();
    this.notify();
  }

  /** The brief for a save, writing it first if it doesn't exist yet. */
  async ensureBrief(jobId: string, entryId: string): Promise<SaveEntry> {
    const entry = await this.store.entry(jobId, entryId);
    if (entry.brief) return entry;
    const lock = `${jobId}/${entryId}`;
    if (this.writing.has(lock)) return { ...entry, brief: basicBrief(entry) };
    this.writing.add(lock);
    try {
      const ids = await this.store.entryIds(jobId);
      const prevId = ids[ids.indexOf(entryId) + 1];
      const previous = prevId ? await this.store.entry(jobId, prevId).catch(() => null) : null;
      const feedback = previous?.feedback && !previous.feedback.helpful ? (previous.feedback.comment ?? 'The last brief was not helpful.') : null;
      const brief = await writeBrief(this.writers, entry, previous, feedback);
      // Re-read: the save may have changed while the brief was being written (a file got named).
      const fresh = await this.store.entry(jobId, entryId);
      const keys = new Set(fresh.items.map((i) => i.key));
      fresh.brief = { ...brief, needed: brief.needed.filter((k) => keys.has(k)) };
      await this.store.saveEntry(fresh);
      this.notify();
      return fresh;
    } finally {
      this.writing.delete(lock);
    }
  }

  async briefView(jobId: string, entryId?: string): Promise<BriefView> {
    const job = await this.store.get(jobId);
    const ids = await this.store.entryIds(jobId);
    const id = entryId ?? ids[0];
    if (!id) throw new Error('This job has no saves yet.');
    const entry = await this.ensureBrief(jobId, id);
    const history: BriefView['history'] = [];
    for (const hid of ids.slice(0, 30)) {
      try {
        const h = await this.store.entry(jobId, hid);
        history.push({ id: h.id, savedAt: h.savedAt, note: h.note });
      } catch {
        // skip
      }
    }
    return { job, entry, brief: entry.brief ?? basicBrief(entry), history };
  }

  async rewriteBrief(jobId: string, entryId: string): Promise<BriefView> {
    const entry = await this.store.entry(jobId, entryId);
    delete entry.brief;
    await this.store.saveEntry(entry);
    return this.briefView(jobId, entryId);
  }

  async feedback(jobId: string, entryId: string, helpful: boolean, comment?: string): Promise<void> {
    const entry = await this.store.entry(jobId, entryId);
    entry.feedback = { helpful, comment: comment?.trim() || undefined, at: new Date().toISOString() };
    await this.store.saveEntry(entry);
  }

  /** Which items "Unpack" (all) or "Only what I need" would open. */
  async itemsToOpen(jobId: string, entryId: string | undefined, mode: 'needed' | 'all'): Promise<{ entry: SaveEntry; items: Item[] }> {
    const id = entryId ?? (await this.store.entryIds(jobId))[0];
    if (!id) throw new Error('This job has no saves yet.');
    // Never wait for a brief to be written: Unpack should feel instant. Without one yet, open everything
    // and let the brief arrive in the background.
    const entry = await this.store.entry(jobId, id);
    if (!entry.brief) void this.ensureBrief(jobId, id).catch(() => undefined);
    const needed = new Set(entry.brief?.needed ?? []);
    const items = mode === 'all' ? entry.items : entry.items.filter((i) => needed.has(i.key));
    return { entry, items: items.length ? items : entry.items };
  }

  /** `keys`: open only these items (picked by type or one by one in the folder). */
  async open(
    jobId: string,
    entryId: string | undefined,
    mode: 'needed' | 'all',
    /** Called just before things open; what it returns (if anything) is called once they have. */
    before?: (items: Item[]) => void | (() => void),
    keys?: string[],
  ): Promise<OpenResult> {
    const picked = await this.itemsToOpen(jobId, entryId, mode);
    const entry = picked.entry;
    const items = keys ? picked.items.filter((i) => keys.includes(i.key)) : picked.items;
    if (!items.length) return { opened: 0, alreadyOpen: 0, missing: [], failed: [], problems: [] };
    const afterOpen = before?.(items);
    let openBefore = new Set<string>();
    const name = (await this.store.get(jobId).catch(() => null))?.name;
    const result = await openItems(items, entry.frontKey, this.settings.get(), (b) => (openBefore = b), name, (t) => this.helper.place(t)).finally(
      () => afterOpen?.(),
    );
    // Nothing came back: the folder isn't open, so it isn't the one you're on.
    if (!result.opened && !result.alreadyOpen) return result;
    await this.setCurrent(jobId);
    const opened = await this.store.get(jobId).catch(() => null);
    if (opened) {
      opened.openedAt = new Date().toISOString();
      await this.store.put(opened);
    }
    this.notify();
    // A moment later, note what's open, so anything opened after this can be suggested for the job,
    // and where tabs ended up (a sign-in page, say), so they still count as this folder's.
    setTimeout(() => void this.recordBaseline(jobId, { entryId: entry.id, opened: items, before: openBefore }), 2500);
    return result;
  }

  /** Opens one thing from a folder's latest save (clicking a tab or file card). */
  async openItem(jobId: string, key: string): Promise<OpenResult> {
    const latest = await this.store.latest(jobId);
    const item = latest?.items.find((i) => i.key === key);
    if (!item) throw new Error('That is no longer in this folder.');
    return openItems([item], null, this.settings.get(), undefined, undefined, (t) => this.helper.place(t));
  }

  /**
   * A file that moved since it was saved: looks for it by name (Spotlight) and, if found, points the
   * folder at its new place and opens it. False if it can't be found.
   */
  async findMoved(jobId: string, key: string): Promise<boolean> {
    const latest = await this.store.latest(jobId);
    const item = latest?.items.find((i) => i.key === key);
    if (!latest || !item || item.kind !== 'doc' || !item.path) return false;
    const found = await findDocument(path.basename(item.path), item.app);
    if (!found || found === item.path) return false;
    const moved: Item = { ...item, key: `doc:${found}`, path: found, label: path.basename(found), detail: shortDir(path.dirname(found)) };
    const swap = (k: string) => (k === key ? moved.key : k);
    latest.items = latest.items.filter((i) => i.key !== moved.key).map((i) => (i.key === key ? moved : i));
    latest.frontKey = latest.frontKey ? swap(latest.frontKey) : null;
    if (latest.brief) latest.brief.needed = latest.brief.needed.map(swap);
    await this.store.saveEntry(latest);
    this.notify();
    await openItems([moved], null, this.settings.get(), undefined, undefined, (t) => this.helper.place(t));
    return true;
  }

  /** Swap one item in a save (used when an untitled document gets saved with a name). */
  async replaceItem(jobId: string, entryId: string, oldKey: string, item: Item): Promise<SaveEntry> {
    const entry = await this.store.entry(jobId, entryId);
    entry.items = entry.items.map((i) => (i.key === oldKey ? item : i));
    if (entry.frontKey === oldKey) entry.frontKey = item.key;
    if (entry.brief) entry.brief.needed = entry.brief.needed.map((k) => (k === oldKey ? item.key : k));
    await this.store.saveEntry(entry);
    this.notify();
    return entry;
  }

  /** Take an item out of a job's latest save, and remember not to suggest it again. */
  async removeItem(jobId: string, key: string): Promise<void> {
    const latest = await this.store.latest(jobId);
    if (!latest) return;
    const item = latest.items.find((i) => i.key === key);
    // Kept for a while, so Undo can put it back.
    if (item) {
      this.removed.set(`${jobId}\n${key}`, item);
      setTimeout(() => this.removed.delete(`${jobId}\n${key}`), 60_000).unref?.();
    }
    latest.items = latest.items.filter((i) => i.key !== key);
    if (latest.frontKey === key) latest.frontKey = latest.items[0]?.key ?? null;
    if (latest.brief) latest.brief.needed = latest.brief.needed.filter((k) => k !== key);
    await this.store.saveEntry(latest);
    const job = await this.store.get(jobId);
    job.prefs.hide[key] = 2;
    delete job.prefs.add[key];
    await this.store.put(job);
    // Open in the folder's Chrome tab group? It leaves the group too (and stays open).
    if (item?.kind === 'tab' && item.browser === 'chrome' && item.url) void changeChromeGroup('ungroup', job.name, [item.url]);
    this.notify();
  }

  /** Undo taking an item out: put it back in the latest save, and let it be suggested again. */
  async restoreItem(jobId: string, key: string): Promise<void> {
    const item = this.removed.get(`${jobId}\n${key}`);
    if (!item) throw new Error('That can no longer be undone.');
    this.removed.delete(`${jobId}\n${key}`);
    const latest = await this.store.latest(jobId);
    if (!latest) return;
    if (!latest.items.some((i) => i.key === item.key)) latest.items.push(item);
    await this.store.saveEntry(latest);
    const job = await this.store.get(jobId);
    delete job.prefs.hide[item.key];
    await this.store.put(job);
    if (item.kind === 'tab' && item.browser === 'chrome' && item.url) void changeChromeGroup('regroup', job.name, [item.url]);
    this.notify();
  }

  /** Move an item from one job to another (both learn from it). */
  async moveItem(fromJobId: string, key: string, toJobId: string): Promise<void> {
    if (fromJobId === toJobId) return;
    const from = await this.store.latest(fromJobId);
    const item = from?.items.find((i) => i.key === key);
    if (!item) throw new Error('That item is no longer in this job.');
    const to = await this.store.latest(toJobId);
    if (!to) throw new Error('The other job has no saves yet.');
    if (!to.items.some((i) => i.key === key)) to.items.push(item);
    await this.store.saveEntry(to);
    const toJob = await this.store.get(toJobId);
    toJob.prefs.add[key] = 2;
    delete toJob.prefs.hide[key];
    await this.store.put(toJob);
    await this.removeItem(fromJobId, key);
  }

  private async recordBaseline(jobId: string, unpacked?: { entryId: string; opened: Item[]; before: Set<string> }): Promise<void> {
    try {
      const cap = await (this.fakeCapture ? this.fakeCapture() : capture(this.settings.get(), this.helper, this.selfNames));
      if (unpacked) await this.noteRedirects(jobId, unpacked, cap.items).catch(() => undefined);
      if (this.state.currentJobId !== jobId) return;
      this.state.baseline = { jobId, keys: cap.items.map((i) => i.key) };
      await this.saveState();
    } catch {
      // without a baseline, new things simply show under "Not sure"
    }
  }

  /**
   * A tab Unpack opened that isn't open under its own address went somewhere else (Strava's dashboard
   * becomes its sign-in page when you're signed out). If exactly one new tab on the same site appeared,
   * that's it: remember the address, so it still counts as this folder's tab.
   */
  private async noteRedirects(jobId: string, unpacked: { entryId: string; opened: Item[]; before: Set<string> }, now: Item[]): Promise<void> {
    const entry = await this.store.entry(jobId, unpacked.entryId);
    const tabs = now.filter((t) => t.kind === 'tab' && t.url);
    const openNow = new Set(tabs.map(looseKey));
    const claimed = new Set(entry.items.flatMap(matchKeys));
    const opened = new Set(unpacked.opened.map((i) => i.key));
    let changed = false;
    for (const it of entry.items) {
      if (it.kind !== 'tab' || !it.url || !opened.has(it.key) || matchKeys(it).some((k) => openNow.has(k))) continue;
      const site = siteOf(it.url);
      const found = tabs.filter((t) => siteOf(t.url!) === site && !unpacked.before.has(looseKey(t)) && !claimed.has(looseKey(t)));
      if (found.length !== 1) continue;
      const k = looseKey(found[0]);
      it.seenAs = [...(it.seenAs ?? []), k].slice(-5);
      claimed.add(k);
      changed = true;
    }
    if (changed) {
      await this.store.saveEntry(entry);
      this.notify();
    }
  }

  /** Rebuild a folder's project card from all of its saves (and your edits). Returns it. */
  async refreshCard(jobId: string): Promise<ProjectCard> {
    const job = await this.store.get(jobId);
    const saves: Item[][] = [];
    for (const id of await this.store.entryIds(jobId)) saves.push((await this.store.entry(jobId, id).catch(() => null))?.items ?? []);
    job.card = buildCard(job.name, saves, job.cardEdits);
    await this.store.put(job);
    return job.card;
  }

  /** Add a name to a folder's card, or take a name, site or place out of it. */
  async editCard(jobId: string, change: { add?: string; hide?: string; unadd?: string }): Promise<ProjectCard> {
    const job = await this.store.get(jobId);
    const edits = job.cardEdits ?? { add: [], hide: [] };
    if (change.add?.trim()) edits.add = [...new Set([...edits.add, change.add.trim().slice(0, 40)])].slice(-12);
    if (change.unadd) edits.add = edits.add.filter((a) => a !== change.unadd);
    if (change.hide?.trim()) edits.hide = [...new Set([...edits.hide, change.hide.trim().toLowerCase()])].slice(-40);
    job.cardEdits = edits;
    await this.store.put(job);
    const card = await this.refreshCard(jobId);
    this.notify();
    return card;
  }

  /** Pin a folder (unpinning any other: one at a time), or unpin it. */
  async setPinned(jobId: string, pinned: boolean): Promise<void> {
    for (const j of await this.store.list()) {
      const want = pinned && j.id === jobId;
      if (!!j.pinned === want) continue;
      j.pinned = want;
      await this.store.put(j);
    }
    this.notify();
  }

  /** What ⌃O opens: the pinned folder, else the one you opened last (else the last saved). */
  async quickOpenTarget(): Promise<string | null> {
    const jobs = (await this.store.list()).filter((j) => !j.done);
    const pinned = jobs.find((j) => j.pinned);
    if (pinned) return pinned.id;
    const when = (j: Job) => Math.max(Date.parse(j.openedAt ?? '') || 0, Date.parse(j.updatedAt) || 0);
    return jobs.sort((a, b) => when(b) - when(a))[0]?.id ?? null;
  }

  async rename(jobId: string, name: string): Promise<void> {
    const job = await this.store.get(jobId);
    job.name = name;
    job.renamed = true;
    await this.store.put(job);
    await this.refreshCard(jobId).catch(() => undefined);
    this.notify();
  }

  /** A folder Tidy all just made: your name for it, and what you were doing (rewrites its brief). */
  async describeFolder(jobId: string, name: string, note: string): Promise<void> {
    const job = await this.store.get(jobId);
    if (name && name !== job.name) await this.rename(jobId, name);
    const latest = note ? await this.store.latest(jobId) : null;
    if (latest) {
      await this.store.saveEntry({ ...latest, note, brief: undefined });
      await this.refreshCard(jobId).catch(() => undefined);
      void this.ensureBrief(jobId, latest.id).catch(() => undefined);
    }
    this.notify();
  }

  async setDone(jobId: string, done: boolean): Promise<void> {
    const job = await this.store.get(jobId);
    job.done = done;
    await this.store.put(job);
    if (done && this.state.currentJobId === jobId) await this.setCurrent(null);
    this.notify();
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.store.delete(jobId);
    try {
      this.memory?.forgetFolder(jobId);
    } catch {
      // The memory is a helper; deleting never fails because of it.
    }
    if (this.state.currentJobId === jobId) await this.setCurrent(null);
    this.notify();
  }
}

/**
 * One copy of each thing: the same page saved twice (http and https, www., a trailing slash, or where
 * it redirected) is kept once, the first time it appears. So is a tab with the same title and the same
 * page on another address of the same site (a preview link of your website on vercel.app, say).
 */
export function withoutRepeats(items: Item[]): Item[] {
  const seen = new Set<string>();
  const samePageKey = (i: Item) => {
    if (i.kind !== 'tab' || !i.url || !i.label.trim()) return [];
    try {
      const u = new URL(i.url);
      return [`page:${siteOf(i.url)}|${i.label.trim().toLowerCase()}|${u.pathname.replace(/\/+$/, '') || '/'}${u.search}`];
    } catch {
      return [];
    }
  };
  return items.filter((i) => {
    const keys = [i.key, ...matchKeys(i), ...samePageKey(i)];
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
}

/** What a job holds most of: its icon in the menu. */
export function iconFor(items: Item[]): JobSummary['icon'] {
  const counts = { doc: 0, tab: 0, folder: 0, app: 0 };
  for (const i of items) counts[i.kind]++;
  const [kind, n] = (Object.entries(counts) as [keyof typeof counts, number][]).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? kind : 'stack';
}

/** A short hint for the menu: what's next, else the brief's headline, else the note. */
export function hintFrom(entry: SaveEntry): string {
  const s = entry.brief?.sections;
  const text = (entry.brief?.source !== 'basic' ? entry.brief?.sentence : undefined) ?? s?.next ?? s?.lastOn ?? entry.brief?.sentence ?? entry.note ?? '';
  const first = text.split(/(?<=[.!?])\s/)[0] ?? '';
  return first.replace(/^You were (last )?(on |working on |writing )?/i, '').replace(/\.$/, '').slice(0, 70);
}

