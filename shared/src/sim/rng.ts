/** Small deterministic PRNG (mulberry32) so sims replay identically on client and server. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(min: number, max: number): number {
    return min + (max - min) * this.next();
  }
  /** Approximately normal (sum of 3 uniforms), mean 0, sd ~1. */
  gauss(): number {
    return (this.next() + this.next() + this.next() - 1.5) * 2;
  }
}
