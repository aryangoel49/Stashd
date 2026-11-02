import { describe, expect, it } from 'vitest';
import { attachChats, chatTitle } from '../src/main/capture';
import { isLifestyle } from '../src/main/jobs/match';
import { group, jobProfile } from '../src/main/jobs/relevance';
import { chatLink } from '../src/main/open';
import { buildPromptData } from '../src/main/brief/prompt';
import { DEFAULT_SETTINGS } from '../src/shared/validate';
import type { Item, SaveEntry } from '../src/shared/types';

const tab = (label: string, url: string): Item => ({ key: `tab:${url}`, kind: 'tab', label, detail: '', app: 'Google Chrome', url, window: 1 });
const app = (name: string): Item => ({ key: `app:${name}`, kind: 'app', label: name, detail: 'App', app: name });

describe('chats in Claude and ChatGPT', () => {
  it('names the chat and drops the app suffix', () => {
    expect(chatTitle('Claude', 'Below reviews summary - Claude')).toBe('Below reviews summary');
    expect(chatTitle('Claude', 'Stashd · Build - Claude Code')).toBe('Stashd · Build');
    expect(chatTitle('Claude', 'Claude')).toBeNull();
    expect(chatTitle('ChatGPT', 'New chat')).toBeNull();
  });

  it('puts the chat on its app item, and a chat is never an everyday app', () => {
    const items = [app('Claude'), app('Spotify')];
    attachChats(items, [{ app: 'Claude', title: 'Below reviews summary - Claude', url: 'https://claude.ai/chat/abc123def' }]);
    expect(items[0]).toMatchObject({ label: 'Below reviews summary', chat: { url: 'https://claude.ai/chat/abc123def' } });
    expect(isLifestyle(items[0], DEFAULT_SETTINGS)).toBe(false);
    expect(isLifestyle(app('Claude'), DEFAULT_SETTINGS)).toBe(true);
  });

  it('groups a chat with the project it is about', () => {
    const movie = { ...app('Claude'), label: 'Below TV series ending explained', chat: { title: 'Below TV series ending explained', url: 'https://claude.ai/chat/a1b2c3d4' } };
    const stock = { ...app('ChatGPT'), label: 'TSM earnings outlook', chat: { title: 'TSM earnings outlook' } };
    const candidates = [tab('Below (TV Mini Series 2026) - IMDb', 'https://www.imdb.com/title/tt1/'), tab('Below - Netflix', 'https://www.netflix.com/title/1'), movie, stock];
    const g = group({ candidates, profile: null, frontKey: candidates[0].key });
    expect(g.sure.map((i) => i.label)).toContain('Below TV series ending explained');
    expect(g.sure.map((i) => i.label)).not.toContain('TSM earnings outlook');
  });

  it('only counts as "was in this folder" when it is the same chat', () => {
    const old = { ...app('Claude'), chat: { title: 'Grant budget', url: 'https://claude.ai/chat/old11111' } };
    const now = { ...app('Claude'), label: 'Pasta recipes', chat: { title: 'Pasta recipes', url: 'https://claude.ai/chat/new22222' } };
    const g = group({ candidates: [now], profile: jobProfile('Grant', '', [old]), frontKey: null });
    expect(g.sure).toHaveLength(0);
  });

  it('opens only exact Claude chat links', () => {
    const c = (url: string): Item => ({ ...app('Claude'), chat: { title: 'x', url } });
    expect(chatLink(c('https://claude.ai/chat/abc123def'))).toBe('claude://claude.ai/chat/abc123def');
    expect(chatLink(c('https://claude.ai/epitaxy/local_7acaa0f1'))).toBe('claude://claude.ai/epitaxy/local_7acaa0f1');
    expect(chatLink(c('https://evil.com/chat/abc123def'))).toBeNull();
    expect(chatLink(c('https://claude.ai/chat/abc;rm -rf'))).toBeNull();
    expect(chatLink({ ...app('ChatGPT'), chat: { title: 'x', url: 'https://chatgpt.com/c/1' } })).toBeNull();
  });

  it('keeps the end of the chat, without secrets, and gives it to the brief', () => {
    const items = [app('Claude')];
    const key = 'sk-ant-api03-' + 'Zq8x'.repeat(12);
    attachChats(items, [{ app: 'Claude', title: 'Grant budget - Claude', url: 'https://claude.ai/chat/abc123def', text: `Use ${key} here. We agreed to cut travel to $2,000 and ask Priya for the final numbers.` }]);
    expect(items[0].chat?.excerpt).toContain('cut travel to $2,000');
    expect(items[0].chat?.excerpt).not.toContain(key);
    const entry: SaveEntry = { version: 2, id: 'e', jobId: 'j', savedAt: '2026-11-02T10:00:00Z', note: '', items, frontKey: null, appOrder: [], tidied: false, errors: [] };
    const payload = buildPromptData(entry, null, null).payload as { items: { chatEnd?: string }[] };
    expect(payload.items[0].chatEnd).toContain('ask Priya');
  });
});
