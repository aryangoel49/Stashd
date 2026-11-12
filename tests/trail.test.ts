// The activity trail (src/main/trail.ts): minutes in front for a save's own things, from the looks at your desk.

import { describe, expect, it } from 'vitest';
import type { Item, SaveEntry } from '../src/shared/types';
import { addLook, trailOf, TRAIL_MS, type Look } from '../src/main/trail';
import { looseKey } from '../src/main/urls';
import { buildPromptData } from '../src/main/brief/prompt';
import { basicBrief } from '../src/main/brief/basic';

const tab = (url: string, label: string): Item => ({ key: `tab:${url}`, kind: 'tab', label, detail: '', app: 'Google Chrome', url, browser: 'chrome', window: 1 });
const essay = tab('https://docs.google.com/document/d/abc', 'Climate essay - Google Docs');
const source = tab('https://en.wikipedia.org/wiki/Sea_level_rise', 'Sea level rise - Wikipedia');
const game = tab('https://www.espn.com/nba/scoreboard', 'NBA Scores - ESPN');
const MIN = 60_000;
/** One look every 20 s on `item`, from `from` minutes ago for `minutes` minutes. */
const on = (item: Item, from: number, minutes: number, now: number): Look[] =>
  Array.from({ length: minutes * 3 }, (_, n) => ({ loose: looseKey(item), at: now - from * MIN + n * 20_000 }));

describe('the trail', () => {
  const now = Date.parse('2026-11-12T15:00:00Z');
  it('minutes in front for the things in the save, most recent first; other things are ignored', () => {
    const looks = [...on(essay, 60, 25, now), ...on(game, 35, 10, now), ...on(source, 25, 5, now), ...on(essay, 20, 20, now)];
    expect(trailOf(looks, [source, essay], now)).toEqual([
      { key: essay.key, minutes: 45, minutesAgo: 0 },
      { key: source.key, minutes: 5, minutesAgo: 20 },
    ]);
  });
  it('a long gap between looks (asleep, away) counts for a couple of minutes at most, and old looks fall away', () => {
    const looks: Look[] = [{ loose: looseKey(essay), at: now - 90 * MIN }];
    expect(trailOf(looks, [essay], now)[0].minutes).toBeLessThanOrEqual(3);
    expect(addLook([{ loose: 'x', at: now - TRAIL_MS - 1 }], 'y', now)).toEqual([{ loose: 'y', at: now }]);
    expect(trailOf([{ loose: looseKey(essay), at: now - TRAIL_MS - MIN }], [essay], now)).toEqual([]);
  });
  it('a glance of a few seconds is not on the trail', () => {
    expect(trailOf([{ loose: looseKey(source), at: now - 10_000 }], [source], now)).toEqual([]);
  });
});

describe('the trail in a brief', () => {
  const entry = { version: 2, id: 'e', jobId: 'j', savedAt: '2026-11-12T15:00:00Z', note: '', items: [essay, source], frontKey: essay.key, appOrder: ['Google Chrome'], tidied: false, errors: [], trail: [{ key: essay.key, minutes: 45, minutesAgo: 0 }] } as SaveEntry;
  it('Claude gets the minutes (nothing else new)', () => {
    const items = buildPromptData(entry, null, null).payload.items as Record<string, unknown>[];
    expect(items[0]).toMatchObject({ minutesInFront: 45, lastInFrontMinutesAgo: 0 });
    expect(items[1].minutesInFront).toBeUndefined();
  });
  it('without AI, the brief says how long you were on the last thing', () => {
    expect(basicBrief(entry).sections?.lastOn).toContain('for about 45 minutes');
    expect(basicBrief({ ...entry, trail: undefined }).sections?.lastOn).not.toContain('for about');
  });
});
