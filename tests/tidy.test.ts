import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { canName, cleanFileName, closeDocsScript, closeTabsScript, freePath, saveAsScript, suggestedFileName } from '../src/main/tidy';
import type { Item } from '../src/shared/types';

const doc1: Item = { key: 'untitled:Microsoft Word:Document1', kind: 'doc', label: 'Document1', detail: '', app: 'Microsoft Word', untitled: true };

describe('naming untitled files', () => {
  it('suggests the job name, numbered when there are several', () => {
    expect(suggestedFileName('Climate essay', doc1, 0, 1)).toBe('Climate essay');
    expect(suggestedFileName('Climate essay', doc1, 1, 2)).toBe('Climate essay – 2');
  });

  it('cleans characters a file name cannot have', () => {
    expect(cleanFileName('  Notes: week 3/4  ')).toBe('Notes- week 3-4');
  });

  it('only names untitled documents in apps it can save', () => {
    expect(canName(doc1)).toBe(true);
    expect(canName({ ...doc1, app: 'Preview' })).toBe(false);
    expect(canName({ ...doc1, untitled: undefined })).toBe(false);
  });

  it('never overwrites an existing file', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'wwi-name-'));
    await writeFile(path.join(dir, 'Essay.docx'), 'x');
    expect(await freePath('Essay', 'Microsoft Word', dir)).toBe(path.join(dir, 'Essay 2.docx'));
    expect(await freePath('Other', 'Pages', dir)).toBe(path.join(dir, 'Other.pages'));
    await rm(dir, { recursive: true, force: true });
  });
});

describe('close scripts', () => {
  it('match tabs by address while ignoring ?query and #fragment, and skip private windows', () => {
    const s = closeTabsScript('chrome');
    expect(s).toContain('u starts with (t & "?")');
    expect(s).toContain('incognito');
    expect(closeTabsScript('safari')).not.toContain('incognito');
  });

  it('ask apps to close documents normally, so unsaved changes get a prompt', () => {
    expect(closeDocsScript('Microsoft Word')).toContain('close d saving ask');
    expect(closeDocsScript('Pages')).toContain('close d saving ask');
    expect(closeDocsScript('Finder')).toContain('close w');
    expect(closeDocsScript('Spotify')).toBeNull();
    expect(saveAsScript('Preview')).toBeNull();
    expect(saveAsScript('Microsoft Word')).toContain('save as d file name hfsPath');
  });
});
