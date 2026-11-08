// Learning which unknown sites are for breaks (src/main/sites.ts): the Mac's own model first, Stashd AI
// only for the sites it can't tell. The model checks use the real model (skipped if `npm run embedder` hasn't run).

import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '.' }, utilityProcess: {} }));
import { isBreakItem, setLearnedBreakSites } from '../src/main/breaks';
import { kindFromTitles, SiteSorter } from '../src/main/sites';
import { WordPiece } from '../src/main/meaning/tokenizer';
import type { Meaning } from '../src/main/meaning';
import { tab } from './meaning-fixtures';

const ready = existsSync(`embedder/node_modules/onnxruntime-node/bin/napi-v6/darwin/${process.arch}`) && existsSync('embedder/model/model.onnx');
const dir = () => mkdtempSync(path.join(tmpdir(), 'stashd-sites-'));

function realMeaning(): Meaning {
  const { load, embed } = createRequire(import.meta.url)('../embedder/embed.cjs');
  const session = load('embedder/model');
  const wp = new WordPiece(readFileSync('embedder/model/vocab.txt', 'utf8'));
  return {
    warm() {},
    async vectors(texts) {
      const vs: number[][] = await embed(await session, texts.map((t) => wp.encode(t)));
      return new Map(texts.map((t, i) => [t, vs[i]]));
    },
  };
}

const flex = tab('https://1flex.org/', '1Flex - Stream Movies, TV Shows, Live TV & Games');
const sflix = tab('https://sflix.to/watch/the-bear', 'The Bear Season 3 Episode 2');
const vercel = tab('https://vercel.com/me/stashd', 'stashd - Overview – Vercel');
const docs = tab('https://docs.google.com/document/d/1', 'Q3 plan - Google Docs');
const medium = tab('https://medium.com/@a/postgres', 'How to scale Postgres');

describe('what titles say about a site', () => {
  it('a break title makes a break site, a work title a work site, both make it mixed', () => {
    expect(kindFromTitles([{ lean: 0.3 }])).toBe('break');
    expect(kindFromTitles([{ lean: -0.2 }])).toBe('work');
    expect(kindFromTitles([{ lean: 0.3 }, { lean: -0.2 }])).toBe('mixed');
    expect(kindFromTitles([{ lean: 0.02 }])).toBeUndefined();
  });
});

describe.skipIf(!ready)('with the meaning model', () => {
  it('learns that a streaming site it never heard of is for breaks, and keeps work sites as work', async () => {
    setLearnedBreakSites([]);
    expect(isBreakItem(flex)).toBe(false);
    const sites = new SiteSorter(dir(), { meaning: realMeaning, ai: () => null });
    await sites.look([flex, sflix, vercel, docs]);
    expect(isBreakItem(flex)).toBe(true);
    expect(isBreakItem(vercel)).toBe(false);
    expect(isBreakItem(docs)).toBe(false);
    expect(await sites.kindOf('docs.google.com')).toBe('work');
  });

  it('remembers what it learned after a restart, and Forget my history clears it', async () => {
    const d = dir();
    await new SiteSorter(d, { meaning: realMeaning, ai: () => null }).look([flex]);
    setLearnedBreakSites([]);
    const again = new SiteSorter(d, { meaning: () => undefined, ai: () => null });
    await again.start();
    expect(isBreakItem(flex)).toBe(true);
    await again.forget();
    expect(isBreakItem(flex)).toBe(false);
    expect(existsSync(path.join(d, 'sites.json'))).toBe(false);
  });

  it('gives Stashd AI the last word, unclear sites first, and trusts only answers about the sites it asked about', async () => {
    setLearnedBreakSites([]);
    const sent: string[] = [];
    const ai = vi.fn(async (content: string) => {
      sent.push(content);
      return JSON.stringify({ sites: [{ site: 'medium.com', kind: 'mixed' }, { site: '1flex.org', kind: 'break' }, { site: 'vercel.com', kind: 'work' }, { site: 'evil.example', kind: 'break' }] });
    });
    let now = Date.parse('2026-11-07T12:00:00Z');
    const sites = new SiteSorter(dir(), { meaning: realMeaning, ai: () => ai, now: () => now });
    await sites.look([medium, vercel, flex]);
    await vi.waitFor(() => expect(ai).toHaveBeenCalledTimes(1));
    const asked = JSON.parse(sent[0]).sites.map((s: { site: string }) => s.site);
    expect(asked[0]).toBe('medium.com');
    expect(asked.sort()).toEqual(['1flex.org', 'medium.com', 'vercel.com']);
    await vi.waitFor(async () => expect(await sites.kindOf('medium.com')).toBe('mixed'));
    expect(await sites.kindOf('evil.example')).toBeUndefined();
    expect(isBreakItem(flex)).toBe(true);
    now += 2 * 60 * 60_000;
    await sites.look([medium, vercel, flex]);
    expect(ai).toHaveBeenCalledTimes(1);
  });

  it('without the model (older Macs) it still learns, through Stashd AI', async () => {
    setLearnedBreakSites([]);
    const ai = vi.fn(async () => JSON.stringify({ sites: [{ site: '1flex.org', kind: 'break' }] }));
    const sites = new SiteSorter(dir(), { meaning: () => undefined, ai: () => ai });
    await sites.look([flex]);
    await vi.waitFor(() => expect(isBreakItem(flex)).toBe(true));
  });
});

describe('the built-in list', () => {
  it('leaves the work parts of break sites with your work', () => {
    expect(isBreakItem(tab('https://studio.youtube.com/channel/1', 'Channel content - YouTube Studio'))).toBe(false);
    expect(isBreakItem(tab('https://dev.twitch.tv/console', 'Twitch Developers Console'))).toBe(false);
    expect(isBreakItem(tab('https://www.twitch.tv/somestreamer', 'somestreamer - Twitch'))).toBe(true);
  });
});
