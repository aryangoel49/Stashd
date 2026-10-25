import { describe, expect, it } from 'vitest';
import { assemble, frontItemKey } from '../src/main/capture';
import { parseDocOutput, shortDir } from '../src/main/capture/docs';
import { isPermissionError, parseTabOutput } from '../src/main/collectors/browsers';
import { RunError } from '../src/main/exec';
import { parseWindows } from '../src/main/helper';

const US = '\x1f';
const RS = '\x1e';

describe('document adapters', () => {
  it('reads saved and unsaved documents, the first one being in front', () => {
    const out = `Essay.docx${US}/Users/a/Documents/Essay.docx${RS}Document1${US}${RS}`;
    const items = parseDocOutput({ app: 'Microsoft Word', kind: 'doc' }, out);
    expect(items).toEqual([
      { key: 'doc:/Users/a/Documents/Essay.docx', kind: 'doc', label: 'Essay.docx', detail: 'Documents', app: 'Microsoft Word', path: '/Users/a/Documents/Essay.docx', untitled: undefined, active: true },
      { key: 'untitled:Microsoft Word:Document1', kind: 'doc', label: 'Document1', detail: 'Microsoft Word, not saved yet', app: 'Microsoft Word', path: undefined, untitled: true, active: false },
    ]);
  });

  it('reads OneDrive documents (Office gives a web address) and untitled ones', () => {
    const out = `AI research.docx${US}${US}https://d.docs.live.net/abc123/Documents/AI%20research.docx${RS}Document2${US}${US}Document2${RS}`;
    const items = parseDocOutput({ app: 'Microsoft Word', kind: 'doc' }, out);
    expect(items[0]).toMatchObject({ key: 'doc:https://d.docs.live.net/abc123/Documents/AI%20research.docx', label: 'AI research.docx', url: 'https://d.docs.live.net/abc123/Documents/AI%20research.docx', detail: 'Microsoft Word, in OneDrive', active: true });
    expect(items[0].untitled).toBeUndefined();
    expect(items[1]).toMatchObject({ key: 'untitled:Microsoft Word:Document2', untitled: true });
  });

  it('reads Finder folders and skips duplicates', () => {
    const out = `School${US}/Users/a/Documents/School/${RS}School${US}/Users/a/Documents/School/${RS}`;
    const items = parseDocOutput({ app: 'Finder', kind: 'folder' }, out);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'folder:/Users/a/Documents/School', kind: 'folder', label: 'School' });
  });

  it('shortens folders', () => {
    expect(shortDir('/Users/aryan/Documents/School/Term 1')).toBe('School/Term 1');
    expect(shortDir('/Users/aryan')).toBe('/Users/aryan');
  });
});

describe('helper output', () => {
  it('parses the windows command', () => {
    const w = parseWindows(JSON.stringify({ front: 'Microsoft Word', frontBundleId: 'com.microsoft.Word', apps: [{ name: 'Microsoft Word', bundleId: 'com.microsoft.Word', path: '/A', hidden: false }], order: ['Microsoft Word', 'Dock'] }));
    expect(w.front).toBe('Microsoft Word');
    expect(w.apps[0].name).toBe('Microsoft Word');
    expect(() => parseWindows('{"error":"nope"}')).toThrow('nope');
  });
});

describe('assemble and front item', () => {
  const win = {
    front: 'Where Was I',
    frontBundleId: null,
    apps: ['Where Was I', 'Microsoft Word', 'Google Chrome', 'Spotify', 'Figma', 'Finder'].map((name) => ({ name, bundleId: '', path: '', hidden: false })),
    order: ['Where Was I', 'Microsoft Word', 'Dock', 'Google Chrome', 'Spotify'],
  };
  const tabs = parseTabOutput('chrome', `1${US}false${US}https://a.io/${US}A${RS}1${US}true${US}https://b.io/${US}B${RS}2${US}true${US}https://c.io/${US}C${RS}`);
  const docs = parseDocOutput({ app: 'Microsoft Word', kind: 'doc' }, `Essay.docx${US}/Users/a/Essay.docx${RS}`);

  it('orders items front to back, skips itself and Finder, and adds plain apps', () => {
    const r = assemble(win, tabs, docs, ['Where Was I']);
    expect(r.frontApp).toBe('Microsoft Word');
    expect(r.appOrder).toEqual(['Microsoft Word', 'Google Chrome', 'Spotify', 'Figma']);
    expect(r.items.map((i) => i.key)).toEqual(['doc:/Users/a/Essay.docx', 'tab:https://a.io/', 'tab:https://b.io/', 'tab:https://c.io/', 'app:Spotify', 'app:Figma']);
  });

  it('picks the front document, or the active tab of the front browser window', () => {
    const r = assemble(win, tabs, docs, ['Where Was I']);
    expect(frontItemKey(r.items, r.appOrder)).toBe('doc:/Users/a/Essay.docx');
    expect(frontItemKey(r.items, ['Google Chrome'])).toBe('tab:https://b.io/');
    expect(frontItemKey([], [])).toBeNull();
  });
});

describe('browser tabs', () => {
  it('parses records and flags the active tab', () => {
    expect(parseTabOutput('safari', `1${US}true${US}https://a.io/${US}A  title${RS}`)).toEqual([
      { browser: 'safari', window: 1, active: true, url: 'https://a.io/', title: 'A title' },
    ]);
  });
  it('spots the macOS Automation permission error', () => {
    expect(isPermissionError(new RunError('Not authorized to send Apple events to Google Chrome. (-1743)', 1, ''))).toBe(true);
    expect(isPermissionError(new RunError('other', 1, ''))).toBe(false);
  });
});

describe('finding a document by name (Spotlight)', () => {
  it('picks the most recently changed file of the right type with the same name', async () => {
    const { pickBest } = await import('../src/main/capture/spotlight');
    const c = [
      { path: '/Users/a/Old/AI research.docx', mtimeMs: 1 },
      { path: '/Users/a/Documents/AI research.docx', mtimeMs: 5 },
      { path: '/Users/a/Documents/AI research.pdf', mtimeMs: 9 },
      { path: '/Users/a/Documents/~$AI research.docx', mtimeMs: 10 },
      { path: '/Users/a/Documents/AI research notes.docx', mtimeMs: 11 },
    ];
    expect(pickBest('AI research', 'Microsoft Word', c)).toBe('/Users/a/Documents/AI research.docx');
    expect(pickBest('AI research.docx', 'Microsoft Word', c)).toBe('/Users/a/Documents/AI research.docx');
    expect(pickBest('Budget', 'Microsoft Word', c)).toBeNull();
  });
});
