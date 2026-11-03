// The app's actions, shared by the menu bar, keyboard shortcuts and the windows.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mostlyOpen, type BriefView, type Capture, type BreakPlace, type BreakShelf, type BrowserName, type Item, type Job, type JobSummary, type ProjectCard, type OpenResult, type OpenState, type Suggestion, type SaveEntry, type SavePreview, type SaveRequest, type SaveResult } from '../shared/types';
import { aiJobName, writeBrief, type BriefWriter } from './brief';
import { basicBrief } from './brief/basic';
import { capture, CHAT_APPS, frontItemKey } from './capture';
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
import { buildCard } from './jobs/card';
import type { Meaning } from './meaning';
import { changeChromeGroup, finished, openForBreak, openItems, videoProgress } from './open';
import { BreakStore, isBreakItem, videoKey } from './breaks';
import type { SettingsStore } from './settings';
import { JobStore, writeFileAtomic } from './store';
import { IconCache } from './icons';
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
}

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

export class Core {
  private listeners: (() => void)[] = [];
  private state: State;
  private readonly stateFile: string;
  private pending: PendingSave | null = null;
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
    let raw: Partial<State> = {};
    try {
      raw = JSON.parse(readFileSync(this.stateFile, 'utf8')) as Partial<State>;
    } catch {
      // first run
    }
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
    await writeFileAtomic(this.stateFile, JSON.stringify(this.state, null, 2));
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

