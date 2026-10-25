#!/usr/bin/env node
// `npx stashd` launcher. Opens the installed app if it is in /Applications,
// otherwise runs the app from this folder with the local Electron.

const { execFileSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const installed = ['/Applications/Stashd.app', path.join(require('node:os').homedir(), 'Applications/Stashd.app')].find((p) =>
  fs.existsSync(p),
);

if (installed && process.platform === 'darwin') {
  execFileSync('open', ['-a', installed]);
  process.exit(0);
}

const projectRoot = path.resolve(__dirname, '..');
const built = path.join(projectRoot, '.vite', 'build', 'main.cjs');
let electron;
try {
  electron = require('electron');
} catch {
  console.error('Stashd is not installed. Install the DMG, or run "npm install" in the project folder first.');
  process.exit(1);
}
if (!fs.existsSync(built)) {
  console.error('The app has not been built yet. Run "npm run package" once in the project folder.');
  process.exit(1);
}
const child = spawn(electron, [projectRoot], { stdio: 'inherit', detached: true });
child.unref();
