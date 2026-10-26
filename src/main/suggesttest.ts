// Development only (WWI_SUGGEST_TEST=<log file>): runs Suggestions end to end on a test copy's folders —
// accept a merge, undo it, accept a move, undo it, Not now and Never — checking the saved folders after
// each step, and logs PASS / FAIL lines.

import { appendFileSync, writeFileSync } from 'node:fs';
import { app } from 'electron';
import type { Core } from './core';

export async function runSuggestTest(core: Core, logFile: string): Promise<void> {
  writeFileSync(logFile, '');
  const log = (step: string, data: unknown = null) => appendFileSync(logFile, `${JSON.stringify({ step, data })}\n`);
  const check = (name: string, ok: boolean, detail?: unknown) => log(`${ok ? 'PASS' : 'FAIL'} ${name}`, detail ?? null);
  const items = async (id: string) => ((await core.store.latest(id))?.items ?? []).map((i) => i.key);
  const done = async (id: string) => (await core.store.get(id)).done;
  const fresh = async () => {
    core.notify();
    return core.suggestions();
  };
  try {
    const first = await fresh();
    log('suggestions', first.map((s) => `${s.kind}: ${s.kind === 'merge' ? `${s.fromName} → ${s.intoName}` : `${s.itemLabel} → ${s.toName}`}`));

    // ---------- merge, then undo ----------
    const m = first.find((s) => s.kind === 'merge');
    check('a merge is suggested', !!m);
    if (m && m.kind === 'merge') {
      const intoBefore = await items(m.into);
      const fromItems = await items(m.from);
      await core.acceptSuggestion(m.id);
      const intoAfter = await items(m.into);
      check('merge: every item of the merged folder is now in the target', fromItems.every((k) => intoAfter.includes(k)), { before: intoBefore.length, after: intoAfter.length });
      check('merge: no item appears twice', new Set(intoAfter).size === intoAfter.length);
      check('merge: the merged folder moved to Finished', await done(m.from));
      check('merge: the suggestion is gone', !(await fresh()).some((s) => s.id === m.id));
      await core.undoSuggestion();
      check('undo merge: target back to its own items', JSON.stringify(await items(m.into)) === JSON.stringify(intoBefore), (await items(m.into)).length);
      check('undo merge: the merged folder is back (not Finished)', !(await done(m.from)));
    }

    // ---------- move, then undo ----------
    const mv = (await fresh()).find((s) => s.kind === 'move');
    check('a move is suggested', !!mv);
    if (mv && mv.kind === 'move') {
      await core.acceptSuggestion(mv.id);
      check('move: item left its old folder', !(await items(mv.from)).includes(mv.itemKey));
      check('move: item is in the new folder', (await items(mv.to)).includes(mv.itemKey));
      await core.undoSuggestion();
      check('undo move: item is back in its old folder', (await items(mv.from)).includes(mv.itemKey));
      check('undo move: item is out of the new folder', !(await items(mv.to)).includes(mv.itemKey));
      const again = (await fresh()).find((s) => s.id === mv.id);
      check('after undo, the same move is not offered again straight away', !again);
    }

    // ---------- Not now and Never ----------
    // Undo hid both suggestions for a week (as it should); clear that so there is something to dismiss.
    (core as unknown as { state: { dismissed: Record<string, string> } }).state.dismissed = {};
    const list = await fresh();
    const [a, b] = list;
    check('something is left to dismiss', !!a);
    if (a) {
      await core.dismissSuggestion(a.id, true);
      check('Never hides it', !(await fresh()).some((s) => s.id === a.id));
    }
    if (b) {
      await core.dismissSuggestion(b.id, false);
      check('Not now hides it', !(await fresh()).some((s) => s.id === b.id));
    }
    check('undo with nothing to undo is harmless', await core.undoSuggestion().then(() => true, () => false));
    log('done');
  } catch (e) {
    log('failed', e instanceof Error ? `${e.message}\n${e.stack}` : String(e));
  } finally {
    setTimeout(() => app.quit(), 1000);
  }
}
