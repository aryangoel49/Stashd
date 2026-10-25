// Settings live in <userData>/settings.json. The API key is NOT here (see secrets.ts).

import { promises as fs, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Settings } from '../shared/types';
import { normalizeStoredSettings, settingsPatch } from '../shared/validate';
import { writeFileAtomic } from './store';

type Listener = (next: Settings, prev: Settings) => void;

export class SettingsStore {
  private value: Settings;
  private listeners: Listener[] = [];
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'settings.json');
    let raw: unknown = null;
    try {
      raw = JSON.parse(readFileSync(this.file, 'utf8'));
    } catch {
      // first run or unreadable file: start from defaults
    }
    this.value = normalizeStoredSettings(raw);
  }

  get(): Settings {
    return structuredClone(this.value);
  }

  async update(patch: unknown): Promise<Settings> {
    const prev = this.value;
    const next = settingsPatch(patch, prev);
    await writeFileAtomic(this.file, JSON.stringify(next, null, 2));
    this.value = next;
    for (const l of this.listeners) l(structuredClone(next), structuredClone(prev));
    return this.get();
  }

  onChange(l: Listener): void {
    this.listeners.push(l);
  }

  async reset(): Promise<void> {
    await fs.rm(this.file, { force: true });
  }
}
