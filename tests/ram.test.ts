import { describe, expect, it } from 'vitest';
import { memoryByApp, memoryLabel, parseTopMem, usedFromVmStat } from '../src/main/ram';

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                   319361.
Pages active:                                1178549.
Pages wired down:                             264405.
Pages purgeable:                               25441.
Anonymous pages:                             1458379.
Pages occupied by compressor:                  65996.
`;

describe('memory in use', () => {
  it('counts app memory, wired and compressed, like Activity Monitor', () => {
    // (1458379 - 25441 + 264405 + 65996) pages of 16 KB
    expect(usedFromVmStat(VM_STAT)).toBe(Math.round(((1458379 - 25441 + 264405 + 65996) * 16384) / 1024 / 1024));
  });

  it('gives up on output it can’t read', () => {
    expect(usedFromVmStat('nothing here')).toBeNull();
  });

  it('labels it plainly', () => {
    expect(memoryLabel(3174)).toBe('3.1 GB');
    expect(memoryLabel(640)).toBe('640 MB');
  });
});

describe('what each app uses (as Activity Monitor counts it)', () => {
  const TOP = `Processes: 600 total
PhysMem: 27G used
PID    MEM
101    300M
102    55M+
103    7168K
104    1.5G
105    12M
`;
  const PS = `  101 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  102 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Framework.framework/Helpers/Google Chrome Helper (Renderer).app/Contents/MacOS/Google Chrome Helper (Renderer)
  103 /Applications/Google Chrome.app/Contents/Frameworks/Google Chrome Helper (GPU)
  104 /Applications/Spotify (old).app/Contents/MacOS/Spotify
  105 /Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary
`;
  it('adds up every process inside each app, helpers too, and nothing outside it', () => {
    const got = memoryByApp(TOP, PS, ['/Applications/Google Chrome.app', '/Applications/Spotify (old).app', '/Applications/Missing.app']);
    expect(got.get('/Applications/Google Chrome.app')).toBe(362);
    expect(got.get('/Applications/Spotify (old).app')).toBe(1536);
    expect(got.get('/Applications/Missing.app')).toBe(0);
  });

  it('reads top’s units', () => {
    expect(parseTopMem('2.9G+')).toBeCloseTo(2969.6);
    expect(parseTopMem('7265K')).toBeCloseTo(7.09, 1);
    expect(parseTopMem('n/a')).toBeNull();
  });
});
