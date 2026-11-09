#!/usr/bin/env node
// `npx get-stashd`: installs Stashd and opens it.
//
// Downloads the latest release for this Mac's chip from GitHub, and installs it only if:
//   - its SHA-256 matches the one GitHub lists for the file;
//   - it's Stashd (com.aryangoel.stashd) and its signature is intact (codesign).
// It goes in /Applications (or ~/Applications when /Applications can't be written to), then opens.
// Files downloaded this way don't get macOS's "downloaded from the internet" flag, so there's no
// "Open Anyway" step. If Stashd is already installed, it just opens it: Stashd updates itself.
// No dependencies; nothing about you is sent anywhere.

'use strict';
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RELEASES = 'https://api.github.com/repos/aryangoel49/Stashd/releases/latest';
const BUNDLE_ID = 'com.aryangoel.stashd';
const HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
// For testing only: install somewhere else, and don't open it.
const TEST_DIR = process.env.STASHD_INSTALL_DIR;

const say = (s) => process.stdout.write(`${s}\n`);
const fail = (s) => {
  process.stderr.write(`\nStashd wasn't installed: ${s}\nYou can also download it from https://getstashd.vercel.app/download.html\n`);
  process.exit(1);
};

function installed() {
  if (TEST_DIR) return null;
  return ['/Applications/Stashd.app', path.join(os.homedir(), 'Applications', 'Stashd.app')].find((p) => fs.existsSync(p)) ?? null;
}

function target() {
  if (TEST_DIR) return TEST_DIR;
  try {
    fs.accessSync('/Applications', fs.constants.W_OK);
    return '/Applications';
  } catch {
    const own = path.join(os.homedir(), 'Applications');
    fs.mkdirSync(own, { recursive: true });
    return own;
  }
}

async function main() {
  if (process.platform !== 'darwin') fail('Stashd is a Mac app.');
  const already = installed();
  if (already) {
    say(`Stashd is already installed (${already}). Opening it. It keeps itself up to date.`);
    execFileSync('open', [already]);
    return;
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
  say(`Finding the latest Stashd for ${arch === 'arm64' ? 'Apple silicon' : 'Intel'}…`);
  const res = await fetch(RELEASES, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'stashd-installer' } });
  if (!res.ok) fail(`GitHub said ${res.status}. Try again in a minute.`);
  const rel = await res.json();
  const version = String(rel.tag_name ?? '').replace(/^v/, '');
  const asset = (rel.assets ?? []).find((a) => a.name === `Stashd-darwin-${arch}-${version}.zip`);
  const sha = /^sha256:([0-9a-f]{64})$/.exec(asset?.digest ?? '');
  if (!asset || !sha) fail('the latest release has no download for this Mac yet.');
  const url = new URL(asset.browser_download_url);
  if (url.protocol !== 'https:' || !HOSTS.includes(url.hostname)) fail('the download link looks wrong.');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stashd-'));
  try {
    say(`Downloading Stashd ${version} (${Math.round((asset.size ?? 0) / 1e6)} MB)…`);
    const dl = await fetch(url, { headers: { 'user-agent': 'stashd-installer' } });
    if (!dl.ok || !HOSTS.includes(new URL(dl.url).hostname)) fail(`the download failed (${dl.status}).`);
    const data = Buffer.from(await dl.arrayBuffer());
    if (crypto.createHash('sha256').update(data).digest('hex') !== sha[1]) fail("the download didn't match its checksum.");
    const zip = path.join(dir, 'Stashd.zip');
    fs.writeFileSync(zip, data);

    say('Checking it…');
    execFileSync('ditto', ['-x', '-k', zip, path.join(dir, 'out')]);
    const app = path.join(dir, 'out', 'Stashd.app');
    const id = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(app, 'Contents', 'Info.plist')]).toString().trim();
    if (id !== BUNDLE_ID) fail("the download isn't Stashd.");
    try {
      execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'ignore' });
    } catch {
      fail("the download's signature is broken.");
    }

    const into = target();
    const dest = path.join(into, 'Stashd.app');
    say(`Putting it in ${into}…`);
    fs.rmSync(dest, { recursive: true, force: true });
    execFileSync('ditto', [app, dest]);
    if (TEST_DIR) {
      say(`Installed Stashd ${version} in ${dest} (test: not opened).`);
      return;
    }
    say(`Stashd ${version} is installed. Opening it: look for the folder in your menu bar.`);
    execFileSync('open', [dest]);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

main().catch((e) => fail(e && e.message ? e.message : String(e)));
