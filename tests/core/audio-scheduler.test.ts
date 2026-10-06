import { describe, expect, it } from 'vitest';
import { AudioScheduler } from '../../src/core/audio-scheduler';

describe('AudioScheduler', () => {
  it('plays the first chunk immediately at normal rate', () => {
    expect(new AudioScheduler().plan(10, 1)).toEqual({ startAt: 10, rate: 1 });
  });

  it('queues chunks back to back', () => {
    const s = new AudioScheduler();
    s.plan(0, 1);
    expect(s.plan(0, 1)).toEqual({ startAt: 1, rate: 1 });
  });

  it('speeds up when the backlog exceeds the limit', () => {
    const s = new AudioScheduler(2.5, 1.1);
    s.plan(0, 1);
    s.plan(0, 1);
    s.plan(0, 2);
    const p = s.plan(0, 2);
    expect(p.startAt).toBe(4);
    expect(p.rate).toBe(1.1);
    expect(s.plan(0, 1).startAt).toBeCloseTo(4 + 2 / 1.1, 5);
  });

  it('starts at now again after a silence', () => {
    const s = new AudioScheduler();
    s.plan(0, 1);
    expect(s.plan(5, 1)).toEqual({ startAt: 5, rate: 1 });
  });

  it('reset clears the queue', () => {
    const s = new AudioScheduler();
    s.plan(0, 10);
    s.reset();
    expect(s.plan(1, 1)).toEqual({ startAt: 1, rate: 1 });
  });
});
