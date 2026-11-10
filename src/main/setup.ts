// The welcome's permission checklist: every app on this Mac that Stashd works with, why it needs it, and
// whether macOS already lets it. macOS asks about each app separately ("Stashd wants to control Chrome"),
// so the welcome asks for all the open ones in one go instead of one by one in the middle of your first save.
// Apps that aren't open can't be asked yet: macOS asks the first time Stashd sees them open.

import type { SetupItem, Settings } from '../shared/types';
import { DOC_ADAPTERS } from './capture/docs';
import { BROWSER_APPS } from './collectors/browsers';
import type { Helper } from './helper';
import { listApps } from './apps';

const CHAT_APPS = [
  { id: 'com.anthropic.claudefordesktop', app: 'Claude' },
  { id: 'com.openai.chat', app: 'ChatGPT' },
];

function wanted(settings: Settings): { id: string; app: string; name: string; why: string }[] {
  const browsers = Object.entries(BROWSER_APPS)
    .filter(([b]) => settings.browsers[b as keyof Settings['browsers']])
    .map(([, b]) => ({ id: b.bundleId, app: b.appName, name: b.label, why: 'to save and reopen your tabs' }));
  const docs = DOC_ADAPTERS.map((a) => ({
    id: a.bundleId,
    app: a.app,
    name: a.app.replace(/^Microsoft /, ''),
    why: a.kind === 'folder' ? 'to save and reopen your folder windows' : 'to save and reopen your open files',
  }));
  return [...browsers, ...docs];
}

/** The checklist. `ask`: macOS asks about each open app it hasn't asked yet (one prompt each). */
export async function setupItems(helper: Helper, settings: Settings, ask = false): Promise<SetupItem[]> {
  const apps = wanted(settings);
  const all = [...apps, ...CHAT_APPS];
  // If the helper can't say (it timed out on a slow Mac's first start, say), the apps installed in
  // Applications are listed as "later", so the list (and the welcome's Chrome step) isn't empty.
  const status =
    (await helper.automation(all.map((a) => a.id), ask).catch(() => null)) ??
    (await listApps().then(
      (installed) => {
        const names = new Set(installed.map((a) => a.name.toLowerCase()));
        return Object.fromEntries(all.map((a) => [a.id, names.has(a.app.toLowerCase()) ? 'notRunning' : 'notInstalled']));
      },
      () => ({}) as Record<string, string>,
    ));
  const items: SetupItem[] = apps
    .filter((a) => status[a.id] && status[a.id] !== 'notInstalled')
    .map(({ app: _app, ...a }) => ({
      ...a,
      kind: 'automation',
      status: status[a.id] === 'allowed' ? 'allowed' : status[a.id] === 'denied' ? 'denied' : status[a.id] === 'ask' ? 'ask' : 'later',
    }));
  // Seeing which Claude or ChatGPT chat is open needs Accessibility, so only if one of them is here.
  if (CHAT_APPS.some(({ id }) => status[id] && status[id] !== 'notInstalled')) {
    const trusted = await helper.accessibility(false).catch(() => false);
    items.push({ id: 'accessibility', name: 'Claude and ChatGPT chats', why: 'to reopen the exact chat you were in', kind: 'accessibility', status: trusted ? 'allowed' : 'ask' });
  }
  return items;
}
