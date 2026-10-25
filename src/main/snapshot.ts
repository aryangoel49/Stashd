// Builds one snapshot by running every collector. A collector that fails adds an error
// to the snapshot and never stops the others.

import type { CollectorError, Project, Settings, Snapshot, SnapshotTrigger } from '../shared/types';
import { BROWSERS } from '../shared/validate';
import { collectTabs } from './collectors/browsers';
import { recentFiles } from './collectors/files';
import { collectGit } from './collectors/git';
import { collectShellHistory } from './collectors/shell';
import type { SnapshotStore } from './store';

export const MAX_FILES = 30;

async function guard<T>(name: string, errors: CollectorError[], fallback: T, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    errors.push({ collector: name, message: (e instanceof Error ? e.message : String(e)).slice(0, 300) });
    return fallback;
  }
}

export interface TakeOptions {
  project: Project;
  settings: Settings;
  note: string;
  trigger: SnapshotTrigger;
  now?: Date;
}

export async function takeSnapshot(store: SnapshotStore, opts: TakeOptions): Promise<Snapshot> {
  const { project, settings } = opts;
  const now = opts.now ?? new Date();
  const since = now.getTime() - settings.lookbackHours * 3_600_000;
  const errors: CollectorError[] = [];

  const enabledBrowsers = BROWSERS.filter((b) => settings.browsers[b]);
  const [files, git, tabResult, shell] = await Promise.all([
    guard('files', errors, [], () => recentFiles(project.path, { since, limit: MAX_FILES })),
    guard('git', errors, null, () => collectGit(project.path)),
    guard('browsers', errors, { tabs: [], errors: [] }, () =>
      collectTabs(enabledBrowsers, { keepQueryStrings: settings.keepQueryStrings, excludedDomains: settings.excludedDomains }),
    ),
    settings.shellHistory ? guard<string[] | null>('shell', errors, null, () => collectShellHistory(since)) : Promise.resolve(null),
  ]);
  errors.push(...tabResult.errors);

  const snapshot: Snapshot = {
    version: 1,
    id: await store.freeId(project.id, now),
    projectId: project.id,
    projectName: project.name,
    projectPath: project.path,
    createdAt: now.toISOString(),
    auto: opts.trigger !== 'manual',
    trigger: opts.trigger,
    note: opts.note,
    files,
    git,
    tabs: tabResult.tabs,
    shell,
    errors,
  };
  await store.save(snapshot);
  await store.prune(project.id, { count: settings.retentionCount, days: settings.retentionDays }, now.getTime());
  return snapshot;
}
