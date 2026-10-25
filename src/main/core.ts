// The app's actions, shared by the menu bar, keyboard shortcuts and the windows.

import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BriefView, Capture, Item, Job, JobSummary, OpenResult, SaveEntry, SavePreview, SaveRequest, SaveResult } from '../shared/types';
import { aiJobName, writeBrief, type BriefWriter } from './brief';
import { basicBrief } from './brief/basic';
import { capture, frontItemKey } from './capture';
import type { Helper, WindowsInfo } from './helper';
import {
  classify,
  isLifestyle,
  learn,
  learnedLifestyleApps,
  MATCH_THRESHOLD,
  recordAppUnticks,
  similarity,
  suggestName,
  type Classified,
} from './jobs/match';
import { openItems } from './open';
import type { SettingsStore } from './settings';
import { JobStore, writeFileAtomic } from './store';

interface State {
  currentJobId: string | null;
  appUnticks: Record<string, string[]>;
  /** What was open just after a job was unpacked, so later additions can be suggested. */
  baseline: { jobId: string; keys: string[] } | null;
}

interface PendingSave {
  capture: Promise<Capture>;
  /** What the save box last showed, to learn from what the user changed. */
  offered?: Classified;
  /** Items from the job that aren't open right now (kept unless unticked). */
  kept?: Item[];
}

export class Core {
  private listeners: (() => void)[] = [];
  private state: State;
  private readonly stateFile: string;
  private pending: PendingSave | null = null;
  private writing = new Set<string>();
  writers: BriefWriter[] = [];

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
    };
  }

  onChanged(l: () => void): void {
    this.listeners.push(l);
  }

  notify(): void {
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
  beginSave(early?: Promise<WindowsInfo>): void {
    this.pending = { capture: this.fakeCapture ? this.fakeCapture() : capture(this.settings.get(), this.helper, this.selfNames, early) };
    this.pending.capture.catch(() => undefined);
  }

  async preview(opts: { asNew?: boolean; jobId?: string } = {}): Promise<SavePreview> {
    if (!this.pending) this.beginSave();
    const cap = await this.pending!.capture;
    const settings = this.settings.get();
    const learned = learnedLifestyleApps(this.state.appUnticks);

    // Which job is this? The one you opened, or one that looks the same, or a new one.
    let job: Job | null = null;
    let isSuggestion = false;
    if (!opts.asNew) {
      const wanted = opts.jobId ?? this.state.currentJobId;
      if (wanted && (await this.store.exists(wanted))) job = await this.store.get(wanted);
      if (job?.done) job = null;
      if (!job) {
        const visible = classify({ items: cap.items, job: null, previous: [], name: '', settings, learnedLifestyleApps: learned }).sure;
        let best: { job: Job; score: number } | null = null;
        for (const j of (await this.store.list()).filter((x) => !x.done).slice(0, 25)) {
          const latest = await this.store.latest(j.id);
          const score = latest ? similarity(visible, latest.items) : 0;
          if (score >= MATCH_THRESHOLD && (!best || score > best.score)) best = { job: j, score };
        }
        if (best) {
          job = best.job;
          isSuggestion = true;
        }
      }
    }

    const previous = job ? ((await this.store.latest(job.id))?.items ?? []) : [];
    const baseline = job && this.state.baseline?.jobId === job.id ? new Set(this.state.baseline.keys) : undefined;
    const offered = classify({ items: cap.items, job, previous, name: job?.name ?? '', settings, learnedLifestyleApps: learned, baseline });
    // Things that belong to this job but aren't open right now (closed by accident, say) are kept.
    const openKeys = new Set(cap.items.map((i) => i.key));
    const kept = previous
      .filter((i) => !openKeys.has(i.key) && (job?.prefs.hide[i.key] ?? 0) < 2 && !isLifestyle(i, settings, learned))
      .map((i) => ({ ...i, notOpen: true, active: false }));
    this.pending!.offered = offered;
    this.pending!.kept = kept;
    const visibleItems = [...offered.sure, ...offered.likely, ...offered.maybe];
    const frontKey = frontItemKey(visibleItems, cap.appOrder);
    return {
      jobId: job?.id ?? null,
      jobName: job?.name ?? null,
      isSuggestion,
      suggestedName: job?.name ?? suggestName(offered.sure, frontKey),
      sure: offered.sure,
      likely: offered.likely,
      maybe: offered.maybe,
      kept,
      hiddenCount: offered.hidden.length,
      frontKey,
      tidyUp: settings.tidyUp,
      errors: cap.errors,
    };
  }

  async commitSave(req: SaveRequest): Promise<SaveResult> {
    if (!this.pending) throw new Error('Nothing to save. Press the shortcut again.');
    const cap = await this.pending.capture;
    const offered = this.pending.offered ?? { sure: cap.items, likely: [], maybe: [], hidden: [] };
    const wanted = new Set(req.keys);
    const open = cap.items.filter((i) => wanted.has(i.key)).map((i) => ({ ...i, notOpen: undefined }));
    const openKeys = new Set(open.map((i) => i.key));
    const items = [...open, ...(this.pending.kept ?? []).filter((i) => wanted.has(i.key) && !openKeys.has(i.key))];
    const now = new Date();

    let job: Job;
    if (req.jobId && (await this.store.exists(req.jobId))) {
      job = await this.store.get(req.jobId);
      job.name = req.name;
    } else {
      job = await this.store.create(req.name, now);
    }
    job.prefs = learn(job.prefs, offered, req.keys);
    job.updatedAt = now.toISOString();
    job.done = false;
    await this.store.put(job);

    this.state.appUnticks = recordAppUnticks(this.state.appUnticks, job.id, [...offered.sure, ...offered.likely, ...offered.maybe], req.keys);
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
    this.pending = null;
    this.notify();
    void this.ensureBrief(job.id, entry.id);
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
      });
    }
    return out;
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
    const entry = mode === 'needed' ? await this.ensureBrief(jobId, id) : await this.store.entry(jobId, id);
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

  async deleteAll(): Promise<void> {
    await this.store.deleteAll();
    this.state = { currentJobId: null, appUnticks: {}, baseline: null };
    await fs.rm(this.stateFile, { force: true });
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
