// Keeps Stashd up to date by itself, like Chrome or Slack: it looks for a new release on GitHub a few
// times a day, downloads it quietly, checks it, and swaps it in when Stashd next quits (or right away with
// "Restart to update"). Nothing about you is sent: it only asks GitHub which version is the latest.
//
// A download is installed only if all of these hold:
//   - its SHA-256 matches the one GitHub lists for the file;
//   - it's Stashd (com.aryangoel.stashd), the version the release says, and a newer one;
//   - it's signed by the same certificate as the Stashd that's running (macOS checks the running app's
//     own signing requirement against it), so only a build made with Stashd's key can replace Stashd.
// If /Applications can't be written to, or any check fails, nothing changes and the panel offers the
// download page instead.
//
// This file may use the network (tests/privacy.test.ts), and only to GitHub.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { UpdateState } from '../shared/types';
import { run } from './exec';

export const RELEASES = 'https://api.github.com/repos/aryangoel49/Stashd/releases/latest';
export const RELEASES_PAGE = 'https://github.com/aryangoel49/Stashd/releases/latest';
const DOWNLOAD_HOSTS = ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com'];
const BUNDLE_ID = 'com.aryangoel.stashd';
const FIRST_CHECK_MS = 2 * 60_000;
const CHECK_EVERY_MS = 6 * 60 * 60_000;

