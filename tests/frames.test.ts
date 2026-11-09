// Window places (src/main/frames.ts): matching saved things to their windows, and fitting a saved place
// onto the screens there are now.

import { describe, expect, it } from 'vitest';
import { attachFrames, boundsToFrame, fitFrame, frameToBounds, titleHint } from '../src/main/frames';
import { parseTabOutput } from '../src/main/collectors/browsers';
import type { Item } from '../src/shared/types';

const main = { x: 0, y: 25, w: 1440, h: 875 };
const right = { x: 1440, y: 0, w: 1920, h: 1080 };

describe('fitting a saved place onto today’s screens', () => {
  it('leaves a window that still fits where it was', () => {
    expect(fitFrame({ x: 100, y: 60, w: 800, h: 600 }, [main, right])).toEqual({ x: 100, y: 60, w: 800, h: 600 });
    expect(fitFrame({ x: 1600, y: 100, w: 900, h: 700 }, [main, right])).toEqual({ x: 1600, y: 100, w: 900, h: 700 });
  });

  it('moves a window from a screen that’s gone to the middle of the main one', () => {
    expect(fitFrame({ x: 1600, y: 100, w: 900, h: 700 }, [main])).toEqual({ x: 270, y: 113, w: 900, h: 700 });
  });

  it('shrinks a window bigger than the screen and pulls one hanging off it back on', () => {
    expect(fitFrame({ x: 0, y: 0, w: 1920, h: 1080 }, [main])).toEqual({ x: 0, y: 25, w: 1440, h: 875 });
    expect(fitFrame({ x: 1000, y: 500, w: 800, h: 600 }, [main])).toEqual({ x: 640, y: 300, w: 800, h: 600 });
  });

  it('keeps full screen, and changes nothing when it can’t see the screens', () => {
    expect(fitFrame({ x: 0, y: 0, w: 1440, h: 900, full: true }, [main]).full).toBe(true);
    expect(fitFrame({ x: 5000, y: 0, w: 10, h: 10 }, [])).toEqual({ x: 5000, y: 0, w: 10, h: 10 });
  });
});

describe('browser window places', () => {
  it('reads "left,top,right,bottom" and skips nonsense', () => {
    expect(boundsToFrame('10,40,810,640')).toEqual({ x: 10, y: 40, w: 800, h: 600 });
    expect(frameToBounds({ x: 10, y: 40, w: 800, h: 600 })).toBe('10,40,810,640');
    expect(boundsToFrame('')).toBeUndefined();
    expect(boundsToFrame('0,0,20,20')).toBeUndefined();
    expect(boundsToFrame('a,b,c,d')).toBeUndefined();
  });

  it('puts each tab’s window place on it', () => {
    const US = '\x1f';
    const RS = '\x1e';
    const tabs = parseTabOutput('chrome', `1${US}true${US}https://a.io/${US}A${US}0,25,700,900${RS}2${US}true${US}https://b.io/${US}B${US}${RS}`);
    expect(tabs[0].frame).toEqual({ x: 0, y: 25, w: 700, h: 875 });
    expect(tabs[1].frame).toBeUndefined();
  });
});

describe('matching things to their windows', () => {
  const doc = (label: string, app: string): Item => ({ key: `doc:/x/${label}`, kind: 'doc', label, detail: '', app, path: `/x/${label}` });
  const appItem = (app: string): Item => ({ key: `app:${app}`, kind: 'app', label: app, detail: 'App', app });

  it('finds each document’s window by its title, and gives an app its front window', () => {
    const items = [doc('Q3 budget.xlsx', 'Microsoft Excel'), doc('Plan.xlsx', 'Microsoft Excel'), appItem('Notion')];
    attachFrames(items, {
      'Microsoft Excel': [
        { title: 'Plan', x: 0, y: 30, w: 900, h: 700 },
        { title: 'Q3 budget.xlsx', x: 500, y: 30, w: 900, h: 700 },
      ],
      Notion: [
        { title: 'Roadmap', x: 10, y: 40, w: 1200, h: 800, full: true },
        { title: 'Other', x: 0, y: 0, w: 600, h: 600 },
      ],
    });
    expect(items[0].frame).toEqual({ x: 500, y: 30, w: 900, h: 700 });
    expect(items[1].frame).toEqual({ x: 0, y: 30, w: 900, h: 700 });
    expect(items[2].frame).toEqual({ x: 10, y: 40, w: 1200, h: 800, full: true });
  });

  it('leaves things without a window alone, and ignores tiny windows', () => {
    const items = [doc('Gone.docx', 'Microsoft Word'), appItem('Slack')];
    attachFrames(items, { Slack: [{ title: '', x: 0, y: 0, w: 40, h: 40 }] });
    expect(items[0].frame).toBeUndefined();
    expect(items[1].frame).toBeUndefined();
  });

  it('uses a document’s name without its extension as the title to look for', () => {
    expect(titleHint(doc('Report.final.docx', 'Microsoft Word'))).toBe('report.final');
    expect(titleHint(appItem('Notion'))).toBeNull();
  });
});
