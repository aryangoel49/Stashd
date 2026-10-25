// Optional automatic snapshots (off by default). Nothing runs in the background except a
// once-a-minute idle check; snapshots are only taken when the screen locks, the Mac sleeps,
// or you have been idle for 15 minutes, and only for projects with recent file activity.

import { powerMonitor } from 'electron';
import type { Project, SnapshotTrigger } from '../shared/types';
import { ACTIVITY_WINDOW_MS, shouldAutoSnapshot } from './autorule';
import { newestChange } from './collectors/files';
import type { SettingsStore } from './settings';
import { takeSnapshot } from './snapshot';
import type { SnapshotStore } from './store';

const IDLE_SECONDS = 15 * 60;

export class AutoSnapshotter {
  private timer: NodeJS.Timeout | null = null;
  private idleFired = false;
  private running = false;
  private lastAuto = new Map<string, number>();
  private readonly onLock = () => void this.fire('lock');
  private readonly onSuspend = () => void this.fire('sleep');

  constructor(
    private readonly settings: SettingsStore,
    private readonly store: SnapshotStore,
    private readonly onSaved: () => void,
  ) {}

  apply(enabled: boolean): void {
    if (enabled && !this.timer) {
      powerMonitor.on('lock-screen', this.onLock);
      powerMonitor.on('suspend', this.onSuspend);
      this.timer = setInterval(() => this.checkIdle(), 60_000);
    } else if (!enabled && this.timer) {
      powerMonitor.off('lock-screen', this.onLock);
      powerMonitor.off('suspend', this.onSuspend);
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private checkIdle(): void {
    const idle = powerMonitor.getSystemIdleTime();
    if (idle < IDLE_SECONDS) {
      this.idleFired = false;
      return;
    }
    if (!this.idleFired) {
      this.idleFired = true;
      void this.fire('idle');
    }
  }

  private async fire(trigger: SnapshotTrigger): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const settings = this.settings.get();
      const now = Date.now();
      let saved = false;
      for (const project of settings.projects) {
        if (await this.due(project, now)) {
          await takeSnapshot(this.store, { project, settings, note: '', trigger });
          this.lastAuto.set(project.id, now);
          saved = true;
        }
      }
      if (saved) this.onSaved();
    } catch {
      // auto snapshots are best effort
    } finally {
      this.running = false;
    }
  }

  private async due(project: Project, now: number): Promise<boolean> {
    const newest = await newestChange(project.path, now - ACTIVITY_WINDOW_MS).catch(() => 0);
    const list = await this.store.list(project.id);
    const lastAutoStored = list.find((s) => s.auto);
    const lastAuto = Math.max(this.lastAuto.get(project.id) ?? 0, lastAutoStored ? Date.parse(lastAutoStored.createdAt) : 0) || null;
    return shouldAutoSnapshot({
      now,
      newestChangeMs: newest,
      lastSnapshotMs: list[0] ? Date.parse(list[0].createdAt) : null,
      lastAutoMs: lastAuto,
    });
  }
}
