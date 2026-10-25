// The Claude API key is encrypted with Electron safeStorage (backed by the macOS Keychain)
// and saved as <userData>/api-key.bin. It is never written anywhere in plain text.

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { safeStorage } from 'electron';
import { writeFileAtomic } from './store';

export class SecretStore {
  private readonly file: string;

  constructor(dir: string) {
    this.file = path.join(dir, 'api-key.bin');
  }

  async has(): Promise<boolean> {
    try {
      await fs.access(this.file);
      return true;
    } catch {
      return false;
    }
  }

  async get(): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable()) return null;
    try {
      const b64 = await fs.readFile(this.file, 'utf8');
      return safeStorage.decryptString(Buffer.from(b64, 'base64'));
    } catch {
      return null;
    }
  }

  async set(key: string): Promise<void> {
    if (key === '') {
      await fs.rm(this.file, { force: true });
      return;
    }
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Secure storage is not available on this Mac right now.');
    await writeFileAtomic(this.file, safeStorage.encryptString(key).toString('base64'));
  }
}
