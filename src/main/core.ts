// The app's actions, shared by the menu bar, keyboard shortcuts and the windows.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BriefView, Capture, Item, Job, JobSummary, OpenResult, OpenState, Suggestion, SaveEntry, SavePreview, SaveRequest, SaveResult } from '../shared/types';
import { aiJobName, writeBrief, type BriefWriter } from './brief';
import { basicBrief } from './brief/basic';
import { capture, frontItemKey } from './capture';
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
import { FIT_SUGGEST, jobFit, jobProfile, meaningText, profileTexts, type MeaningLookup } from './jobs/relevance';
import { suggest, type FolderData } from './jobs/suggest';
import type { Meaning } from './meaning';
import { openItems } from './open';
import type { SettingsStore } from './settings';
import { JobStore, writeFileAtomic } from './store';
import { looseKey } from './urls';

interface State {
  currentJobId: string | null;
  appUnticks: Record<string, string[]>;
  /** What was open just after a job was unpacked, so later additions can be suggested. */
  baseline: { jobId: string; keys: string[] } | null;
  /** Suggestions the person said no to: id → until when (ISO date), or 'never' to never ask again. */
  dismissed: Record<string, string>;
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

/** How long one look at what's open is reused. */
const OPEN_CHECK_MS = 6_000;

export class Core {
  private listeners: (() => void)[] = [];
  private state: State;
  private readonly stateFile: string;
  private pending: PendingSave | null = null;
  private writing = new Set<string>();
  writers: BriefWriter[] = [];
  private openCache: { at: number; result: Promise<Record<string, OpenState>> } | null = null;
  private suggestCache: { at: number; result: Promise<Suggestion[]> } | null = null;
  /** The last accepted suggestion, so it can be undone for a few seconds. */
  private lastUndo: { id: string; run: () => Promise<void> } | null = null;
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
    this.pending = { capture: this.fakeCapture ? this.fakeCapture() : capture(this.settings.get(), this.helper, this.selfNames, early), target };
    this.pending.capture.catch(() => undefined);
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
      jobs.push({ job: j, latest, profile: latest ? jobProfile(j.name, latest.note, latest.items, learnedAvoid(j.prefs)) : null });
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
    if (job) await addVectors(profileTexts(jobProfile(job.name, latest?.note ?? '', previous, learnedAvoid(job.prefs))));
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
      .filter((i) => !openKeys.has(looseKey(i)) && (job?.prefs.hide[i.key] ?? 0) < 2 && !isLifestyle(i, settings, learned))
      .map((i) => ({ ...i, notOpen: true, active: false }));
    pending.offered = offered;
    pending.kept = kept;
    const visibleItems = [...offered.sure, ...offered.likely, ...offered.maybe];
    const front = frontItemKey(visibleItems, cap.appOrder);
    return {
      jobId: job?.id ?? null,
      jobName: job?.name ?? null,
      isSuggestion,
      suggestedName: job?.name ?? suggestName(offered.sure, front),
      sure: offered.sure,
      likely: offered.likely,
      maybe: offered.maybe,
      kept,
      hiddenCount: offered.hidden.length,
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
    const offered = pending.offered ?? { sure: cap.items, likely: [], maybe: [], hidden: [], why: {} };
    const wanted = new Set(req.keys);
    const open = cap.items.filter((i) => wanted.has(i.key)).map((i) => ({ ...i, notOpen: undefined }));
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
    // The folder may be deleted while its brief is still being written; that's fine.
    void this.ensureBrief(job.id, entry.id).catch(() => undefined);
    return { jobId: job.id, entryId: entry.id, needsNaming: req.tidy ? items.filter((i) => i.untitled) : [] };
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
  openState(): Promise<Record<string, OpenState>> {
    // Asking browsers and apps what's open costs a little battery, so one look is reused for a few seconds
    // (and thrown away as soon as you save, unpack or change a folder, via notify()).
    if (this.openCache && Date.now() - this.openCache.at < OPEN_CHECK_MS) return this.openCache.result;
    const result = (async () => {
      // Only ask the apps your folders actually use (no folder has a Word file? Word isn't asked).
      const jobs = await this.store.list();
      const latest = await Promise.all(jobs.map((j) => this.store.latest(j.id)));
      const apps = new Set(latest.flatMap((e) => (e?.items ?? []).map((i) => i.app)));
      const win = this.fakeCapture ? null : await this.helper.windows().catch(() => null);
      const cap = this.fakeCapture
        ? await this.fakeCapture()
        : await capture(this.settings.get(), this.helper, this.selfNames, win ? Promise.resolve(win) : undefined, apps);
      const open = new Set(cap.items.map(looseKey));
      // An app counts as open only with a window showing, not just running in the background or hidden.
      const hidden = new Set(win?.apps.filter((a) => a.hidden).map((a) => a.name) ?? []);
      const showing = win ? new Set(win.order.filter((n) => !hidden.has(n))) : null;
      const isOpen = (i: Item) => (i.kind === 'app' && showing ? showing.has(i.app) : open.has(looseKey(i)));
      const out: Record<string, OpenState> = {};
      for (const [n, j] of jobs.entries()) {
        // Apps don't count (Slack being open doesn't mean a folder is), unless a folder holds only apps.
        const all = latest[n]?.items ?? [];
        const content = all.filter((i) => i.kind !== 'app');
        const items = content.length ? content : all;
        out[j.id] = { open: items.filter(isOpen).length, total: items.length };
      }
      return out;
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
        if (latest) folders.push({ id: j.id, name: j.name, note: latest.note, items: latest.items });
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
      const have = new Set(into.items.map((i) => i.key));
      into.items = [...into.items, ...from.items.filter((i) => !have.has(i.key))];
      delete into.brief; // written again for the merged folder
      await this.store.saveEntry(into);
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

  async open(jobId: string, entryId: string | undefined, mode: 'needed' | 'all', before?: (items: Item[]) => void): Promise<OpenResult> {
    const { entry, items } = await this.itemsToOpen(jobId, entryId, mode);
    before?.(items);
    const result = await openItems(items, entry.frontKey, this.settings.get());
    await this.setCurrent(jobId);
    this.notify();
    // A moment later, note what's open, so anything opened after this can be suggested for the job.
    setTimeout(() => void this.recordBaseline(jobId), 2500);
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
    latest.items = latest.items.filter((i) => i.key !== key);
    if (latest.frontKey === key) latest.frontKey = latest.items[0]?.key ?? null;
    if (latest.brief) latest.brief.needed = latest.brief.needed.filter((k) => k !== key);
    await this.store.saveEntry(latest);
    const job = await this.store.get(jobId);
    job.prefs.hide[key] = 2;
    delete job.prefs.add[key];
    await this.store.put(job);
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

  private async recordBaseline(jobId: string): Promise<void> {
    try {
      const cap = await (this.fakeCapture ? this.fakeCapture() : capture(this.settings.get(), this.helper, this.selfNames));
      if (this.state.currentJobId !== jobId) return;
      this.state.baseline = { jobId, keys: cap.items.map((i) => i.key) };
      await this.saveState();
    } catch {
      // without a baseline, new things simply show under "Not sure"
    }
  }

  async rename(jobId: string, name: string): Promise<void> {
    const job = await this.store.get(jobId);
    job.name = name;
    await this.store.put(job);
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

/** What a job holds most of: its icon in the menu. */
export function iconFor(items: Item[]): JobSummary['icon'] {
  const counts = { doc: 0, tab: 0, folder: 0, app: 0 };
  for (const i of items) counts[i.kind]++;
  const [kind, n] = (Object.entries(counts) as [keyof typeof counts, number][]).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? kind : 'stack';
}

/** A short hint for the menu: the brief's first sentence, or the note. */
export function hintFrom(entry: SaveEntry): string {
  const text = entry.brief?.sentence ?? entry.note ?? '';
  const first = text.split(/(?<=[.!?])\s/)[0] ?? '';
  return first.replace(/^You were (last )?(on |working on |writing )?/i, '').replace(/\.$/, '').slice(0, 70);
}

