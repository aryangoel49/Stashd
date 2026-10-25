import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacyData } from '../src/main/legacy';

describe('moving data over from Where Was I', () => {
  let root: string, legacy: string, dir: string;
  beforeEach(() => {
    root = mkdtempSync(path.join(os.tmpdir(), 'stashd-legacy-'));
    legacy = path.join(root, 'Where Was I');
    dir = path.join(root, 'Stashd');
    mkdirSync(path.join(legacy, 'jobs', 'climate-essay'), { recursive: true });
    writeFileSync(path.join(legacy, 'jobs', 'climate-essay', 'job.json'), '{"id":"climate-essay"}');
    writeFileSync(path.join(legacy, 'settings.json'), '{"tidyByDefault":true}');
    writeFileSync(path.join(legacy, 'state.json'), '{}');
    writeFileSync(path.join(legacy, 'api-key.bin'), 'c2VjcmV0');
    mkdirSync(dir);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('copies jobs, settings and learning, but not the Claude key', () => {
    expect(migrateLegacyData(legacy, dir)).toBe(true);
    expect(readFileSync(path.join(dir, 'jobs', 'climate-essay', 'job.json'), 'utf8')).toContain('climate-essay');
    expect(readFileSync(path.join(dir, 'settings.json'), 'utf8')).toContain('tidyByDefault');
    expect(existsSync(path.join(dir, 'state.json'))).toBe(true);
    expect(existsSync(path.join(dir, 'api-key.bin'))).toBe(false);
    expect(existsSync(path.join(legacy, 'jobs', 'climate-essay', 'job.json'))).toBe(true);
  });

  it('leaves Stashd alone once it has data of its own', () => {
    writeFileSync(path.join(dir, 'settings.json'), '{"tidyByDefault":false}');
    expect(migrateLegacyData(legacy, dir)).toBe(false);
    expect(readFileSync(path.join(dir, 'settings.json'), 'utf8')).toContain('false');
    expect(existsSync(path.join(dir, 'jobs'))).toBe(false);
  });

  it('does nothing without an old folder', () => {
    rmSync(legacy, { recursive: true });
    expect(migrateLegacyData(legacy, dir)).toBe(false);
  });
});
