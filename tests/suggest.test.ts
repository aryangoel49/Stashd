import { describe, expect, it } from 'vitest';
import { mergeId, suggest, type FolderData } from '../src/main/jobs/suggest';
import type { Item } from '../src/shared/types';

const tab = (url: string, label: string): Item => ({ key: `tab:${url}`, kind: 'tab', label, detail: '', app: 'Google Chrome', url, browser: 'chrome', window: 1 });
const doc = (p: string, app = 'Microsoft Word'): Item => ({ key: `doc:${p}`, kind: 'doc', label: p.split('/').pop()!, detail: '', app, path: p });

const toronto: FolderData = {
  id: 'toronto-trip',
  name: 'Toronto trip',
  note: '',
  items: [
    tab('https://www.expedia.ca/Flights-Toronto', 'Cheap flights to Toronto | Expedia'),
    tab('https://www.airbnb.ca/s/Toronto', 'Stays in Toronto · Airbnb'),
    tab('https://www.tripadvisor.ca/Attractions-Toronto', 'Things to do in Toronto · Tripadvisor'),
    doc('/Users/a/Documents/Toronto itinerary.pages', 'Pages'),
  ],
};
const torontoFlights: FolderData = {
  id: 'toronto-flights',
  name: 'Toronto flights',
  note: '',
  items: [
    tab('https://www.expedia.ca/Flights-Toronto', 'Cheap flights to Toronto | Expedia'),
    tab('https://www.aircanada.com/toronto', 'Flights to Toronto | Air Canada'),
  ],
};
const climate: FolderData = {
  id: 'climate-essay',
  name: 'Climate essay',
  note: 'paragraph 3 on sea level rise',
  items: [
    doc('/Users/a/Documents/School/Climate essay.docx'),
    tab('https://www.jstor.org/stable/1', 'Sea level rise in coastal cities | JSTOR'),
    tab('https://scholar.google.com/x', 'Coastal flooding and sea level projections - Google Scholar'),
    tab('https://en.wikipedia.org/wiki/Sea_level_rise', 'Sea level rise - Wikipedia'),
  ],
};
const resume: FolderData = {
  id: 'resume-update',
  name: 'Resume update',
  note: 'waiting on Sam',
  items: [
    doc('/Users/a/Documents/Resume 2026.docx'),
    doc('/Users/a/Documents/Cover letter.pages', 'Pages'),
    tab('https://www.linkedin.com/in/me/edit', 'Edit profile | LinkedIn'),
    tab('https://www.youtube.com/watch?v=sea', 'Why sea level rise floods coastal cities - YouTube'),
  ],
};

describe('suggestions', () => {
  it('suggests merging two folders about the same trip, smaller into bigger', () => {
    const s = suggest([toronto, torontoFlights, climate]);
    const m = s.find((x) => x.kind === 'merge');
    expect(m).toMatchObject({ kind: 'merge', from: 'toronto-flights', into: 'toronto-trip' });
    expect(m!.why.join(' ')).toMatch(/in both|toronto/i);
  });

  it('suggests moving a stray tab to the folder it belongs in', () => {
    const s = suggest([climate, resume]);
    expect(s).toContainEqual(expect.objectContaining({ kind: 'move', from: 'resume-update', to: 'climate-essay', itemKey: 'tab:https://www.youtube.com/watch?v=sea' }));
  });

  it('does not move something over one shared word', () => {
    const climateWithReport: FolderData = { ...climate, items: [...climate.items, doc('/Users/a/Downloads/IPCC AR6 summary.pdf', 'Preview')] };
    const resumeNote: FolderData = { ...resume, note: 'waiting on Sam to review the new summary', items: resume.items.slice(0, 3) };
    expect(suggest([climateWithReport, resumeNote]).filter((s) => s.kind === 'move')).toEqual([]);
  });

  it('leaves unrelated folders alone', () => {
    const s = suggest([toronto, climate, { ...resume, items: resume.items.slice(0, 3) }]);
    expect(s).toEqual([]);
  });

  it('never repeats a suggestion that was dismissed', () => {
    const s = suggest([toronto, torontoFlights], { dismissed: new Set([mergeId('toronto-trip', 'toronto-flights')]) });
    expect(s.filter((x) => x.kind === 'merge')).toEqual([]);
  });

  it('keeps it short: at most 3', () => {
    expect(suggest([toronto, torontoFlights, climate, resume]).length).toBeLessThanOrEqual(3);
  });
});
