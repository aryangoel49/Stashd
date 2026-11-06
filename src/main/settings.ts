// Settings live in <userData>/settings.json. The API key is NOT here (see secrets.ts).

import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/types';
import { normalizeStoredSettings, settingsPatch } from '../shared/validate';
import { readJsonSafely } from './safety';
import { writeFileKeepingLast } from './store';

type Listener = (next: Settings, prev: Settings) => void;

export class SettingsStore {
  private value: Settings;
  private listeners: Listener[] = [];
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'settings.json');
    // First run, or damaged beyond repair: start from defaults.
    this.value = normalizeStoredSettings(readJsonSafely(dir, 'settings.json'));
  }

  get(): Settings {
    return structuredClone(this.value);
  }

  async update(patch: unknown): Promise<Settings> {
    const prev = this.value;
    const next = settingsPatch(patch, prev);
    await writeFileKeepingLast(this.file, JSON.stringify(next, null, 2));
    this.value = next;
    for (const l of this.listeners) l(structuredClone(next), structuredClone(prev));
    return this.get();
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }

  async reset(): Promise<void> {
    await fs.rm(this.file, { force: true });
    await fs.rm(`${this.file}.bak`, { force: true });
  }
}
