import { describe, expect, it } from 'vitest';
import { shouldAutoSnapshot } from '../src/main/autorule';
import { buildPayload } from '../src/main/recap/ai';
import { computeChanges } from '../src/main/recap/changes';
import { describeStatus, localRecap, recapItems, timeAgo } from '../src/main/recap/local';
import type { Snapshot } from '../src/shared/types';

const NOW = Date.parse('2026-10-17T15:00:00.000Z');

function snapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    version: 1,
    id: '2026-10-17T13-00-00-000Z',
    projectId: 'app-abc123',
    projectName: 'my-app',
    projectPath: '/Users/me/my-app',
    createdAt: '2026-10-17T13:00:00.000Z',
    auto: false,
    trigger: 'manual',
    note: 'wire up the save button',
    files: [
      { path: 'src/Save.tsx', mtime: '2026-10-17T12:59:00.000Z', size: 100 },
      { path: 'src/api.ts', mtime: '2026-10-17T12:30:00.000Z', size: 100 },
    ],
    git: {
      branch: 'feature/save',
      head: 'a'.repeat(40),
      status: ['## feature/save', ' M src/Save.tsx', '?? src/new.ts'],
      diffStat: ' src/Save.tsx | 4 ++--',
      commits: [{ hash: 'a'.repeat(40), subject: 'add save api', date: '2026-10-17T12:00:00Z' }],
      stashes: [],
    },
    tabs: [
      { browser: 'chrome', window: 1, title: 'React docs', url: 'https://react.dev/reference', active: false },
      { browser: 'chrome', window: 1, title: 'PR #12', url: 'https://github.com/me/my-app/pull/12', active: true },
    ],
    shell: null,
    errors: [],
    ...over,
  };
}

describe('localRecap', () => {
  it('summarizes the snapshot and what changed', () => {
    const snap = snapshot();
    const changes = computeChanges(snap, {
      branch: 'main',
      status: ['## main', ' M src/Save.tsx'],
      newCommits: [{ hash: 'b'.repeat(40), subject: 'finish save', date: '' }],
      editedAfter: [
        { path: 'src/Save.tsx', mtime: '2026-10-17T14:00:00.000Z', size: 1 },
        { path: 'src/old.ts', mtime: '2026-10-17T12:00:00.000Z', size: 1 },
      ],
      missingFiles: ['src/api.ts'],
    });
    expect(changes.branchChanged).toEqual({ from: 'feature/save', to: 'main' });
    expect(changes.editedAfter.map((f) => f.path)).toEqual(['src/Save.tsx']);

    const text = localRecap(snap, changes, NOW);
    expect(text).toContain('You were working in my-app on branch feature/save, 2 hours ago (saved by you).');
    expect(text).toContain('Your note: "wire up the save button"');
    expect(text).toContain('2 uncommitted changes: src/Save.tsx (edited), src/new.ts (new)');
    expect(text).toContain('1 new commit (latest: "finish save")');
    expect(text).toContain('1 file no longer there (src/api.ts)');
    expect(text).toContain('Key tabs: PR #12.');
    expect(text).toContain('First step: pick up your note: wire up the save button.');
    expect(text).not.toContain('—');
  });

  it('handles a folder with no git and nothing else', () => {
    const snap = snapshot({ git: null, tabs: [], files: [], note: '' });
    const text = localRecap(snap, computeChanges(snap, { branch: null, status: null, newCommits: [], editedAfter: [], missingFiles: [] }), NOW);
    expect(text).toContain('Nothing has changed');
    expect(text).toContain('First step:');
  });
});

describe('recapItems', () => {
  it('puts active tabs first and suggests them plus the top files', () => {
    const items = recapItems(snapshot());
    expect(items[0]).toMatchObject({ kind: 'tab', label: 'PR #12', suggested: true });
    expect(items[1]).toMatchObject({ kind: 'tab', suggested: false });
    expect(items.filter((i) => i.kind === 'file').every((i) => i.suggested)).toBe(true);
  });
});

describe('helpers', () => {
  it('describes git status lines', () => {
    expect(describeStatus('?? a.ts')).toBe('a.ts (new)');
    expect(describeStatus(' D b.ts')).toBe('b.ts (deleted)');
  });
  it('formats time ago', () => {
    expect(timeAgo('2026-10-17T14:58:00.000Z', NOW)).toBe('2 min ago');
    expect(timeAgo('2026-10-15T15:00:00.000Z', NOW)).toBe('2 days ago');
  });
});

describe('AI payload', () => {
  it('never includes the project path, file contents or full hashes, and is redacted', () => {
    const snap = snapshot({
      note: 'export API_TOKEN=abc then test',
      tabs: [{ browser: 'chrome', window: 1, title: 't', url: 'https://x.io/?token=abc', active: true }],
    });
    const changes = computeChanges(snap, { branch: 'feature/save', status: [], newCommits: [], editedAfter: [], missingFiles: [] });
    const json = JSON.stringify(buildPayload(snap, changes));
    expect(json).not.toContain('/Users/me');
    expect(json).not.toContain('a'.repeat(40));
    expect(json).toContain('API_TOKEN=[REDACTED]');
    expect(json).toContain('token=[REDACTED]');
  });
});

describe('shouldAutoSnapshot', () => {
  const base = { now: NOW, newestChangeMs: NOW - 10 * 60_000, lastSnapshotMs: null, lastAutoMs: null };
  it('fires after recent activity', () => expect(shouldAutoSnapshot(base)).toBe(true));
  it('skips without recent activity', () => expect(shouldAutoSnapshot({ ...base, newestChangeMs: NOW - 2 * 3_600_000 })).toBe(false));
  it('skips when nothing changed since the last save', () => expect(shouldAutoSnapshot({ ...base, lastSnapshotMs: NOW - 5 * 60_000 })).toBe(false));
  it('waits 30 minutes between auto snapshots', () => {
    expect(shouldAutoSnapshot({ ...base, lastAutoMs: NOW - 20 * 60_000 })).toBe(false);
    expect(shouldAutoSnapshot({ ...base, lastAutoMs: NOW - 31 * 60_000 })).toBe(true);
  });
});