  async preview(opts: { asNew?: boolean; jobId?: string } = {}): Promise<SavePreview> {
    if (!this.pending) this.beginSave();
    // Hold on to this save: Escape or a new shortcut press may replace this.pending while we work.
    const pending = this.pending!;
    const cap = await pending.capture;
    const settings = this.settings.get();
    const learned = learnedLifestyleApps(this.state.appUnticks);
    const candidates = cap.items.filter((i) => !isLifestyle(i, settings, learned));
    const frontKey = frontItemKey(candidates, cap.appOrder);

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
    const fits = jobs.map((j) => ({ job: j.job, latest: j.latest, fit: j.profile ? jobFit(candidates, j.profile, lookup) : 0 }));
    fits.sort((a, b) => b.fit - a.fit);

    // Which job is this? The one you picked, the one you have open, or a clear match. Otherwise new.
    let job: Job | null = null;
    let isSuggestion = false;
    if (!opts.asNew) {
      const wanted = opts.jobId ?? pending.target ?? this.state.currentJobId;
      if (wanted && (await this.store.exists(wanted))) job = await this.store.get(wanted);
      if (job?.done && !opts.jobId) job = null;
      if (!job && fits[0] && fits[0].fit >= FIT_SUGGEST) {
        job = fits[0].job;
        isSuggestion = true;
      }
    }

    const latest = job ? (fits.find((f) => f.job.id === job!.id)?.latest ?? (await this.store.latest(job.id))) : null;
    const previous = latest?.items ?? [];
    const baseline = job && this.state.baseline?.jobId === job.id ? new Set(this.state.baseline.keys) : undefined;
    if (job) await addVectors(profileTexts(jobProfile(job.name, latest?.note ?? '', previous, learnedAvoid(job.prefs), job.card)));
    const offered = classify({
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
    // Things that belong to this job but aren't open right now (closed by accident, say) are kept.
    const openKeys = new Set(cap.items.map(looseKey));
    const kept = previous
      .filter((i) => !matchKeys(i).some((k) => openKeys.has(k)) && (job?.prefs.hide[i.key] ?? 0) < 2 && !isLifestyle(i, settings, learned))
      .map((i) => ({ ...i, notOpen: true, active: false }));
    pending.offered = offered;
    pending.kept = kept;
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

  async commitSave(req: SaveRequest): Promise<SaveResult> {
    const pending = this.pending;
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
    job.prefs = learn(job.prefs, offered, req.keys);
    job.updatedAt = now.toISOString();
    job.done = false;
    await this.store.put(job);

    // Only apps that were ticked for you and that you unticked count. Bare apps start unticked, so
    // leaving them alone says nothing (otherwise Xcode or Figma would soon be treated as everyday).
    this.state.appUnticks = recordAppUnticks(this.state.appUnticks, job.id, offered.sure, req.keys);
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
    };
    await this.store.saveEntry(entry);
    await this.store.prune(job.id);
    await this.settings.update({ tidyUp: req.tidy });
    await this.setCurrent(req.tidy ? null : job.id);
    // After a save, "new since you unpacked" starts again from what's open now.
    this.state.baseline = req.tidy ? null : { jobId: job.id, keys: cap.items.map((i) => i.key) };
    await this.saveState();
    // Only clear it if no newer save box has started in the meantime.
    if (this.pending === pending) this.pending = null;
    this.notify();
    await this.refreshCard(job.id).catch(() => undefined);
    // The folder may be deleted while its brief is still being written; that's fine.
    void this.ensureBrief(job.id, entry.id).catch(() => undefined);
    return { jobId: job.id, entryId: entry.id, needsNaming: req.tidy ? items.filter((i) => i.untitled) : [] };
  }

  /**
   * Tidy all. Every folder you have open is saved (what clearly belongs to it, like Pack up), anything
   * open that's already in another folder is just closed, and so are the tabs left over that belong
   * nowhere (listed under "Recently closed" for 10 minutes). Everyday sites (mail, music) stay.
   * Returns the things to close; closing is up to the caller.
   */
  async tidyAll(): Promise<TidyAllPlan> {
    const settings = this.settings.get();
    const cap = this.fakeCapture ? await this.fakeCapture() : await capture(settings, this.helper, this.selfNames);
    const learned = learnedLifestyleApps(this.state.appUnticks);
    const openKeys = new Set(cap.items.map(looseKey));
    const plan: TidyAllPlan = { saved: [], close: [], filed: [], loose: 0, breaks: 0 };
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
        plan.close.push(...openNow.map(openItem).filter((i): i is Item => !!i));
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

    // Tabs left over: one that clearly belongs to one of your other folders is added to it. The rest
    // belong nowhere and just close (they stay in "Recently closed" for a while, in case one mattered).
    const strays = cap.items.filter((i) => i.kind === 'tab' && !claimed.has(looseKey(i)) && !isLifestyle(i, settings, learned));
    const homes = await this.homesFor(strays, new Set(plan.saved.map((s) => s.jobId)));
    for (const [jobId, items] of homes) {
      const name = await this.addToFolder(jobId, items);
      plan.filed.push({ jobId, name, count: items.length });
    }
    const homed = new Set([...homes.values()].flat().map((i) => i.key));
    plan.close.push(...strays);
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
    plan.loose = strays.filter((i) => !homed.has(i.key)).length - breakItems.length;
    this.pending = null;
    this.notify();
    return plan;
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
  private async addToFolder(jobId: string, items: Item[]): Promise<string> {
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
   * top of it.
   */
  async videosClosed(items: Item[]): Promise<void> {
    const { finishedOnes, rest } = await this.splitFinished(items);
    for (const f of finishedOnes) await this.breaks.removeLoose(videoKey(f.url ?? ''));
    if (rest.length) await this.breaks.add(rest);
    this.notify();
  }

  private async splitFinished(items: Item[]): Promise<{ finishedOnes: Item[]; rest: Item[] }> {
    const s = this.settings.get();
    const progress = await videoProgress((u) => cleanTabUrl(u, { keepQueryStrings: s.keepQueryStrings, excludedDomains: s.excludedDomains })).catch(() => new Map());
    const finishedOnes = items.filter((i) => finished(progress.get(videoKey(i.url ?? ''))));
    return { finishedOnes, rest: items.filter((i) => !finishedOnes.includes(i)) };
  }

  breakShelf(): Promise<BreakShelf> {
    return this.breaks.get();
  }

  /** Open something from the Break shelf (or one of your places) where you chose. */
  async openBreak(url: string): Promise<void> {
    const shelf = await this.breaks.get();
    await openForBreak(url, shelf.browser);
    await this.breaks.opened(url);
    this.notify();
  }

  async changeBreak(change: { browser?: BrowserName | 'window'; removeItem?: string; addPlace?: BreakPlace; removePlace?: string }): Promise<BreakShelf> {
    if (change.browser) await this.breaks.setBrowser(change.browser);
    if (change.removeItem) await this.breaks.remove(change.removeItem);
    if (change.addPlace) await this.breaks.addPlace(change.addPlace);
    if (change.removePlace) await this.breaks.removePlace(change.removePlace);
    this.notify();
    return this.breaks.get();
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
      const apps = new Set([...latest.flatMap((e) => (e?.items ?? []).map((i) => i.app)), 'Google Chrome', 'Safari', 'Arc']);
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
      return { state: out, open, jobs, latest, items: cap.items };
    })();
    this.openCache = { at: Date.now(), result };
    result.catch(() => (this.openCache = null));
    return result;
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
  async open(jobId: string, entryId: string | undefined, mode: 'needed' | 'all', before?: (items: Item[]) => void, keys?: string[]): Promise<OpenResult> {
    const picked = await this.itemsToOpen(jobId, entryId, mode);
    const entry = picked.entry;
    const items = keys ? picked.items.filter((i) => keys.includes(i.key)) : picked.items;
    if (!items.length) return { opened: 0, alreadyOpen: 0, missing: [], failed: [] };
    before?.(items);
    let openBefore = new Set<string>();
    const name = (await this.store.get(jobId).catch(() => null))?.name;
    const result = await openItems(items, entry.frontKey, this.settings.get(), (b) => (openBefore = b), name);
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
    return openItems([item], null, this.settings.get());
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

  async setDone(jobId: string, done: boolean): Promise<void> {
    const job = await this.store.get(jobId);
    job.done = done;
    await this.store.put(job);
    if (done && this.state.currentJobId === jobId) await this.setCurrent(null);
    this.notify();
  }

  async deleteJob(jobId: string): Promise<void> {
    await this.store.delete(jobId);
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

