export class AudioScheduler {
  private nextFree = 0;

  constructor(
    private maxBacklogSec = 2.5,
    private fastRate = 1.1,
  ) {}

  plan(now: number, durationSec: number): { startAt: number; rate: number } {
    const startAt = Math.max(now, this.nextFree);
    const backlog = startAt - now;
    const rate = backlog > this.maxBacklogSec ? this.fastRate : 1;
    this.nextFree = startAt + durationSec / rate;
    return { startAt, rate };
  }

  reset(): void {
    this.nextFree = 0;
  }
}
