import { describe, expect, it } from 'vitest';
import { Spring } from './spring';

describe('Spring', () => {
  it('returns to rest after a kick and overshoots when under-damped', () => {
    const s = new Spring(9, 0.42);
    s.kick(1);
    let min = 0, max = 0;
    for (let i = 0; i < 240; i++) { s.step(1 / 60, 0); min = Math.min(min, s.x); max = Math.max(max, s.x); }
    expect(max).toBeGreaterThan(0.005);
    expect(min).toBeLessThan(0); // overshoot
    expect(Math.abs(s.x)).toBeLessThan(1e-4);
  });
  it('stays stable with huge dt', () => {
    const s = new Spring(30, 0.2, 5);
    for (let i = 0; i < 50; i++) s.step(0.5, 0);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Math.abs(s.x)).toBeLessThan(5);
  });
});
