// Development only (WWI_SCENARIOS=<log file>, WWI_SCENARIO_FILES=<folder of test documents>):
// real-world checks across apps. Opens test tabs in Chrome and Safari and test documents in Excel,
// Word, TextEdit and Preview, then checks what Stashd captures, how it sorts new things into folders,
// and that Pack up / Unpack close and reopen exactly those things. Only the test tabs and documents
// opened here are ever closed. Everyday apps (Slack) must be left alone.

import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { Item, SavePreview } from '../shared/types';
import type { Core } from './core';
import { run } from './exec';
import type { TidyFlow } from './tidyflow';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const W = 'https://en.wikipedia.org/wiki/';

const TABS = {
  seaLevel: { app: 'Google Chrome', url: `${W}Sea_level_rise` },
  flooding: { app: 'Google Chrome', url: `${W}Coastal_flooding` },
  nasa: { app: 'Safari', url: 'https://sealevel.nasa.gov/' },
  stormSurge: { app: 'Google Chrome', url: `${W}Storm_surge` },
  capybara: { app: 'Google Chrome', url: `${W}Capybara` },
  seaLevelSafari: { app: 'Safari', url: `${W}Sea_level` },
};

export async function runScenarios(core: Core, tidy: TidyFlow, logFile: string, filesDir: string): Promise<void> {
  writeFileSync(logFile, '');
  const log = (step: string, data: unknown) => appendFileSync(logFile, `${JSON.stringify({ step, data })}\n`);
  const check = (name: string, ok: boolean, detail?: unknown) => log(ok ? `PASS ${name}` : `FAIL ${name}`, detail ?? null);

  const DOCS = {
    excel: { app: 'Microsoft Excel', file: path.join(filesDir, 'Sea level data.csv') },
    word: { app: 'Microsoft Word', file: path.join(filesDir, 'Sea level essay.docx') },
    textedit: { app: 'TextEdit', file: path.join(filesDir, 'Sea level reading list.txt') },
    preview: { app: 'Preview', file: path.join(filesDir, 'Coastal flood map.pdf') },
  };
  const testUrls = new Set(Object.values(TABS).map((t) => t.url));
  const testFiles = new Set(Object.values(DOCS).map((d) => d.file));
  const testNames = new Set([...testFiles].map((f) => path.basename(f)));
  // Documents by file name: Excel reports /tmp/… where others say /private/tmp/… (the same folder).
  const isTest = (i: Item) => (i.kind === 'tab' && testUrls.has(i.url ?? '')) || (i.kind === 'doc' && testNames.has(i.label));
  const label = (i: Item) => `${i.app.replace('Microsoft ', '')}: ${i.label}`;

  const open = async (appName: string, target: string) => {
    await run('open', ['-a', appName, target], { timeoutMs: 20_000 });
    await wait(1200);
  };
  const preview = async (opts: { asNew?: boolean; jobId?: string } = {}): Promise<SavePreview> => {
    const p = await core.preview(opts);
    core.cancelSave();
    return p;
  };
  /** Like preview, but keeps the save open so it can be committed straight after. */
  const previewToSave = (opts: { asNew?: boolean; jobId?: string } = {}) => core.preview(opts);
  const everything = (p: SavePreview) => [...p.sure, ...p.likely, ...p.maybe, ...p.kept];
  const where = (p: SavePreview, url: string) =>
    p.sure.some((i) => i.url === url) ? 'ticked' : p.likely.some((i) => i.url === url) ? 'might belong' : p.maybe.some((i) => i.url === url) ? 'left out' : 'not seen';
  const openTestThings = async () => {
    const p = await preview({ asNew: true });
    return everything(p).filter((i) => !i.notOpen && isTest(i)).map(label);
  };
  const slackRunning = async () => (await run('pgrep', ['-x', 'Slack']).then((r) => r.stdout.trim() !== '', () => false));

  try {
    const slackWasRunning = await slackRunning();

    // ---------- 1. A new folder from Chrome, Safari, Excel, Word, TextEdit and Preview ----------
    await run('open', ['-g', '-a', 'Slack']).catch(() => undefined);
    for (const d of Object.values(DOCS)) await open(d.app, d.file);
    await open(TABS.nasa.app, TABS.nasa.url);
    await open(TABS.flooding.app, TABS.flooding.url);
    await open(TABS.seaLevel.app, TABS.seaLevel.url); // last, so it's what you were on
    await wait(2500);

    const p1 = await previewToSave({ asNew: true });
    const seen = everything(p1).filter(isTest).map(label);
    log('1 new folder: captured', {
      suggestedName: p1.suggestedName,
      ticked: p1.sure.map(label),
      mightBelong: p1.likely.map(label),
      leftOut: p1.maybe.map(label),
      everydayHidden: p1.hiddenCount,
      errors: p1.errors.map((e) => e.message),
    });
    check('Chrome tabs captured', [TABS.seaLevel, TABS.flooding].every((t) => everything(p1).some((i) => i.url === t.url)));
    check('Safari tab captured', everything(p1).some((i) => i.url === TABS.nasa.url));
    log('1 document paths reported by apps', everything(p1).filter((i) => i.kind === 'doc' && testNames.has(i.label)).map((i) => ({ app: i.app, path: i.path ?? null, url: i.url ?? null })));
    for (const [k, d] of Object.entries(DOCS)) {
      const found = everything(p1).find((i) => i.kind === 'doc' && i.label === path.basename(d.file));
      check(`${d.app} document captured (${k})`, !!found, seen);
      check(`${d.app} document has its file path (${k})`, !!found?.path && found.path.replace(/^\/private/, '') === d.file.replace(/^\/private/, ''), found?.path ?? null);
    }
    check('Slack treated as everyday (not offered)', !everything(p1).some((i) => i.app === 'Slack'));
    check('Sea-level tabs ticked together', [TABS.seaLevel, TABS.flooding].every((t) => p1.sure.some((i) => i.url === t.url)), p1.sure.map(label));

    // Only this step's things go in (a leftover test tab from an earlier run must not sneak in).
    const step1Urls = new Set([TABS.seaLevel.url, TABS.flooding.url, TABS.nasa.url]);
    const keys1 = everything(p1).filter((i) => isTest(i) && (i.kind === 'doc' || step1Urls.has(i.url ?? ''))).map((i) => i.key);
    const saved = await core.commitSave({ jobId: null, name: p1.suggestedName, note: 'Scenario test', keys: keys1, tidy: true });
    await tidy.run(saved.jobId, saved.entryId);
    await wait(3500);
    const keys1Set = new Set(keys1);
    const afterPack = (await preview({ asNew: true }).then((p) => everything(p).filter((i) => !i.notOpen && keys1Set.has(i.key)).map(label)));
    log('1 after Pack up: still open', afterPack);
    check('Pack up closed every test tab and document', afterPack.length === 0, afterPack);
    check('Slack still running after Pack up', await slackRunning());

    // ---------- 2. Unpack brings them all back ----------
    const unpacked = await core.open(saved.jobId, undefined, 'all');
    await wait(5000);
    const afterUnpack = await openTestThings();
    log('2 Unpack', { result: unpacked, open: afterUnpack });
    check('Unpack reopened everything', unpacked.failed.length === 0 && unpacked.missing.length === 0 && afterUnpack.length >= keys1.length, afterUnpack);

    // ---------- 3. Adding to the open folder: related joins, unrelated stays out ----------
    await open(TABS.capybara.app, TABS.capybara.url);
    await open(TABS.stormSurge.app, TABS.stormSurge.url);
    await wait(2000);
    const p3 = await preview();
    log('3 adding to the open folder', {
      savingTo: p3.jobName,
      stormSurge: where(p3, TABS.stormSurge.url),
      capybara: where(p3, TABS.capybara.url),
      why: { stormSurge: p3.why[`tab:${TABS.stormSurge.url}`], capybara: p3.why[`tab:${TABS.capybara.url}`] },
    });
    check('Saves into the open folder', p3.jobId === saved.jobId, p3.jobName);
    check('Related "Storm surge" tab is ticked or suggested', ['ticked', 'might belong'].includes(where(p3, TABS.stormSurge.url)), where(p3, TABS.stormSurge.url));
    check('Unrelated "Capybara" tab is not ticked', where(p3, TABS.capybara.url) !== 'ticked', where(p3, TABS.capybara.url));
    check('Things already in the folder stay ticked', [TABS.seaLevel, TABS.flooding, TABS.nasa].every((t) => p3.sure.some((i) => i.url === t.url) || p3.kept.some((i) => i.url === t.url)));

    // ---------- 4. A second folder, then routing new things to the right one ----------
    await open(TABS.capybara.app, TABS.capybara.url); // bring it to the front
    await wait(1500);
    const p4a = await previewToSave({ asNew: true });
    const capy = await core.commitSave({ jobId: null, name: 'Capybaras', note: '', keys: everything(p4a).filter((i) => i.url === TABS.capybara.url).map((i) => i.key), tidy: false });
    await open(TABS.seaLevelSafari.app, TABS.seaLevelSafari.url);
    await wait(2000);
    const p4 = await preview();
    log('4 routing', { suggested: p4.jobName, options: p4.jobOptions.map((o) => `${o.name}: ${o.match}${o.current ? ' (open now)' : ''}`) });
    check('A sea-level tab is matched to the sea-level folder, not the open Capybaras folder', p4.jobOptions.find((o) => o.id === saved.jobId)?.match === 'strong', p4.jobOptions);
    void capy;

    // ---------- clean up: close every test tab and document ----------
    const p5 = await previewToSave({ asNew: true });
    const cleanup = await core.commitSave({ jobId: null, name: 'Cleanup', note: '', keys: everything(p5).filter(isTest).map((i) => i.key), tidy: true });
    await tidy.run(cleanup.jobId, cleanup.entryId);
    await wait(3500);
    if (!slackWasRunning) await run('osascript', ['-e', 'tell application "Slack" to quit']).catch(() => undefined);
    log('cleanup: still open', await openTestThings());
    log('done', 'ok');
  } catch (e) {
    log('failed', e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    setTimeout(() => app.quit(), 1500);
  }
}
