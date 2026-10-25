// Real-life scenarios for "what belongs to which job". Titles are taken from actual use.

import { describe, expect, it } from 'vitest';
import { group, jobFit, jobProfile, textTokens, FIT_SUGGEST } from '../src/main/jobs/relevance';
import type { Item } from '../src/shared/types';

let n = 0;
const tab = (url: string, title: string, window = 1, active = false): Item => ({
  key: `tab:${url}`, kind: 'tab', label: title, detail: '', app: 'Google Chrome', url, browser: 'chrome', window, active,
});
const doc = (path: string, app = 'Microsoft Word'): Item => ({ key: `doc:${path}`, kind: 'doc', label: path.split('/').pop()!, detail: '', app, path });
const untitled = (name: string): Item => ({ key: `untitled:Microsoft Word:${name}`, kind: 'doc', label: name, detail: '', app: 'Microsoft Word', untitled: true });
const app = (name: string): Item => ({ key: `app:${name}`, kind: 'app', label: name, detail: 'App', app: name });
const keys = (items: Item[]) => items.map((i) => i.label);
void n;

// Soccer streams (from a screenshot)
const streamKing = tab('https://streamking.cc/', 'StreamKing - Free NBA, NFL, NHL, MLB, Soccer Streams', 1, true);
const ovo = tab('https://www.google.com/search?q=ovo+goal', 'ovo goal - Google Search');
const madrid = tab('https://totalsportek.pro/real-madrid', 'Watch Real Madrid at Barcelona Live Stream | TotalSportek');
const streamEast = tab('https://streameast.zip/', 'StreamEast.zip');
const soccerStreams = tab('https://soccerstreams.net/', 'Soccer Streams | Soccer Live Streams Reddit');
const preview = app('Preview');
const textEdit = app('TextEdit');

// AI research (from a screenshot)
const aiDoc = doc('/Users/a/Documents/ai research.docx');
const aiTab1 = tab('https://www.microsoft.com/en-us/ai/augmentation', 'AI Augmentation: The Key to Uplifting Employees | Microsoft', 2);
const aiTab2 = tab('https://www.consultancy.eu/what-is-ai-augmentation', 'What is AI Augmentation? | Consultancy.eu', 2);
const aiSearch = tab('https://www.google.com/search?q=ai+augmentation', 'ai augmentation - Google Search', 2);
const nvidia = tab('https://www.nvidia.com/en-us/lp/ai/blueprint', 'Blueprint for AI Success eBook | Download & Build | NVIDIA', 2);

// Climate essay
const essay = doc('/Users/a/Documents/School/Climate essay.docx');
const lecture = doc('/Users/a/Documents/School/lecture-7-notes.pdf', 'Preview');
const jstor1 = tab('https://www.jstor.org/stable/1', 'Sea level rise in coastal cities | JSTOR', 3);
const jstor2 = tab('https://www.jstor.org/stable/2', 'Rising seas and storm surge | JSTOR', 3);
const noaa = tab('https://www.noaa.gov/sea-level', 'Climate change: global sea level | NOAA', 3);
const dogs = tab('https://www.reddit.com/r/aww', 'Cute dogs : aww', 4);

// Toronto trip
const flights = tab('https://www.expedia.ca/flights', 'Cheap Flights to Toronto | Expedia', 5, true);
const airbnb = tab('https://www.airbnb.ca/s/toronto', 'Toronto Stays near Downtown · Airbnb', 5);
const todo = tab('https://www.google.com/search?q=things+to+do+toronto', 'things to do in toronto - Google Search', 5);

describe('tokens', () => {
  it('keeps short meaningful words like AI and splits joined words', () => {
    expect(textTokens('AI Augmentation: The Key to Uplifting Employees')).toEqual(['ai', 'augmentation', 'uplift', 'employee']);
    expect(textTokens('StreamEast.zip')).toEqual(['stream', 'east']);
    expect(textTokens('ovo goal - Google Search')).toEqual(['ovo', 'goal']);
  });
});

describe('a new job is seeded from what you were on last', () => {
  it('soccer streams: all the stream tabs, but not bare apps like Preview or TextEdit', () => {
    const g = group({ candidates: [streamKing, ovo, madrid, streamEast, soccerStreams, preview, textEdit], profile: null, frontKey: streamKing.key });
    expect(keys(g.sure).sort()).toEqual(keys([streamKing, madrid, streamEast, soccerStreams]).sort());
    // "ovo goal" shares no words with the rest, only the browser window: highlighted, one click to add.
    expect(keys(g.likely)).toEqual(['ovo goal - Google Search']);
    expect(keys(g.maybe)).toEqual(['Preview', 'TextEdit']);
  });

  it('two topics open: the one you were on is the job, the other is not', () => {
    const g = group({ candidates: [aiDoc, aiTab1, aiTab2, streamKing, madrid, soccerStreams, dogs], profile: null, frontKey: aiDoc.key });
    expect(keys(g.sure).sort()).toEqual(keys([aiDoc, aiTab1, aiTab2]).sort());
    expect(g.sure).not.toContain(streamKing);
    expect(g.sure).not.toContain(dogs);
  });

  it('toronto trip: flights, stays and things to do all belong', () => {
    const g = group({ candidates: [flights, airbnb, todo, dogs], profile: null, frontKey: flights.key });
    expect(keys(g.sure).sort()).toEqual(keys([flights, airbnb, todo]).sort());
    expect(g.sure).not.toContain(dogs);
  });

  it('when you were on an untitled document, everything except bare apps is included', () => {
    const d = untitled('Document3');
    const g = group({ candidates: [d, aiTab1, preview], profile: null, frontKey: d.key });
    expect(keys(g.sure)).toEqual(['Document3', aiTab1.label]);
    expect(keys(g.maybe)).toEqual(['Preview']);
  });
});

