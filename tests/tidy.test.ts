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
    expect(s).toContain('if wwiUrl is wwiT then return true');
    expect(s).not.toContain('starts with (wwiT');
    expect(s).toContain('incognito');
    expect(closeTabsScript('safari')).not.toContain('incognito');
  });

  it('find windows by id, read each window in one go, and close a whole window only in Chrome', () => {
    // Closing a window used to shift the window list, so the next window was skipped and the script failed.
    for (const b of ['chrome', 'arc', 'safari'] as const) {
      expect(closeTabsScript(b)).toContain('set wwiWin to window id wwiId');
      expect(closeTabsScript(b)).toContain('URL of every tab of wwiWin');
    }
    expect(closeTabsScript('chrome')).toContain('if wwiAll then');
    // Arc keeps a closed window's tabs in its sidebar; Safari may ask before closing a window.
    expect(closeTabsScript('arc')).toContain('if false then');
    expect(closeTabsScript('safari')).toContain('if false then');
  });

  it('ask apps to close documents normally, so unsaved changes get a prompt', () => {
    expect(closeDocsScript('Microsoft Word')).toContain('close wwiDoc saving ask');
    expect(closeDocsScript('Microsoft Word')).toContain('close (active window of wwiDoc)');
    expect(closeDocsScript('Microsoft Word')).toContain('wwiFull contains "://"');
    expect(closeDocsScript('Pages')).toContain('close wwiDoc saving ask');
    expect(closeDocsScript('Finder')).toContain('close wwiWin');
    expect(closeDocsScript('Spotify')).toBeNull();
    expect(saveAsScript('Preview')).toBeNull();
    expect(saveAsScript('Microsoft Word')).toContain('save as wwiDoc file name wwiHfs');
  });
});

describe('AppleScript variable names', () => {
  it("never use words that apps define themselves (like Word's 'row')", async () => {
    const { DOC_ADAPTERS } = await import('../src/main/capture/docs');
    const scripts = [
      ...DOC_ADAPTERS.map((a) => a.script),
      ...DOC_ADAPTERS.map((a) => closeDocsScript(a.app) ?? ''),
      ...DOC_ADAPTERS.map((a) => saveAsScript(a.app) ?? ''),
      closeTabsScript('chrome'),
      closeTabsScript('safari'),
    ];
    for (const s of scripts) {
      for (const m of s.matchAll(/\bset (\w+) to\b/g)) expect(m[1], `variable "${m[1]}"`).toMatch(/^wwi[A-Z]/);
      for (const m of s.matchAll(/\brepeat with (\w+) (in|from)\b/g)) expect(m[1], `loop variable "${m[1]}"`).toMatch(/^wwi[A-Z]/);
    }
  });
});
