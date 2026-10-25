// The app's actions, shared by the menu bar, keyboard shortcuts and the windows.

import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import type { BriefView, Capture, Item, Job, JobSummary, OpenResult, SaveEntry, SavePreview, SaveRequest, SaveResult } from '../shared/types';
import { writeBrief, type BriefWriter } from './brief';
import { basicBrief } from './brief/basic';
import { capture, frontItemKey } from './capture';
import type { Helper, WindowsInfo } from './helper';
import {
  classify,
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
}

interface PendingSave {
  capture: Promise<Capture>;
  /** What the save box last showed, to learn from what the user changed. */
  offered?: Classified;
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
    const offered = classify({ items: cap.items, job, previous, name: job?.name ?? '', settings, learnedLifestyleApps: learned });
    this.pending!.offered = offered;
    const visibleItems = [...offered.sure, ...offered.maybe];
    const frontKey = frontItemKey(visibleItems, cap.appOrder);
    return {
      jobId: job?.id ?? null,
      jobName: job?.name ?? null,
      isSuggestion,
      suggestedName: job?.name ?? suggestName(offered.sure, frontKey),
      sure: offered.sure,
      maybe: offered.maybe,
      hiddenCount: offered.hidden.length,
      frontKey,
      tidyUp: settings.tidyUp,
      errors: cap.errors,
    };
  }

  async commitSave(req: SaveRequest): Promise<SaveResult> {
    if (!this.pending) throw new Error('Nothing to save. Press the shortcut again.');
    const cap = await this.pending.capture;
    const offered = this.pending.offered ?? { sure: cap.items, maybe: [], hidden: [] };
    const wanted = new Set(req.keys);
    const items = cap.items.filter((i) => wanted.has(i.key));
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

    this.state.appUnticks = recordAppUnticks(this.state.appUnticks, job.id, [...offered.sure, ...offered.maybe], req.keys);
    const entry: SaveEntry = {
      version: 2,
      id: await this.store.freeEntryId(job.id, now),
      jobId: job.id,
      savedAt: now.toISOString(),
      note: req.note,
      items,
      frontKey: frontItemKey(items, cap.appOrder),
      appOrder: cap.appOrder,
      tidied: req.tidy,
      errors: cap.errors,
    };
    await this.store.saveEntry(entry);
    await this.store.prune(job.id);
    await this.settings.update({ tidyUp: req.tidy });
    await this.setCurrent(req.tidy ? null : job.id);
    this.pending = null;
    this.notify();
    void this.ensureBrief(job.id, entry.id);
    return { jobId: job.id, entryId: entry.id, needsNaming: req.tidy ? items.filter((i) => i.untitled) : [] };
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
      entry.brief = await writeBrief(this.writers, entry, previous, feedback);
      await this.store.saveEntry(entry);
      this.notify();
      return entry;
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

  async open(jobId: string, entryId: string, mode: 'needed' | 'all'): Promise<OpenResult> {
    const entry = await this.ensureBrief(jobId, entryId);
    const needed = new Set(entry.brief?.needed ?? []);
    const items: Item[] = mode === 'all' ? entry.items : entry.items.filter((i) => needed.has(i.key));
    const result = await openItems(items.length ? items : entry.items, entry.frontKey, this.settings.get());
    await this.setCurrent(jobId);
    this.notify();
    return result;
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
    this.state = { currentJobId: null, appUnticks: {} };
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
