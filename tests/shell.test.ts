import { describe, expect, it } from 'vitest';
import { parseZshHistory, recentCommands, unmetafy } from '../src/main/collectors/shell';

describe('parseZshHistory', () => {
  it('reads the extended format', () => {
    const text = ': 1700000000:0;npm test\n: 1700000100:3;git status\n';
    expect(parseZshHistory(text)).toEqual([
      { time: 1700000000, command: 'npm test' },
      { time: 1700000100, command: 'git status' },
    ]);
  });

  it('reads the plain format', () => {
    expect(parseZshHistory('ls\ncd src\n')).toEqual([
      { time: null, command: 'ls' },
      { time: null, command: 'cd src' },
    ]);
  });

  it('joins multi-line commands', () => {
    const text = ': 1700000000:0;docker run \\\n  -p 80:80 nginx\n: 1700000001:0;ls\n';
    const out = parseZshHistory(text);
    expect(out).toHaveLength(2);
    expect(out[0].command).toBe('docker run \n  -p 80:80 nginx');
  });
});

describe('recentCommands', () => {
  it('keeps only the lookback window, dedupes and redacts', () => {
    const entries = [
      { time: 100, command: 'old command' },
      { time: 200, command: 'export API_TOKEN=abc' },
      { time: 300, command: 'npm test' },
      { time: 400, command: 'npm test' },
    ];
    expect(recentCommands(entries, 150, 10)).toEqual(['export API_TOKEN=[REDACTED]', 'npm test']);
  });

  it('takes the last N for the plain format', () => {
    const entries = ['a', 'b', 'c'].map((command) => ({ time: null, command }));
    expect(recentCommands(entries, 0, 2)).toEqual(['b', 'c']);
  });
});

describe('unmetafy', () => {
  it('decodes zsh metafied bytes', () => {
    // "é" is C3 A9 in UTF-8; zsh stores A9 as 83 89 (0xA9 ^ 32 = 0x89).
    const buf = Buffer.from([0x63, 0x61, 0x66, 0xc3, 0x83, 0x89]);
    expect(unmetafy(buf).toString('utf8')).toBe('café');
  });
});
