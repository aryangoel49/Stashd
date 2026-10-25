// The default recap: a plain-language summary built from a template. Works offline.

import type { Changes, RecapItem, Snapshot } from '../../shared/types';
import { changedLines } from '../collectors/git';
import { timeAgo } from '../../shared/time';
import { displayUrl } from '../urls';

export { timeAgo };

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Turn "?? src/a.ts" / " M src/b.ts" into "src/a.ts (new)". */
export function describeStatus(line: string): string {
  const code = line.slice(0, 2);
  const file = line.slice(3).replace(/^"|"$/g, '');
  const kind =
    code === '??' ? 'new' : code.includes('D') ? 'deleted' : code.includes('A') ? 'added' : code.includes('R') ? 'renamed' : 'edited';
  return `${file} (${kind})`;
}

function list(items: string[], max: number): string {
  const shown = items.slice(0, max);
  const more = items.length - shown.length;
  return shown.join(', ') + (more > 0 ? `, and ${more} more` : '');
}

/** Pick the things worth reopening: active tabs first, then other tabs, then recent files. */
export function recapItems(snap: Snapshot): RecapItem[] {
  const items: RecapItem[] = [];
  const seenUrls = new Set<string>();
  const tabs = [...snap.tabs].sort((a, b) => Number(b.active) - Number(a.active));
  for (const t of tabs) {
    if (seenUrls.has(t.url)) continue;
    seenUrls.add(t.url);
    items.push({
      kind: 'tab',
      key: `tab:${t.url}`,
      label: t.title || displayUrl(t.url),
      detail: displayUrl(t.url),
      target: t.url,
      browser: t.browser,
      suggested: t.active,
    });
  }
  snap.files.forEach((f, i) => {
    items.push({ kind: 'file', key: `file:${f.path}`, label: f.path.split('/').pop() ?? f.path, detail: f.path, target: f.path, suggested: i < 5 });
  });
  // Keep the suggested set within the 20-item reopen limit.
  let suggested = 0;
  for (const it of items) {
    if (it.suggested && ++suggested > 12) it.suggested = false;
  }
  return items;
}

export function localRecap(snap: Snapshot, changes: Changes, now = Date.now()): string {
  const parts: string[] = [];
  const when = timeAgo(snap.createdAt, now);
  const how = snap.auto ? `saved automatically (${snap.trigger === 'idle' ? 'you went idle' : snap.trigger === 'lock' ? 'screen locked' : 'laptop slept'})` : 'saved by you';
  const branch = snap.git ? ` on branch ${snap.git.branch}` : '';
  parts.push(`You were working in ${snap.projectName}${branch}, ${when} (${how}).`);

  if (snap.note) parts.push(`Your note: "${snap.note}"`);

  if (snap.git) {
    const dirty = changedLines(snap.git.status);
    if (dirty.length) parts.push(`Unfinished: ${plural(dirty.length, 'uncommitted change')}: ${list(dirty.map(describeStatus), 4)}.`);
    else parts.push('Everything was committed at that point.');
    if (snap.git.commits[0]) parts.push(`Last commit then: "${snap.git.commits[0].subject}".`);
    if (snap.git.stashes.length) parts.push(`You also had ${plural(snap.git.stashes.length, 'stash')} saved.`);
  } else if (snap.files.length) {
    parts.push(`Recently edited: ${list(snap.files.map((f) => f.path), 4)}.`);
  }

  const since: string[] = [];
  if (changes.branchChanged) since.push(`you switched from ${changes.branchChanged.from} to ${changes.branchChanged.to}`);
  if (changes.newCommits.length) since.push(`${plural(changes.newCommits.length, 'new commit')} (latest: "${changes.newCommits[0].subject}")`);
  if (changes.editedAfter.length) since.push(`${plural(changes.editedAfter.length, 'file')} edited (${list(changes.editedAfter.map((f) => f.path), 3)})`);
  if (changes.missingFiles.length) since.push(`${plural(changes.missingFiles.length, 'file')} no longer there (${list(changes.missingFiles, 3)})`);
  parts.push(since.length ? `Since then: ${since.join('; ')}.` : 'Nothing has changed in the folder since then.');

  const activeTabs = snap.tabs.filter((t) => t.active);
  const keyTabs = (activeTabs.length ? activeTabs : snap.tabs).slice(0, 3).map((t) => t.title || displayUrl(t.url));
  const keyFiles = snap.files.slice(0, 3).map((f) => f.path);
  if (keyTabs.length) parts.push(`Key tabs: ${keyTabs.join(', ')}.`);
  if (keyFiles.length) parts.push(`Key files: ${keyFiles.join(', ')}.`);

  let first: string;
  if (snap.note) first = `pick up your note: ${snap.note}`;
  else if (snap.git && changedLines(snap.git.status).length) first = `open ${describeStatus(changedLines(snap.git.status)[0]).replace(/ \(.*\)$/, '')} and finish that change`;
  else if (keyFiles[0]) first = `reopen ${keyFiles[0]}`;
  else if (keyTabs[0]) first = `reopen "${keyTabs[0]}"`;
  else first = 'press Save where I am next time with a note about what comes next';
  parts.push(`First step: ${first}.`);

  return parts.join('\n');
}
