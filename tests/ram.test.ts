import { describe, expect, it } from 'vitest';
import { memoryLabel, usedFromVmStat } from '../src/main/ram';

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
