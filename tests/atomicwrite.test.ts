import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { writeFileAtomic } from '../src/main/store';

it('two saves of one file at the same moment both succeed', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wwi-atomic-'));
  const file = path.join(dir, 'break.json');
  await Promise.all(Array.from({ length: 20 }, (_, n) => writeFileAtomic(file, String(n))));
  expect(Number(await fs.readFile(file, 'utf8'))).toBeGreaterThanOrEqual(0);
  expect((await fs.readdir(dir)).filter((f) => f.endsWith('.tmp'))).toEqual([]);
});
