// Optional AI recap. This is the ONLY module in the app allowed to use the network
// (tests/privacy.test.ts fails if any other file imports http/https/net or calls fetch).
// It sends the snapshot summary and the "what changed" list, never file contents, and everything is redacted first.

import Anthropic from '@anthropic-ai/sdk';
import type { Changes, Snapshot } from '../../shared/types';
import { redactCommand, redactUrlString } from '../redact';

const SYSTEM = `You help a developer get back into a project after a break.
You get a JSON summary of a saved "snapshot" of their work (note, git state, recently edited file names, open browser tab titles and addresses) plus what changed since.
Reply in under 120 words of plain text, no markdown headings, no em dashes. Cover, in this order:
1. What they were doing (one or two sentences).
2. What is unfinished.
3. The 3 to 5 tabs or files that matter most, by name.
4. "First step:" followed by one concrete action.
Only use facts from the JSON. If something is unclear, say less rather than guessing.`;

/** Exactly what is sent. Shown to the user in the "what's sent" disclosure too. */
export function buildPayload(snap: Snapshot, changes: Changes): Record<string, unknown> {
  return {
    project: snap.projectName,
    savedAt: snap.createdAt,
    savedAutomatically: snap.auto,
    note: redactCommand(snap.note),
    git: snap.git && {
      branch: snap.git.branch,
      uncommitted: snap.git.status.filter((l) => !l.startsWith('## ')).slice(0, 40),
      diffStat: snap.git.diffStat.split('\n').slice(-15).join('\n'),
      recentCommits: snap.git.commits.map((c) => ({ hash: c.hash.slice(0, 7), subject: redactCommand(c.subject), date: c.date })),
      stashCount: snap.git.stashes.length,
    },
    recentlyEditedFiles: snap.files.map((f) => ({ path: f.path, modified: f.mtime })),
    tabs: snap.tabs.slice(0, 60).map((t) => ({ browser: t.browser, title: redactCommand(t.title), url: redactUrlString(t.url), active: t.active })),
    recentCommands: snap.shell?.map(redactCommand) ?? null,
    changedSince: {
      newCommits: changes.newCommits.slice(0, 20).map((c) => ({ hash: c.hash.slice(0, 7), subject: redactCommand(c.subject) })),
      branchChanged: changes.branchChanged,
      filesEditedAfter: changes.editedAfter.map((f) => f.path),
      missingFiles: changes.missingFiles,
      stillUncommitted: changes.stillUncommitted.slice(0, 40),
    },
  };
}

function friendlyError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was not accepted. Check it in Settings.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use that model.';
  if (e instanceof Anthropic.NotFoundError) return 'That model name was not found. Check the model name in Settings.';
  if (e instanceof Anthropic.RateLimitError) return 'Too many requests right now. Try again in a minute.';
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API (are you offline?).';
  if (e instanceof Anthropic.APIError) return `The Claude API returned an error (${e.status ?? 'unknown'}).`;
  return e instanceof Error ? e.message : String(e);
}

export async function aiRecap(opts: { apiKey: string; model: string; snapshot: Snapshot; changes: Changes }): Promise<string> {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: 45_000, maxRetries: 1 });
  try {
    const response = await client.messages.create({
      model: opts.model,
      max_tokens: 4000,
      output_config: { effort: 'low' },
      system: SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(buildPayload(opts.snapshot, opts.changes)) }],
    });
    if (response.stop_reason === 'refusal') throw new Error('Claude declined to write this recap.');
    const text = response.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    if (!text) throw new Error('Claude returned an empty recap.');
    return text.replace(/—/g, ',');
  } catch (e) {
    throw new Error(friendlyError(e));
  }
}
