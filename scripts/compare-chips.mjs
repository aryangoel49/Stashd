// Checks that the Apple silicon and Intel builds sort work the same way (tests/chips.test.ts).
// On Apple silicon the Intel side runs through Rosetta. Build both first:
//   npm run package && npm run package:intel && npm run check:chips

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { downloadArtifact } = await import(require.resolve('@electron/get', { paths: [path.join(root, 'node_modules/@electron/packager')] }));
const version = require(path.join(root, 'node_modules/electron/package.json')).version;

/** A plain Electron for this chip: the built apps have running as Node switched off. */
async function electronFor(arch) {
  const dir = path.join(root, 'out', 'chips', `electron-${version}-${arch}`);
  const binary = path.join(dir, 'Electron.app', 'Contents', 'MacOS', 'Electron');
  if (!existsSync(binary)) {
    const zip = await downloadArtifact({ version, platform: 'darwin', arch, artifactName: 'electron' });
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    execFileSync('ditto', ['-x', '-k', zip, dir]);
  }
  return binary;
}

async function build(arch) {
  const embedder = path.join(root, 'out', `Stashd-darwin-${arch}`, 'Stashd.app', 'Contents', 'Resources', 'embedder');
  if (!existsSync(embedder)) throw new Error(`Build it first: no ${embedder}`);
  return `${await electronFor(arch)}|${embedder}`;
}

execFileSync('npx', ['vitest', 'run', 'tests/chips.test.ts', '--silent=false'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, STASHD_CHIP_A: await build('arm64'), STASHD_CHIP_B: await build('x64') },
});
