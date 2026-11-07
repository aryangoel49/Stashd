import { mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { Memory, STEPS } from '../src/main/memory';
import type { Item } from '../src/shared/types';

const dir = () => mkdtempSync(path.join(tmpdir(), 'stashd-memory-'));
const tab: Item = { key: 'tab:https://www.jstor.org/stable/123?q=secret', kind: 'tab', label: 'Carbon taxes · JSTOR', detail: '', app: 'Google Chrome', url: 'https://www.jstor.org/stable/123?q=secret' };
const doc: Item = { key: 'doc:/Users/a/Essay.docx', kind: 'doc', label: 'Essay.docx', detail: '', app: 'Microsoft Word', path: '/Users/a/Essay.docx' };

describe("Stashd's memory", () => {
  it('creates every table at the latest version, readable only by you', () => {
    const d = dir();
    const m = Memory.open(d);
    expect(m.version()).toBe(STEPS.length);
    for (const t of ['moments', 'snapshots', 'snapshot_items', 'prompts', 'saves', 'patterns', 'meanings', 'rulebooks', 'chats', 'chat_turns']) expect(m.rows(t)).toEqual([]);
    expect(statSync(path.join(d, 'memory.db')).mode & 0o777).toBe(0o600);
    m.close();
  });

  it('records a save with what was in it: titles and sites only, never full addresses or paths', () => {
    const m = Memory.open(dir());
    m.recordSave({ folder: 'climate-essay', file: 'entry-1', how: 'manual', kind: 'manual', items: [tab, doc] });
    expect(m.rows('moments')).toMatchObject([{ kind: 'manual', to_folder: 'climate-essay' }]);
    expect(m.rows('saves')).toMatchObject([{ folder: 'climate-essay', how: 'manual', file: 'entry-1' }]);
    const items = m.rows('snapshot_items');
    expect(items.map((i) => i.site)).toEqual(['jstor.org', null]);
    expect(JSON.stringify(items)).not.toContain('secret');
    expect(JSON.stringify(items)).not.toContain('/Users/a');
    expect(m.counts().moments).toBe(1);
    m.close();
  });

  it('keeps what it remembers after reopening, and runs no step twice', () => {
    const d = dir();
    const a = Memory.open(d);
    a.recordSave({ folder: 'f', file: 'e', how: 'manual', kind: 'manual', items: [tab] });
    a.close();
    const b = Memory.open(d);
    expect(b.counts().moments).toBe(1);
    b.close();
  });

  it('copies an older file before upgrading it', () => {
    const d = dir();
    const file = path.join(d, 'memory.db');
    const old = new DatabaseSync(file);
    old.exec('CREATE TABLE early (x); PRAGMA user_version = 0;');
    old.close();
    // A file at version 0 with nothing to lose is upgraded in place; one at a real older version gets a copy.
    const db = new DatabaseSync(file);
    db.exec(STEPS[0]);
    db.exec('PRAGMA user_version = 1');
    db.close();
    // A file from the first version (before chats) comes up to date, keeping a copy first.
    const m = Memory.open(d);
    expect(m.version()).toBe(STEPS.length);
    expect(readdirSync(d).some((f) => f.startsWith(`memory.db.before-v${STEPS.length}-`))).toBe(true);
    expect(m.chats()).toEqual([]);
    m.close();
  });

  it('keeps Ask Stashd chats: a new chat, follow-ups in it, newest chat first, and delete', () => {
    const m = Memory.open(dir());
    const a = m.addTurn(null, 'What was I doing on Toronto trip?', { answer: 'Hotels.' }, new Date('2026-11-07T10:00:00Z'));
    const b = m.addTurn(null, 'What did I do this week?', { answer: 'Stashd.' }, new Date('2026-11-07T11:00:00Z'));
    expect(m.addTurn(a, 'And the budget?', { answer: 'Under $180.' }, new Date('2026-11-07T12:00:00Z'))).toBe(a);
    expect(m.chats().map((c) => [c.id, c.title, c.turns])).toEqual([[a, 'What was I doing on Toronto trip?', 2], [b, 'What did I do this week?', 1]]);
    expect(m.chat(a).map((t) => t.question)).toEqual(['What was I doing on Toronto trip?', 'And the budget?']);
    expect(m.chat(a)[1].reply).toEqual({ answer: 'Under $180.' });
    // A chat that's gone starts a new one instead of failing.
    m.deleteChat(b);
    expect(m.addTurn(b, 'Hello?', { answer: 'Hi.' })).not.toBe(b);
    m.forget();
    expect(m.chats()).toEqual([]);
    m.close();
  });

  it('sets a damaged file aside and starts fresh, so Stashd never stops', () => {
    const d = dir();
    writeFileSync(path.join(d, 'memory.db'), 'this is not a database');
    const m = Memory.open(d);
    expect(m.version()).toBe(STEPS.length);
    expect(readdirSync(d).some((f) => f.startsWith('memory.db.damaged-'))).toBe(true);
    m.close();
  });

  it('drops old detail first, then old moments; "Forget my history" clears everything', () => {
    const m = Memory.open(dir());
    const now = new Date('2026-11-06T12:00:00Z');
    m.recordSave({ folder: 'old', file: 'e1', how: 'manual', kind: 'manual', items: [tab], at: new Date('2025-10-01T12:00:00Z') });
    m.recordSave({ folder: 'mid', file: 'e2', how: 'manual', kind: 'manual', items: [tab], at: new Date('2026-06-01T12:00:00Z') });
    m.recordSave({ folder: 'new', file: 'e3', how: 'manual', kind: 'manual', items: [tab], at: new Date('2026-11-01T12:00:00Z') });
    m.prune(now);
    expect(m.rows('moments').map((r) => r.to_folder)).toEqual(['mid', 'new']);
    expect(m.rows('snapshot_items')).toHaveLength(1);
    m.forget();
    expect(m.counts()).toEqual({ moments: 0, since: null });
    expect(m.rows('saves')).toEqual([]);
    m.close();
  });
});

