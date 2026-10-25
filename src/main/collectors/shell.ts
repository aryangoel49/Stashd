// Optional: recent commands from ~/.zsh_history, with secrets redacted. Off by default.

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { redactCommand } from '../redact';

const TAIL_BYTES = 256 * 1024;

/** zsh stores some bytes "metafied": 0x83 followed by the byte XOR 32. */
export function unmetafy(buf: Buffer): Buffer {
  const out = Buffer.alloc(buf.length);
  let j = 0;
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x83 && i + 1 < buf.length) {
      out[j++] = buf[++i] ^ 32;
    } else {
      out[j++] = buf[i];
    }
  }
  return out.subarray(0, j);
}

export interface HistoryEntry {
  /** Seconds since epoch, or null for the plain format. */
  time: number | null;
  command: string;
}

/** Parse both the extended format (": <epoch>:<duration>;<cmd>") and plain lines. Handles backslash line continuations. */
export function parseZshHistory(text: string): HistoryEntry[] {
  const lines = text.split('\n');
  const out: HistoryEntry[] = [];
  let current: HistoryEntry | null = null;
  let continuing = false;
  for (const line of lines) {
    if (continuing && current) {
      current.command += '\n' + line;
    } else {
      const m = /^: (\d+):\d+;(.*)$/.exec(line);
      current = m ? { time: Number(m[1]), command: m[2] } : { time: null, command: line };
      out.push(current);
    }
    continuing = /(^|[^\\])\\$/.test(line);
    if (continuing && current) current.command = current.command.slice(0, -1);
  }
  return out.filter((e) => e.command.trim().length > 0);
}

/** The last `limit` commands, newest last, limited to the lookback window when times are known. */
export function recentCommands(entries: HistoryEntry[], sinceSec: number, limit: number): string[] {
  const hasTimes = entries.some((e) => e.time !== null);
  const picked = hasTimes ? entries.filter((e) => e.time !== null && e.time >= sinceSec) : entries;
  const seen = new Set<string>();
  const result: string[] = [];
  for (let i = picked.length - 1; i >= 0 && result.length < limit; i--) {
    const cmd = picked[i].command.trim();
    if (seen.has(cmd)) continue;
    seen.add(cmd);
    result.push(redactCommand(cmd).slice(0, 500));
  }
  return result.reverse();
}

export async function collectShellHistory(sinceMs: number, limit = 25): Promise<string[]> {
  const file = process.env.HISTFILE && path.isAbsolute(process.env.HISTFILE) ? process.env.HISTFILE : path.join(os.homedir(), '.zsh_history');
  const fh = await fs.open(file, 'r');
  try {
    const { size } = await fh.stat();
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    await fh.read(buf, 0, buf.length, start);
    let text = unmetafy(buf).toString('utf8');
    if (start > 0) text = text.slice(text.indexOf('\n') + 1); // drop the partial first line
    return recentCommands(parseZshHistory(text), Math.floor(sinceMs / 1000), limit);
  } finally {
    await fh.close();
  }
}
