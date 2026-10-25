// Reads git state with plain git commands. Returns null if the folder is not a git repo.

import type { Commit, GitState } from '../../shared/types';
import { run } from '../exec';

const SEP = '\x1f';

function git(cwd: string, args: string[]): Promise<string> {
  return run('git', ['-C', cwd, '--no-pager', ...args], { timeoutMs: 5000 }).then((r) => r.stdout);
}

async function optional(p: Promise<string>): Promise<string> {
  try {
    return await p;
  } catch {
    return '';
  }
}

export function parseLog(out: string): Commit[] {
  return out
    .split('\n')
    .filter((l) => l.includes(SEP))
    .map((l) => {
      const [hash, subject, date] = l.split(SEP);
      return { hash, subject: subject ?? '', date: date ?? '' };
    });
}

export const LOG_FORMAT = `--pretty=format:%H${SEP}%s${SEP}%cI`;

export async function isRepo(cwd: string): Promise<boolean> {
  try {
    return (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
  } catch {
    return false;
  }
}

export async function collectGit(cwd: string): Promise<GitState | null> {
  if (!(await isRepo(cwd))) return null;
  const [branch, head, status, diffStat, log, stash] = await Promise.all([
    optional(git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])),
    optional(git(cwd, ['rev-parse', 'HEAD'])),
    git(cwd, ['status', '--porcelain=v1', '-b']),
    optional(git(cwd, ['diff', '--stat'])),
    optional(git(cwd, ['log', '-5', LOG_FORMAT])),
    optional(git(cwd, ['stash', 'list'])),
  ]);
  const statusLines = status.split('\n').filter(Boolean);
  let b = branch.trim();
  if (!b || b === 'HEAD') {
    // New repo with no commits, or detached HEAD: take it from the "## " status line.
    const first = statusLines.find((l) => l.startsWith('## '));
    b = first ? first.slice(3).split('...')[0].replace(/^No commits yet on /, '') : 'HEAD';
  }
  return {
    branch: b,
    head: head.trim() || null,
    status: statusLines,
    diffStat: diffStat.trim(),
    commits: parseLog(log),
    stashes: stash.split('\n').filter(Boolean).slice(0, 20),
  };
}

/** Commits made after `since` (a hash), newest first. Empty if the hash is gone. */
export async function commitsSince(cwd: string, since: string): Promise<Commit[]> {
  try {
    return parseLog(await git(cwd, ['log', '-50', LOG_FORMAT, `${since}..HEAD`]));
  } catch {
    return [];
  }
}

/** Status lines without the "## branch" header. */
export function changedLines(status: string[]): string[] {
  return status.filter((l) => !l.startsWith('## '));
}
