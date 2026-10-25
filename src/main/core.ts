// The app's actions, shared by the menu bar, keyboard shortcuts and the windows.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Project, ProjectListItem, Recap, RecapView, RestoreRequest, RestoreResult, Snapshot } from '../shared/types';
import { newestChange } from './collectors/files';
import { aiRecap, buildPayload } from './recap/ai';
import { changesSince } from './recap/changes';
import { localRecap, recapItems } from './recap/local';
import { restoreItems } from './restore';
import type { SecretStore } from './secrets';
import type { SettingsStore } from './settings';
import { takeSnapshot } from './snapshot';
import { projectIdFor, type SnapshotStore } from './store';

export class Core {
  private listeners: (() => void)[] = [];

  constructor(
    readonly settings: SettingsStore,
    readonly store: SnapshotStore,
    readonly secrets: SecretStore,
  ) {}

  onSnapshotsChanged(l: () => void): void {
    this.listeners.push(l);
  }

  notifyChanged(): void {
    for (const l of this.listeners) l();
  }

  project(id: string): Project {
    const p = this.settings.get().projects.find((x) => x.id === id);
    if (!p) throw new Error('That project is not in your list any more.');
    return p;
  }

  async addProject(folder: string): Promise<Project> {
    const st = await fs.stat(folder);
    if (!st.isDirectory()) throw new Error('Please pick a folder.');
    const s = this.settings.get();
    const existing = s.projects.find((p) => p.path === folder);
    if (existing) return existing;
    const project: Project = { id: projectIdFor(folder), name: path.basename(folder), path: folder };
    await this.settings.update({ projects: [...s.projects, project] });
    this.notifyChanged();
    return project;
  }

  async listProjects(): Promise<ProjectListItem[]> {
    const out: ProjectListItem[] = [];
    for (const p of this.settings.get().projects) {
      const list = await this.store.list(p.id);
      const exists = await fs
        .stat(p.path)
        .then((s) => s.isDirectory())
        .catch(() => false);
      out.push({ ...p, lastSnapshotAt: list[0]?.createdAt ?? null, snapshotCount: list.length, exists });
    }
    return out;
  }

  /** The project whose files changed most recently (for the quick-save picker). */
  async suggestedProject(): Promise<string | null> {
    const s = this.settings.get();
    const since = Date.now() - s.lookbackHours * 3_600_000;
    let best: { id: string; t: number } | null = null;
    for (const p of s.projects) {
      const t = await newestChange(p.path, since).catch(() => 0);
      if (!best || t > best.t) best = { id: p.id, t };
    }
    return best?.id ?? null;
  }

  /** The project with the newest snapshot (for the recap shortcut). */
  async mostRecentlyActive(): Promise<string | null> {
    let best: { id: string; at: string } | null = null;
    for (const p of this.settings.get().projects) {
      const [top] = await this.store.list(p.id);
      if (top && (!best || top.createdAt > best.at)) best = { id: p.id, at: top.createdAt };
    }
    return best?.id ?? this.settings.get().projects[0]?.id ?? null;
  }

  async save(projectId: string, note: string): Promise<Snapshot> {
    const snap = await takeSnapshot(this.store, { project: this.project(projectId), settings: this.settings.get(), note, trigger: 'manual' });
    this.notifyChanged();
    return snap;
  }

  private async snapshotFor(projectId: string, snapshotId?: string): Promise<Snapshot> {
    this.project(projectId);
    const snap = snapshotId ? await this.store.load(projectId, snapshotId) : await this.store.latest(projectId);
    if (!snap) throw new Error('No snapshots for this project yet.');
    return snap;
  }

  async recap(projectId: string, snapshotId: string | undefined, wantAi: boolean): Promise<RecapView> {
    const snapshot = await this.snapshotFor(projectId, snapshotId);
    const changes = await changesSince(snapshot);
    const s = this.settings.get();
    let recap: Recap = { source: 'local', text: localRecap(snapshot, changes) };
    if (wantAi && s.aiRecap && s.aiDisclosureAccepted) {
      const key = await this.secrets.get();
      if (!key) {
        recap.aiError = 'Add your Claude API key in Settings to use the AI recap.';
      } else {
        try {
          recap = { source: 'ai', text: await aiRecap({ apiKey: key, model: s.aiModel, snapshot, changes }) };
        } catch (e) {
          recap.aiError = `${e instanceof Error ? e.message : String(e)} Showing the offline recap instead.`;
        }
      }
    }
    return { snapshot, changes, recap, items: recapItems(snapshot) };
  }

  async aiPayloadPreview(projectId: string, snapshotId?: string): Promise<string> {
    const snapshot = await this.snapshotFor(projectId, snapshotId);
    return JSON.stringify(buildPayload(snapshot, await changesSince(snapshot)), null, 2);
  }

  async restore(req: RestoreRequest): Promise<RestoreResult> {
    const snapshot = await this.snapshotFor(req.projectId, req.snapshotId);
    const wanted = new Set(req.keys);
    const items = recapItems(snapshot).filter((i) => wanted.has(i.key));
    return restoreItems(snapshot, items, { useVSCode: this.settings.get().openFilesInVSCode });
  }

  async deleteProjectSnapshots(projectId: string): Promise<void> {
    await this.store.deleteProject(projectId);
    this.notifyChanged();
  }

  async removeProject(projectId: string, deleteSnapshots: boolean): Promise<void> {
    const s = this.settings.get();
    await this.settings.update({ projects: s.projects.filter((p) => p.id !== projectId) });
    if (deleteSnapshots) await this.store.deleteProject(projectId);
    this.notifyChanged();
  }
}
