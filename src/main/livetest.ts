// Development only (WWI_LIVE_TEST=<log file>): runs Stash → Pack up → Unpack against the real
// browser, on test tabs only (example.com, example.org, example.net), and writes what happened
// at each step to the log file. Nothing but those test tabs is ever closed.

import { appendFileSync, writeFileSync } from 'node:fs';
import { app } from 'electron';
import type { Core } from './core';
import { collectTabs } from './collectors/browsers';
import type { TidyFlow } from './tidyflow';

const TEST = /^https?:\/\/(www\.)?example\.(com|org|net)\//;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runLiveTest(core: Core, tidy: TidyFlow, logFile: string): Promise<void> {
  writeFileSync(logFile, '');
  const log = (step: string, data: unknown) => appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), step, data })}\n`);
  const testTabs = async () => {
    const s = core.settings.get();
    const { tabs, errors } = await collectTabs(['chrome'], { keepQueryStrings: s.keepQueryStrings, excludedDomains: s.excludedDomains });
    return { open: tabs.filter((t) => TEST.test(t.url)).map((t) => t.url), errors: errors.map((e) => e.message) };
  };
  try {
    log('1 before', await testTabs());

    // Stash: the real capture and Stashd's own choice of what belongs.
    const p = await core.preview({ asNew: true });
    const all = [...p.sure, ...p.likely, ...p.maybe];
    log('2 stash preview', {
      suggestedName: p.suggestedName,
      tickedByStashd: p.sure.map((i) => `${i.kind}: ${i.label}`),
      mightBelong: p.likely.map((i) => `${i.kind}: ${i.label}`),
      leftOut: p.maybe.length,
      everydayHidden: p.hiddenCount,
      errors: p.errors.map((e) => e.message),
    });
    const keys = all.filter((i) => i.kind === 'tab' && TEST.test(i.url ?? '')).map((i) => i.key);
    if (!keys.length) throw new Error('No test tabs were captured');

    // Pack up: save as a new folder and close those tabs (with the fly-in and toast).
    const saved = await core.commitSave({ jobId: null, name: p.suggestedName || 'Live test', note: 'Made by the live test', keys, tidy: true });
    log('3 saved', { jobId: saved.jobId, items: keys.length });
    await tidy.run(saved.jobId, saved.entryId);
    await wait(2500); // past the 2-second Undo
    log('4 after Pack up', { ...(await testTabs()), openState: (await core.openState())[saved.jobId] });

    // Unpack: reopen everything in the folder (with the fly-out).
    const result = await core.open(saved.jobId, undefined, 'all', (items) => tidy.unpackAnimation(items));
    await wait(2500);
    log('5 Unpack result', result);
    log('6 after Unpack', { ...(await testTabs()), openState: (await core.openState())[saved.jobId] });
    log('done', 'ok');
  } catch (e) {
    log('failed', e instanceof Error ? e.message : String(e));
  } finally {
    setTimeout(() => app.quit(), 1500);
  }
}
