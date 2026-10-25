import { describe, expect, it } from 'vitest';
import { writeBrief, type BriefWriter } from '../src/main/brief';
import { acceptAiBrief, basicBrief, extractJson, neededItems } from '../src/main/brief/basic';
import { buildPromptData } from '../src/main/brief/prompt';
import { hintFrom, iconFor } from '../src/main/core';
import type { Item, SaveEntry } from '../src/shared/types';

const essay: Item = { key: 'doc:/Users/aryan/Documents/School/Climate essay.docx', kind: 'doc', label: 'Climate essay.docx', detail: 'Documents/School', app: 'Microsoft Word', path: '/Users/aryan/Documents/School/Climate essay.docx', active: true };
const jstor: Item = { key: 'tab:https://www.jstor.org/stable/1?token=abc', kind: 'tab', label: 'Sea level rise | JSTOR', detail: 'jstor.org', app: 'Google Chrome', url: 'https://www.jstor.org/stable/1?token=abc', browser: 'chrome', window: 1, active: true };
const scholar: Item = { key: 'tab:https://scholar.google.com/', kind: 'tab', label: 'Google Scholar', detail: 'scholar.google.com', app: 'Google Chrome', url: 'https://scholar.google.com/', browser: 'chrome', window: 1 };
const untitled: Item = { key: 'untitled:Microsoft Word:Document1', kind: 'doc', label: 'Document1', detail: 'Microsoft Word, not saved yet', app: 'Microsoft Word', untitled: true };

function entry(over: Partial<SaveEntry> = {}): SaveEntry {
  return {
    version: 2, id: '2026-10-25T10-00-00-000Z', jobId: 'climate-essay-abc123', savedAt: '2026-10-25T10:00:00.000Z',
    note: 'need 2 more sea level sources', items: [essay, jstor, scholar, untitled], frontKey: essay.key,
    appOrder: ['Microsoft Word', 'Google Chrome'], tidied: false, errors: [], ...over,
  };
}

describe('basic brief', () => {
  it('says what you were on last, what else was open, and your note, in plain words', () => {
    const b = basicBrief(entry());
    expect(b.sentence).toBe('You were last on Climate essay.docx, with 1 other file and 2 other tabs open. Your note: need 2 more sea level sources.');
    expect(b.highlights).toEqual(['Climate essay.docx']);
    expect(b.source).toBe('basic');
    expect(b.sentence).not.toMatch(/—/);
  });

  it('handles an empty save', () => {
    expect(basicBrief(entry({ items: [], frontKey: null, note: '' })).sentence).toBe('Nothing was open when you saved this.');
  });

  it('needs the front item, things the note mentions, saved docs and active tabs', () => {
    expect(neededItems(entry())).toEqual([essay.key, jstor.key]);
  });
});

describe('AI answers', () => {
  const ids = new Map([['i1', essay.key], ['i2', jstor.key]]);

  it('accepts a good answer and maps ids back to items', () => {
    const b = acceptAiBrief({ sentence: 'You were writing your essay — next, find sources.', highlights: ['your essay', 'not in sentence'], needed: ['i2', 'i9'] }, ids, 'claude', []);
    expect(b?.sentence).toBe('You were writing your essay, next, find sources.');
    expect(b?.highlights).toEqual(['your essay']);
    expect(b?.needed).toEqual([jstor.key]);
  });

  it('rejects junk', () => {
    expect(acceptAiBrief(null, ids, 'apple', [])).toBeNull();
    expect(acceptAiBrief({ sentence: 'hi' }, ids, 'apple', [])).toBeNull();
  });

  it('pulls JSON out of chatty model text', () => {
    expect(extractJson('Sure! ```json\n{"sentence":"x"}\n```')).toEqual({ sentence: 'x' });
    expect(extractJson('no json here')).toBeNull();
  });
});

describe('what the AI is sent', () => {
  it('uses short ids, scrubs addresses, and never includes file paths', () => {
    const prev = entry({ id: '2026-10-24T10-00-00-000Z', items: [essay], note: 'start intro' });
    const data = buildPromptData(entry({ note: 'export API_TOKEN=abc then write' }), prev, 'Too long');
    const json = JSON.stringify(data.payload);
    expect(json).not.toContain('/Users/aryan');
    expect(json).toContain('token=[REDACTED]');
    expect(json).toContain('API_TOKEN=[REDACTED]');
    expect(json).toContain('"inFrontWhenSaved":true');
    expect(json).toContain('"newItems"');
    expect(data.idToKey.get('i1')).toBe(essay.key);
  });
});

describe('choosing a writer', () => {
  const ok: BriefWriter = { name: 'claude', write: async () => ({ source: 'claude', sentence: 'From Claude.', highlights: [], needed: [], createdAt: '' }) };
  const off: BriefWriter = { name: 'claude', write: async () => null };
  const broken: BriefWriter = { name: 'apple', write: async () => { throw new Error('model not ready'); } };

  it('uses the first writer that answers', async () => {
    expect((await writeBrief([off, ok], entry(), null, null)).sentence).toBe('From Claude.');
  });

  it('falls back to the basic brief and says why', async () => {
    const b = await writeBrief([off, broken], entry(), null, null);
    expect(b.source).toBe('basic');
    expect(b.fallbackReason).toContain('model not ready');
  });
});

describe('menu helpers', () => {
  it('makes a short hint and picks an icon', () => {
    expect(hintFrom(entry({ brief: basicBrief(entry()) }))).toBe('Climate essay.docx, with 1 other file and 2 other tabs open');
    expect(iconFor([jstor, scholar, essay])).toBe('tab');
    expect(iconFor([])).toBe('stack');
  });
});
