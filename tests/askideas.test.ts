import { describe, expect, it } from 'vitest';
import { pickIdeas } from '../src/renderer/askIdeas';
import type { JobSummary } from '../src/shared/types';

const job = (name: string): JobSummary => ({ name, done: false }) as JobSummary;
const mentions = (q: string, names: string[]) => names.filter((n) => q.includes(n));

describe('Ask Stashd question ideas', () => {
  it('spreads folder questions across all your folders, once each', () => {
    const names = ['Thesis', 'Taxes', 'Trip to Lisbon', 'Portfolio'];
    const ideas = pickIdeas(names.map(job), 10);
    const used = ideas.flatMap((i) => mentions(i.q, names));
    expect(new Set(used).size).toBe(used.length);
    expect(used.length).toBeGreaterThanOrEqual(3);
  });

  it('never shows the same folder in two questions in a row', () => {
    const ideas = pickIdeas([job('Thesis')], 10);
    const flags = ideas.map((i) => i.q.includes('Thesis'));
    expect(flags.filter(Boolean).length).toBeLessThanOrEqual(2);
    flags.forEach((f, i) => expect(f && flags[i + 1]).toBeFalsy());
  });

  it('the newest folder isn’t always the one named first', () => {
    const names = ['Newest', 'Older', 'Oldest'];
    const firsts = new Set([0.1, 0.5, 0.9].map((r) => {
      const ideas = pickIdeas(names.map(job), 10, () => r);
      return names.find((n) => ideas.some((i) => i.q.includes(n)) && ideas.find((i) => mentions(i.q, names).length)!.q.includes(n));
    }));
    expect(firsts.size).toBeGreaterThan(1);
  });

  it('with no folders, only general questions', () => {
    const ideas = pickIdeas([], 10);
    expect(ideas.length).toBe(10);
    ideas.forEach((i) => expect(i.q).not.toMatch(/\{[ab]\}/));
  });
});
