// Tidy all with a four-finger double tap on the trackpad (Settings → Keyboard shortcuts). The Swift helper's
// `gestures` command watches the trackpad and prints a line for each double tap; this keeps it running while
// the setting is on (restarting it if it stops, a few times) and stops it when the setting goes off.

import { spawn, type ChildProcess } from 'node:child_process';

const RESTART_MS = 5000;
const GIVE_UP_AFTER = 5;

export class GestureWatcher {
  private child: ChildProcess | null = null;
  private wanted = false;
  private failures = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly binary: string,
    private readonly onTidy: () => void,
  ) {}

  /** On or off, following the setting. */
  set(on: boolean): void {
    this.wanted = on;
    if (on && !this.child) {
      this.failures = 0;
      this.start();
    } else if (!on) this.stop();
  }

  private start(): void {
    if (!this.wanted || this.child) return;
    const child = spawn(this.binary, ['gestures'], { stdio: ['pipe', 'pipe', 'ignore'] });
    this.child = child;
    let buffer = '';
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        // The trackpad framework prints its own notes too; only Stashd's JSON lines count.
        if (!line.startsWith('{')) continue;
        try {
          const msg = JSON.parse(line) as { gesture?: unknown; ready?: unknown };
          if (msg.ready) this.failures = 0;
          if (msg.gesture === 'tidy') this.onTidy();
        } catch {
          // not ours
        }
      }
    });
    child.on('exit', () => {
      if (this.child !== child) return;
      this.child = null;
      // No trackpad, or it stopped: try again a little later, a few times.
      if (this.wanted && ++this.failures < GIVE_UP_AFTER) this.timer = setTimeout(() => this.start(), RESTART_MS);
    });
    child.on('error', () => undefined);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const c = this.child;
    this.child = null;
    // Closing its input tells the helper to stop; kill it if it doesn't.
    c?.stdin?.end();
    if (c) setTimeout(() => c.exitCode === null && c.kill(), 1000);
  }
}
