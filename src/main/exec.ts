// The only way this app runs other programs: execFile (no shell), always with a timeout.

import { execFile } from 'node:child_process';

export interface RunResult {
  stdout: string;
  stderr: string;
}

export class RunError extends Error {
  constructor(
    message: string,
    public readonly code: number | string | null,
    public readonly stderr: string,
  ) {
    super(message);
  }
}

// GUI apps on macOS start with a tiny PATH, so add the usual places for git, code and friends.
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'];

export function childEnv(): NodeJS.ProcessEnv {
  const parts = (process.env.PATH ?? '').split(':').filter(Boolean);
  for (const p of EXTRA_PATH) if (!parts.includes(p)) parts.push(p);
  return { ...process.env, PATH: parts.join(':'), GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', LC_ALL: 'en_US.UTF-8' };
}

export function run(
  file: string,
  args: string[],
  opts: { timeoutMs?: number; cwd?: string; maxBuffer?: number } = {},
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        timeout: opts.timeoutMs ?? 5000,
        cwd: opts.cwd,
        maxBuffer: opts.maxBuffer ?? 4 * 1024 * 1024,
        env: childEnv(),
        encoding: 'utf8',
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err) {
          const e = err as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
          const msg = e.killed ? `${file} timed out` : (stderr || e.message || String(err)).trim();
          reject(new RunError(msg, e.code ?? null, String(stderr ?? '')));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}
