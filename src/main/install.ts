// A random ID for this install, made once. Stashd AI uses it to share out the free daily briefs fairly.
// It says nothing about you or your Mac.

import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function installId(dir: string): Promise<string> {
  const file = path.join(dir, 'install-id');
  try {
    const id = (await fs.readFile(file, 'utf8')).trim();
    if (UUID.test(id)) return id;
  } catch {
    // first run
  }
  const id = randomUUID();
  await fs.writeFile(file, id);
  return id;
}
