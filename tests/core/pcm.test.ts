import { describe, expect, it } from 'vitest';
import { base64ToPcm16, downsampleTo16k, int16ToFloat32, pcm16ToBase64 } from '../../src/core/pcm';

describe('pcm', () => {
  it('downsamples 48k to 16k by averaging', () => {
    const input = new Float32Array(4800).fill(0.5);
    const out = downsampleTo16k(input, 48000);
    expect(out.length).toBe(1600);
    expect(Math.abs(out[0] - 16384)).toBeLessThanOrEqual(1);
  });

  it('keeps 16k input the same length', () => {
    expect(downsampleTo16k(new Float32Array(160), 16000).length).toBe(160);
  });

  it('clamps out-of-range samples', () => {
    const out = downsampleTo16k(new Float32Array([2, -2]), 16000);
    expect(Array.from(out)).toEqual([32767, -32768]);
  });

  it('round-trips through base64', () => {
    const pcm = new Int16Array([0, 1, -1, 32767, -32768, 1234]);
    expect(Array.from(base64ToPcm16(pcm16ToBase64(pcm)))).toEqual(Array.from(pcm));
  });

  it('converts int16 to float32 in [-1, 1]', () => {
    const f = int16ToFloat32(new Int16Array([16384, -32768, 0]));
    expect(f[0]).toBeCloseTo(0.5, 3);
    expect(f[1]).toBe(-1);
    expect(f[2]).toBe(0);
  });
});
