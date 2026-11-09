// The welcome's permission checklist: every app on this Mac that Stashd works with, why it needs it, and
// whether macOS already lets it. macOS asks about each app separately ("Stashd wants to control Chrome"),
// so the welcome asks for all the open ones in one go instead of one by one in the middle of your first save.
// Apps that aren't open can't be asked yet: macOS asks the first time Stashd sees them open.

import type { SetupItem, Settings } from '../shared/types';
import { DOC_ADAPTERS } from './capture/docs';
import { BROWSER_APPS } from './collectors/browsers';
import type { Helper } from './helper';

const CHAT_BUNDLES = ['com.anthropic.claudefordesktop', 'com.openai.chat'];

function wanted(settings: Settings): { id: string; name: string; why: string }[] {
  const browsers = Object.entries(BROWSER_APPS)
    .filter(([b]) => settings.browsers[b as keyof Settings['browsers']])
    .map(([, b]) => ({ id: b.bundleId, name: b.label, why: 'to save and reopen your tabs' }));
  const docs = DOC_ADAPTERS.map((a) => ({
    id: a.bundleId,
    name: a.app.replace(/^Microsoft /, ''),
    why: a.kind === 'folder' ? 'to save and reopen your folder windows' : 'to save and reopen your open files',
  }));
  return [...browsers, ...docs];
}

/** The checklist. `ask`: macOS asks about each open app it hasn't asked yet (one prompt each). */
export async function setupItems(helper: Helper, settings: Settings, ask = false): Promise<SetupItem[]> {
  const apps = wanted(settings);
  const status = await helper.automation([...apps.map((a) => a.id), ...CHAT_BUNDLES], ask).catch(() => ({}) as Record<string, string>);
  const items: SetupItem[] = apps
    .filter((a) => status[a.id] && status[a.id] !== 'notInstalled')
    .map((a) => ({
      ...a,
      kind: 'automation',
      status: status[a.id] === 'allowed' ? 'allowed' : status[a.id] === 'denied' ? 'denied' : status[a.id] === 'ask' ? 'ask' : 'later',
    }));
  // Accessibility puts windows back where they were, and sees which Claude or ChatGPT chat is open.
  const chats = CHAT_BUNDLES.some((id) => status[id] && status[id] !== 'notInstalled');
  const trusted = await helper.accessibility(false).catch(() => false);
  items.push({
    id: 'accessibility',
    name: chats ? 'Window places and chats' : 'Window places',
    why: chats ? 'to put windows back where they were, and reopen the exact chat you were in' : 'to put windows back where they were',
    kind: 'accessibility',
    status: trusted ? 'allowed' : 'ask',
  });
  return items;
}
