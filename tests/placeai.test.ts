// ⌃S with Claude (src/main/jobs/placeai.ts): exactly what goes out, and that only a checked answer is used.

import { describe, expect, it } from 'vitest';
import type { Item } from '../src/shared/types';
import { acceptPlacement, placePayload } from '../src/main/jobs/placeai';
import { acceptAiSort, sortPayload } from '../src/main/jobs/sortai';

const tab = (url: string, label: string): Item => ({ key: `tab:${url}`, kind: 'tab', label, detail: '', app: 'Google Chrome', url, browser: 'chrome', window: 1 });
const doc = (p: string): Item => ({ key: `doc:${p}`, kind: 'doc', label: p.split('/').pop()!, detail: '', app: 'Microsoft Word', path: p });

const toronto = tab('https://en.wikipedia.org/wiki/Toronto', 'Toronto - Wikipedia');
const hotel = tab('https://www.booking.com/city/ca/toronto.html?session=SECRET123&token=abc', 'Toronto hotels');
const essay = doc('/Users/me/School/Climate essay.docx');
const folders = [{ id: 'toronto-trip-1', name: 'Toronto trip', note: 'book the hotel', items: [toronto], open: true }];

describe('what ⌃S sends to Claude', () => {
  it('short ids, titles, scrubbed addresses and a document folder name: never paths or secrets', () => {
    const req = placePayload([toronto, hotel, essay], hotel.key, folders, null);
    const text = JSON.stringify(req.payload);
    expect(req.payload.front).toBe('o2');
    expect(text).not.toContain('/Users/me');
    expect(text).not.toContain('SECRET123');
    expect(text).toContain('"folder":"School"');
    // The tab that's already in Toronto trip says so; the folder says it's open and what it holds.
    expect((req.payload.open as { id: string; in?: string }[])[0].in).toBe('f1');
    expect(req.payload.folders).toEqual([{ id: 'f1', name: 'Toronto trip', has: ['Toronto - Wikipedia'], note: 'book the hotel', open: true }]);
    expect(req.payload.target).toBeUndefined();
  });

  it('says which folder you chose yourself', () => {
    expect(placePayload([hotel], hotel.key, folders, 'toronto-trip-1').payload.target).toBe('f1');
    expect(placePayload([hotel], hotel.key, folders, 'new').payload.target).toBe('new');
  });
});

describe("Claude's answer to ⌃S", () => {
  const req = placePayload([toronto, hotel, essay], hotel.key, folders, null);
  it('a folder it was shown and ids it was shown', () => {
    const p = acceptPlacement({ folder: 'f1', items: ['o1', 'o2', 'o99'], name: '' }, req)!;
    expect(p.jobId).toBe('toronto-trip-1');
    expect([...p.keys]).toEqual([toronto.key, hotel.key]);
  });
  it('a new folder comes with a clean name', () => {
    const p = acceptPlacement({ folder: 'new', items: ['o3'], name: '"Climate essay".' }, req)!;
    expect(p.jobId).toBeNull();
    expect(p.name).toBe('Climate essay');
  });
  it('anything else is dropped', () => {
    expect(acceptPlacement({ folder: 'f7', items: ['o1'], name: '' }, req)).toBeNull();
    expect(acceptPlacement({ folder: 'f1', items: ['zz'], name: '' }, req)).toBeNull();
    expect(acceptPlacement('nonsense', req)).toBeNull();
  });
});

describe('Smart Tidy all with your folders', () => {
  it('shows Claude the folders you have, and a piece can join one (one thing is enough)', () => {
    const cn = tab('https://en.wikipedia.org/wiki/CN_Tower', 'CN Tower - Wikipedia');
    const req = sortPayload([cn, essay, hotel], [{ id: 'toronto-trip-1', name: 'Toronto trip', items: [toronto] }]);
    expect(req.payload.folders).toEqual([{ id: 'f1', name: 'Toronto trip', has: ['Toronto - Wikipedia'] }]);
    const pieces = acceptAiSort({ pieces: [{ name: '', folder: 'f1', items: ['i1'] }, { name: 'Climate essay', folder: '', items: ['i2'] }, { name: 'x', folder: 'f9', items: ['i3'] }] }, req.byId, req.folderById);
    // The CN Tower joins Toronto trip; a new piece of one thing, or one for a folder Claude made up, is dropped.
    expect(pieces).toEqual([{ name: '', items: [cn], jobId: 'toronto-trip-1' }]);
  });
  it('with no folders, nothing about folders is sent', () => {
    expect(sortPayload([essay, hotel]).payload.folders).toBeUndefined();
  });
});
