import { describe, expect, it, vi } from 'vitest';
import { askStashd, buildAsk, readAnswer, runAction, type FolderOps } from '../src/main/ask';
import type { Item, Job, SaveEntry } from '../src/shared/types';

const tab = (n: number, label: string, url: string): Item => ({ key: `tab:${url}`, kind: 'tab', label, detail: '', app: 'Google Chrome', url });
const doc = (label: string, p: string): Item => ({ key: `doc:${p}`, kind: 'doc', label, detail: '', app: 'Microsoft Word', path: p });
const job = (id: string, name: string, extra: Partial<Job> = {}): Job => ({ id, name, createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-05T10:00:00Z', done: false, prefs: { hide: {}, add: {} } as never, ...extra });
const entry = (jobId: string, items: Item[], savedAt = '2026-11-05T10:00:00Z', note = ''): SaveEntry => ({ version: 2, id: '2026-11-05T10-00-00-000Z', jobId, savedAt, note, items, frontKey: items[0]?.key ?? null, appOrder: [], tidied: false, errors: [] });

const toronto = { job: job('toronto', 'Toronto trip'), latest: entry('toronto', [tab(1, 'Queen West hotels · Booking.com', 'https://www.booking.com/searchresults.html?city=toronto&token=secret')], '2026-11-03T10:00:00Z', 'book under $180') };
const essay = { job: job('essay', 'Climate essay'), latest: entry('essay', [doc('Essay.docx', '/Users/aryan/Essay.docx'), tab(2, 'Carbon pricing and emissions · JSTOR', 'https://www.jstor.org/stable/123')], '2026-11-06T10:00:00Z') };
const open = [tab(9, 'stashd – Overview · Vercel', 'https://vercel.com/aryan/stashd')];

describe('what Ask Stashd sends', () => {
  it('puts the folders the question is about first, and only sends names, titles and sites', () => {
    const b = buildAsk({ question: 'What was I doing on the Toronto trip?', today: new Date('2026-11-07T12:00:00Z'), jobs: [essay, toronto], open, front: open[0].key, week: [] });
    const sent = JSON.parse(b.content);
    expect(sent.folders[0].name).toBe('Toronto trip');
    expect(sent.folders[0].note).toBe('book under $180');
    expect(sent.openNow[0]).toMatchObject({ id: 'o1', inFront: true, site: 'vercel.com' });
    expect(b.content).not.toContain('secret');
    expect(b.content).not.toContain('/Users/aryan');
    expect(b.content).not.toContain('searchresults');
  });
});

describe('reading the answer', () => {
  const b = buildAsk({ question: 'x', today: new Date(), jobs: [essay, toronto], open, front: open[0].key, week: [{ folder: 'essay', moments: 4, minutes: 180 }] });
  const label = () => 'saved';

  it('turns ids into your real folders and things, and drops ones it made up', () => {
    const a = readAnswer({ answer: 'It’s in Climate essay.', highlights: ['Climate essay', 'not in it'], refs: ['i2', 'f9', 'f1'], action: { type: 'none', folder: '', item: '', to: '', name: '' } }, 'where is jstor', b, label)!;
    expect(a.highlights).toEqual(['Climate essay']);
    expect(a.refs.map((r) => (r.kind === 'folder' ? r.name : r.item.label))).toEqual(['Carbon pricing and emissions · JSTOR', 'Climate essay']);
    expect(a.action).toBeNull();
  });

  it('only proposes changes that make sense', () => {
    const add = readAnswer({ answer: 'Add it?', highlights: [], refs: [], action: { type: 'add', folder: 'f1', item: 'o1', to: '', name: '' } }, 'add this tab', b, label)!;
    expect(add.action).toMatchObject({ type: 'add', jobId: 'essay', item: { label: 'stashd – Overview · Vercel' } });
    // Removing something from a folder it isn't in: no proposal.
    const wrong = readAnswer({ answer: 'Remove it?', highlights: [], refs: [], action: { type: 'remove', folder: 'f1', item: 'i3', to: '', name: '' } }, 'remove', b, label)!;
    expect(wrong.action).toBeNull();
    const rename = readAnswer({ answer: 'Rename?', highlights: [], refs: [], action: { type: 'rename', folder: 'f2', item: '', to: '', name: '  Toronto 2027 ' } }, 'rename', b, label)!;
    expect(rename.action).toMatchObject({ type: 'rename', jobId: 'toronto', name: 'Toronto 2027' });
  });

  it('shows the week only for questions about time', () => {
    expect(readAnswer({ answer: 'Mostly the essay.', highlights: [], refs: [], action: { type: 'none', folder: '', item: '', to: '', name: '' } }, 'What did I work on this week?', b, label)!.week).toEqual([{ name: 'Climate essay', minutes: 180, saves: 4 }]);
    expect(readAnswer({ answer: 'Hi.', highlights: [], refs: [], action: { type: 'none', folder: '', item: '', to: '', name: '' } }, 'where is jstor', b, label)!.week).toBeUndefined();
  });

  it('rejects junk', () => expect(readAnswer({ answer: '' }, 'q', b, label)).toBeNull());
});

describe('changes, and taking them back', () => {
  it('every change can be undone', async () => {
    const log: string[] = [];
    const ops: FolderOps = {
      addToFolder: async (j, items) => void log.push(`add ${j} ${items[0].key}`),
      removeItem: async (j, k) => void log.push(`remove ${j} ${k}`),
      restoreItem: async (j, k) => void log.push(`restore ${j} ${k}`),
      moveItem: async (f, k, t) => void log.push(`move ${f}>${t} ${k}`),
      rename: async (j, n) => void log.push(`rename ${j} ${n}`),
      currentName: async () => 'Old name',
      setPinned: async (j, p) => void log.push(`pin ${j} ${p}`),
      setDone: async (j, d) => void log.push(`done ${j} ${d}`),
      unpack: async (j) => void log.push(`unpack ${j}`),
    };
    const base = { id: 'x', jobId: 'essay', folder: 'Climate essay' };
    await (await runAction({ ...base, type: 'add', item: open[0] }, ops))!();
    await (await runAction({ ...base, type: 'move', item: open[0], toJobId: 'toronto', to: 'Toronto trip' }, ops))!();
    await (await runAction({ ...base, type: 'rename', name: 'New name' }, ops))!();
    expect(await runAction({ ...base, type: 'unpack' }, ops)).toBeNull();
    expect(log).toEqual([
      `add essay ${open[0].key}`, `remove essay ${open[0].key}`,
      `move essay>toronto ${open[0].key}`, `move toronto>essay ${open[0].key}`,
      'rename essay New name', 'rename essay Old name',
      'unpack essay',
    ]);
  });
});

describe('asking', () => {
  const deps = (over = {}) => ({
    enabled: () => true,
    jobs: async () => [essay, toronto],
    look: async () => ({ items: open, front: open[0].key }),
    week: () => [],
    send: vi.fn(async () => ({ text: JSON.stringify({ answer: 'You were comparing hotels.', highlights: [], refs: ['f1'], action: { type: 'none', folder: '', item: '', to: '', name: '' } }), left: 4 })),
    savedLabel: () => 'saved',
    ...over,
  });

  it('answers, and says how many questions are left', async () => {
    const a = await askStashd('What was I doing on the Toronto trip?', deps());
    expect(a).toMatchObject({ answer: 'You were comparing hotels.', left: 4, refs: [{ kind: 'folder', name: 'Toronto trip' }] });
  });

  it('says so when Stashd AI is off, or today’s limit is used, without sending anything', async () => {
    const d = deps({ enabled: () => false });
    expect(await askStashd('hi', d)).toMatchObject({ problem: 'off' });
    expect(d.send).not.toHaveBeenCalled();
    const limited = deps({ send: async () => { throw Object.assign(new Error('used up'), { code: 'limit' }); } });
    expect(await askStashd('hi', limited)).toMatchObject({ problem: 'limit' });
  });
});