describe('updating an existing job', () => {
  it('ai research: the AI augmentation tabs clearly belong (they share "AI" with the job and the document)', () => {
    const profile = jobProfile('ai research', '', [aiDoc]);
    const g = group({ candidates: [aiDoc, aiTab1, aiTab2, preview, textEdit], profile, frontKey: aiDoc.key });
    expect(keys(g.sure).sort()).toEqual(keys([aiDoc, aiTab1, aiTab2]).sort());
    expect(keys(g.maybe)).toEqual(['Preview', 'TextEdit']);
  });

  it('climate essay: new sea-level sources join, soccer and dogs stay out', () => {
    const profile = jobProfile('Climate essay', 'need 2 more sea level sources', [essay, jstor1]);
    const g = group({ candidates: [essay, jstor1, jstor2, noaa, lecture, streamKing, dogs], profile, frontKey: essay.key });
    expect(keys(g.sure)).toEqual(keys([essay, jstor1, jstor2, noaa, lecture]));
    expect(keys(g.maybe).sort()).toEqual(keys([streamKing, dogs]).sort());
  });

  it("things opened since unpacking that aren't clear matches are highlighted as likely", () => {
    const profile = jobProfile('Climate essay', '', [essay, jstor1]);
    const jakarta = tab('https://www.bbc.com/news/1', 'Jakarta is sinking', 3);
    const g = group({
      candidates: [essay, jstor1, jakarta, dogs],
      profile,
      frontKey: essay.key,
      baseline: new Set([essay.key, jstor1.key, dogs.key]),
    });
    expect(keys(g.likely)).toEqual(['Jakarta is sinking']);
    expect(keys(g.maybe)).toEqual(['Cute dogs : aww']);
  });
});

describe('which job does this belong to', () => {
  const jobs = {
    ai: jobProfile('ai research', '', [aiDoc]),
    soccer: jobProfile('Soccer Streams', '', [streamKing, soccerStreams]),
    climate: jobProfile('Climate essay', '', [essay, jstor1]),
    toronto: jobProfile('Toronto trip', '', [flights]),
  };
  const best = (open: Item[]) =>
    Object.entries(jobs)
      .map(([k, p]) => [k, jobFit(open, p)] as const)
      .sort((a, b) => b[1] - a[1])[0];

  it('AI augmentation tabs fit "ai research"', () => {
    const [k, fit] = best([aiTab1, aiTab2, aiSearch, nvidia]);
    expect(k).toBe('ai');
    expect(fit).toBeGreaterThanOrEqual(FIT_SUGGEST);
  });

  it('stream tabs fit "Soccer Streams"', () => {
    expect(best([madrid, streamEast, ovo])[0]).toBe('soccer');
  });

  it('sea-level sources fit "Climate essay"', () => {
    expect(best([jstor2, noaa])[0]).toBe('climate');
  });

  it('unrelated things fit nothing well enough to suggest', () => {
    const [, fit] = best([dogs, preview, textEdit]);
    expect(fit).toBeLessThan(FIT_SUGGEST);
  });
});

describe('harder cases', () => {
  const clutter = [
    tab('https://www.amazon.ca/x', 'Amazon.ca: Wireless Earbuds', 7),
    tab('https://www.netflix.com/browse', 'Netflix', 7),
    tab('https://www.instagram.com/', 'Instagram', 7),
    tab('https://www.espn.com/nba', 'NBA Scores and Standings - ESPN', 8),
    tab('https://www.weather.com/', 'Toronto Weather Forecast', 8),
    tab('https://www.linkedin.com/jobs', 'Jobs | LinkedIn', 8),
    tab('https://www.canva.com/design', 'Untitled design - Canva', 9),
    tab('https://www.uwaterloo.ca/quest', 'Quest - University of Waterloo', 9),
  ];

  it('a cluttered browser: only the AI work is ticked for a new AI job', () => {
    const g = group({ candidates: [aiTab1, aiTab2, aiSearch, nvidia, ...clutter], profile: null, frontKey: aiTab1.key });
    expect(keys(g.sure).sort()).toEqual(keys([aiTab1, aiTab2, aiSearch, nvidia]).sort());
    for (const c of clutter) expect(g.sure).not.toContain(c);
  });

  it('one shared everyday word is not enough (Toronto weather is not the Toronto trip... unless it says so)', () => {
    const profile = jobProfile('AI research', '', [aiDoc, aiTab1]);
    const g = group({ candidates: [aiDoc, aiTab1, ...clutter], profile, frontKey: aiDoc.key });
    expect(keys(g.sure)).toEqual(keys([aiDoc, aiTab1]));
    expect(g.likely).toEqual([]);
  });
});
