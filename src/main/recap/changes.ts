// "What changed since" a snapshot: new commits, files edited after it, files that are gone,
// and changes that are still uncommitted.

import type { Changes, Commit, FileEntry, Snapshot } from '../../shared/types';
import { missingFiles, recentFiles } from '../collectors/files';
import { changedLines, collectGit, commitsSince } from '../collectors/git';

export interface CurrentState {
  branch: string | null;
  status: string[] | null;
  newCommits: Commit[];
  editedAfter: FileEntry[];
  missingFiles: string[];
}

/** Pure part: compare the snapshot with what is true now. */
export function computeChanges(snap: Snapshot, now: CurrentState): Changes {
  const branchChanged =
    snap.git && now.branch && snap.git.branch !== now.branch ? { from: snap.git.branch, to: now.branch } : null;
  return {
    newCommits: now.newCommits,
    branchChanged,
    editedAfter: now.editedAfter.filter((f) => f.mtime > snap.createdAt),
    missingFiles: now.missingFiles,
    stillUncommitted: now.status ? changedLines(now.status) : [],
    noGit: !snap.git,
  };
}

/** Impure part: look at the project folder now. Any failure just means "nothing to report". */
export async function gatherCurrent(snap: Snapshot): Promise<CurrentState> {
  const since = Date.parse(snap.createdAt) + 1;
  const [git, editedAfter, missing] = await Promise.all([
    collectGit(snap.projectPath).catch(() => null),
    recentFiles(snap.projectPath, { since, limit: 20 }).catch(() => []),
    missingFiles(snap.projectPath, snap.files.map((f) => f.path)).catch(() => []),
  ]);
  const newCommits = git && snap.git?.head ? await commitsSince(snap.projectPath, snap.git.head) : [];
  return {
    branch: git?.branch ?? null,
    status: git?.status ?? null,
    newCommits,
    editedAfter,
    missingFiles: missing,
  };
}

export async function changesSince(snap: Snapshot): Promise<Changes> {
  return computeChanges(snap, await gatherCurrent(snap));
}