/** "1.10.0" > "1.9.2". Anything that isn't three numbers counts as older. */
export function newer(a: string, b: string): boolean {
  const p = (v: string) => (/^v?(\d+)\.(\d+)\.(\d+)$/.exec(v.trim()) ?? []).slice(1).map(Number);
  const x = p(a);
  const y = p(b);
  if (x.length !== 3) return false;
  if (y.length !== 3) return true;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

interface Release {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: { name?: unknown; browser_download_url?: unknown; digest?: unknown; size?: unknown }[];
}

/** The zip for this Mac's chip in a release, with its checksum, or null. */
export function pickAsset(rel: Release, arch: string, hosts: string[] | null = DOWNLOAD_HOSTS): { version: string; url: string; sha256: string; size: number } | null {
  if (typeof rel.tag_name !== 'string' || rel.draft === true || rel.prerelease === true) return null;
  const version = rel.tag_name.replace(/^v/, '');
  const asset = (rel.assets ?? []).find((a) => a.name === `Stashd-darwin-${arch}-${version}.zip`);
  if (!asset || typeof asset.browser_download_url !== 'string' || typeof asset.digest !== 'string') return null;
  const sha = /^sha256:([0-9a-f]{64})$/.exec(asset.digest);
  if (!sha) return null;
  try {
    const u = new URL(asset.browser_download_url);
    if (hosts && (u.protocol !== 'https:' || !hosts.includes(u.hostname))) return null;
  } catch {
    return null;
  }
  return { version, url: asset.browser_download_url, sha256: sha[1], size: typeof asset.size === 'number' ? asset.size : 0 };
}

export class Updater {
  state: UpdateState = { status: 'idle', current: '' };
  private staged: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private installing = false;

  constructor(
    private readonly opts: {
      current: string;
      /** The running Stashd.app. */
      appPath: string;
      /** Where downloads wait (in Stashd's data folder). */
      dir: string;
      arch: string;
      onChange: (s: UpdateState) => void;
      /** For testing a whole update without GitHub: a URL that answers like GitHub's latest release. */
      feed?: string;
    },
  ) {
    this.state = { status: 'idle', current: opts.current };
  }

  start(): void {
    this.timer = setTimeout(() => void this.check(), FIRST_CHECK_MS);
  }

  private set(s: Partial<UpdateState>): void {
    this.state = { ...this.state, ...s };
    this.opts.onChange(this.state);
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.check(), CHECK_EVERY_MS);
  }

  /** Looks for a newer release and gets it ready. `byHand`: you pressed "Check now", so errors are shown. */
  async check(byHand = false): Promise<UpdateState> {
    if (this.busy || this.state.status === 'ready') return this.state;
    this.busy = true;
    if (byHand) this.set({ status: 'checking', error: undefined });
    try {
      const res = await fetch(this.opts.feed ?? RELEASES, {
        headers: { accept: 'application/vnd.github+json', 'user-agent': 'Stashd-updater' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`GitHub said ${res.status}`);
      const asset = pickAsset((await res.json()) as Release, this.opts.arch, this.opts.feed ? null : DOWNLOAD_HOSTS);
      if (!asset || !newer(asset.version, this.opts.current)) {
        this.set({ status: 'idle', checkedAt: new Date().toISOString(), available: undefined, error: undefined });
        return this.state;
      }
      this.set({ status: 'downloading', available: asset.version, error: undefined });
      this.staged = await this.fetchAndCheck(asset);
      this.set({ status: 'ready', checkedAt: new Date().toISOString(), canInstall: await this.canWrite() });
    } catch (e) {
      // Quietly try again later, unless you asked.
      this.set({ status: byHand || this.state.status === 'downloading' ? 'error' : 'idle', error: e instanceof Error ? e.message : String(e) });
    } finally {
      this.busy = false;
      if ((this.state.status as UpdateState['status']) !== 'ready') this.schedule();
    }
    return this.state;
  }

  /** Downloads the zip, checks it, unpacks it and checks the app inside. Returns the unpacked Stashd.app. */
  private async fetchAndCheck(asset: { version: string; url: string; sha256: string }): Promise<string> {
    const dir = path.join(this.opts.dir, 'updates');
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
    const zip = path.join(dir, `Stashd-${asset.version}.zip`);
    const res = await fetch(asset.url, { headers: { 'user-agent': 'Stashd-updater' }, signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok || !res.body) throw new Error(`Download failed (${res.status})`);
    if (!DOWNLOAD_HOSTS.includes(new URL(res.url).hostname) && !this.opts.feed) throw new Error('The download came from somewhere unexpected');
    const hash = createHash('sha256');
    const body = Readable.fromWeb(res.body as never);
    body.on('data', (c: Buffer) => hash.update(c));
    await pipeline(body, createWriteStream(zip));
    if (hash.digest('hex') !== asset.sha256) throw new Error('The download didn’t match its checksum');

    const out = path.join(dir, 'unpacked');
    await run('ditto', ['-x', '-k', zip, out], { timeoutMs: 120_000 });
    await fs.rm(zip, { force: true });
    const app = path.join(out, 'Stashd.app');
    const plist = path.join(app, 'Contents', 'Info.plist');
    const read = async (key: string) => (await run('/usr/libexec/PlistBuddy', ['-c', `Print :${key}`, plist], { timeoutMs: 10_000 })).stdout.trim();
    if ((await read('CFBundleIdentifier')) !== BUNDLE_ID) throw new Error('The download isn’t Stashd');
    if ((await read('CFBundleShortVersionString')) !== asset.version) throw new Error('The download is a different version');
    await run('codesign', ['--verify', '--deep', '--strict', app], { timeoutMs: 120_000 });
    // Signed by the same certificate as this Stashd: the running app's own requirement must hold for the new one.
    const req = await designatedRequirement(this.opts.appPath);
    // (A copy signed without a certificate has nothing to compare against, so it can't update itself.)
    if (!req || !/certificate (leaf|root)/.test(req)) throw new Error('This copy of Stashd can’t update itself');
    await run('codesign', ['--verify', `-R=${req}`, app], { timeoutMs: 60_000 });
    return app;
  }

  /** Can Stashd replace itself where it is? (Usually yes: you dragged it into /Applications yourself.) */
  private async canWrite(): Promise<boolean> {
    try {
      await fs.access(path.dirname(this.opts.appPath), fs.constants.W_OK);
      await fs.access(this.opts.appPath, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Swaps the new version in once this Stashd has quit. Called as Stashd quits (relaunch false) or by
   * "Restart to update" (relaunch true, then the caller quits). True if the swap was arranged.
   */
  installOnExit(relaunch: boolean): boolean {
    if (this.installing || this.state.status !== 'ready' || !this.state.canInstall || !this.staged) return false;
    this.installing = true;
    const target = this.opts.appPath;
    const script = `
pid="$1"; new="$2"; target="$3"; relaunch="$4"
for i in $(seq 1 300); do kill -0 "$pid" 2>/dev/null || break; sleep 0.1; done
old="$target.updating"
rm -rf "$old"
if mv "$target" "$old"; then
  if mv "$new" "$target"; then
    xattr -dr com.apple.quarantine "$target" 2>/dev/null
    rm -rf "$old"
  else
    mv "$old" "$target"
  fi
fi
[ "$relaunch" = 1 ] && open "$target"
exit 0`;
    const child = spawn('/bin/bash', ['-c', script, 'stashd-update', String(process.pid), this.staged, target, relaunch ? '1' : '0'], {
      detached: true,
      stdio: 'ignore',
    });
    child.unref();
    return true;
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
  }
}

/** A signed app's designated requirement ("identifier … and certificate leaf = H\"…\""), or null. */
async function designatedRequirement(appPath: string): Promise<string | null> {
  try {
    const out = await run('codesign', ['-d', '-r-', appPath], { timeoutMs: 20_000 });
    const m = /designated => (.+)/.exec(`${out.stdout}\n${out.stderr}`);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}
