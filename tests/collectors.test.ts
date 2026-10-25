import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isPermissionError, parseTabOutput } from '../src/main/collectors/browsers';
import { missingFiles, recentFiles, safeJoin } from '../src/main/collectors/files';
import { collectGit, commitsSince } from '../src/main/collectors/git';
import { RunError } from '../src/main/exec';
import { takeSnapshot } from '../src/main/snapshot';
import { SnapshotStore } from '../src/main/store';
import { DEFAULT_SETTINGS } from '../src/shared/validate';

let root: string;
const hasGit = (() => {
  try {
    execFileSync('git', ['--version']);
    return true;
  } catch {
    return false;
  }
})();

beforeAll(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'wwi-proj-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'node_modules/pkg'), { recursive: true });
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'src/a.ts'), 'a');
  await writeFile(path.join(root, 'src/b.ts'), 'b');
  await writeFile(path.join(root, 'node_modules/pkg/index.js'), 'x');
  await writeFile(path.join(root, 'dist/out.js'), 'x');
  await writeFile(path.join(root, 'big.bin'), Buffer.alloc(5 * 1024 * 1024 + 1));
  await writeFile(path.join(root, 'old.txt'), 'old');
  const old = new Date(Date.now() - 48 * 3_600_000);
  await utimes(path.join(root, 'old.txt'), old, old);
  const newer = new Date(Date.now() + 1000);
  await utimes(path.join(root, 'src/b.ts'), newer, newer);
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('files collector', () => {
  it('finds recent files, newest first, skipping ignored folders, big and old files', async () => {
    const files = await recentFiles(root, { since: Date.now() - 12 * 3_600_000, limit: 30 });
    expect(files.map((f) => f.path)).toEqual(['src/b.ts', 'src/a.ts']);
  });

  it('respects the limit', async () => {
    expect(await recentFiles(root, { since: 0, limit: 1 })).toHaveLength(1);
  });

  it('reports missing files and refuses paths outside the project', async () => {
    expect(await missingFiles(root, ['src/a.ts', 'src/gone.ts'])).toEqual(['src/gone.ts']);
    expect(() => safeJoin(root, '../etc/passwd')).toThrow();
  });
});

describe.skipIf(!hasGit)('git collector', () => {
  it('returns null for a folder that is not a repo', async () => {
    const plain = await mkdtemp(path.join(os.tmpdir(), 'wwi-plain-'));
    expect(await collectGit(plain)).toBeNull();
    await rm(plain, { recursive: true, force: true });
  });

  it('reads branch, status, commits and new commits since', async () => {
    const repo = await mkdtemp(path.join(os.tmpdir(), 'wwi-git-'));
    const g = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
    g('init', '-q', '-b', 'main');
    g('config', 'user.email', 't@example.com');
    g('config', 'user.name', 'Test');
    await writeFile(path.join(repo, 'a.txt'), '1');
    g('add', '.');
    g('commit', '-q', '-m', 'first');
    await writeFile(path.join(repo, 'a.txt'), '2');
    await writeFile(path.join(repo, 'new.txt'), 'n');

    const state = await collectGit(repo);
    expect(state?.branch).toBe('main');
    expect(state?.commits[0].subject).toBe('first');
    expect(state?.status).toContain(' M a.txt');
    expect(state?.status).toContain('?? new.txt');
    expect(state?.diffStat).toContain('a.txt');

    g('commit', '-q', '-am', 'second');
    const since = await commitsSince(repo, state!.head!);
    expect(since.map((c) => c.subject)).toEqual(['second']);
    await rm(repo, { recursive: true, force: true });
  });
});

describe('browser output parsing', () => {
  it('parses records and flags the active tab', () => {
    const out = '1\x1ftrue\x1fhttps://a.io/\x1fA  title\x1e1\x1ffalse\x1fhttps://b.io/\x1fB\x1e2\x1ftrue\x1fhttps://c.io/\x1fC\x1e';
    expect(parseTabOutput('chrome', out)).toEqual([
      { browser: 'chrome', window: 1, active: true, url: 'https://a.io/', title: 'A title' },
      { browser: 'chrome', window: 1, active: false, url: 'https://b.io/', title: 'B' },
      { browser: 'chrome', window: 2, active: true, url: 'https://c.io/', title: 'C' },
    ]);
  });

  it('spots the macOS Automation permission error', () => {
    expect(isPermissionError(new RunError('execution error: Not authorized to send Apple events to Google Chrome. (-1743)', 1, ''))).toBe(true);
    expect(isPermissionError(new RunError('some other failure', 1, ''))).toBe(false);
  });
});

describe('takeSnapshot', () => {
  it('saves a snapshot and records collector errors without failing', async () => {
    const base = await mkdtemp(path.join(os.tmpdir(), 'wwi-snaps-'));
    const store = new SnapshotStore(base);
    const settings = { ...DEFAULT_SETTINGS, browsers: { chrome: false, arc: false, safari: false } };
    const project = { id: 'proj-abc123', name: 'proj', path: root };
    const snap = await takeSnapshot(store, { project, settings, note: 'next: write tests', trigger: 'manual' });
    expect(snap.note).toBe('next: write tests');
    expect(snap.files.length).toBeGreaterThan(0);
    expect(snap.auto).toBe(false);

    const missing = await takeSnapshot(store, { project: { ...project, path: path.join(root, 'nope') }, settings, note: '', trigger: 'idle' });
    expect(missing.auto).toBe(true);
    expect(missing.files).toEqual([]);
    expect((await store.list(project.id)).length).toBe(2);
    await rm(base, { recursive: true, force: true });
  });
});
