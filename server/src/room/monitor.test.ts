import { describe, expect, it } from 'vitest';
import { MONITOR, SeatMonitor } from './monitor';

describe('command rate (token bucket)', () => {
  it('accepts normal 60 Hz traffic without dropping anything', () => {
    const m = new SeatMonitor(0);
    for (let t = 0; t < 10_000; t += 66) expect(m.admit(t, 4)).toBe(4); // 4 commands per 66 ms
    expect(m.stats.dropped).toBe(0);
    expect(m.kicked).toBe(false);
  });
  it('accepts a burst after a stall (up to about two seconds of commands)', () => {
    const m = new SeatMonitor(0);
    expect(m.admit(0, MONITOR.burst)).toBe(MONITOR.burst);
    expect(m.admit(0, 10)).toBe(0); // the bucket is empty now
  });
  it('drops the excess of a flood and kicks a sustained one', () => {
    const m = new SeatMonitor(0);
    let t = 0;
    let kickedAt = -1;
    for (let i = 0; i < 200 && kickedAt < 0; i++) {
      t += 66;
      m.admit(t, 10); // 10 commands per 66 ms = 150/s, twice the real rate
      if (m.kicked) kickedAt = t;
    }
    expect(m.stats.dropped).toBeGreaterThan(0);
    expect(kickedAt).toBeGreaterThan(0);
    expect(kickedAt).toBeLessThan(15_000);
  });
  it('a short overshoot is forgiven (the flood score decays)', () => {
    const m = new SeatMonitor(0);
    m.admit(0, MONITOR.burst + 100); // 100 dropped at once
    expect(m.kicked).toBe(false);
    for (let t = 1000; t < 20_000; t += 1000) m.admit(t, 40);
    expect(m.kicked).toBe(false);
  });
});

describe('speed and view time', () => {
  it('flags speeds above the physical maximum only', () => {
    const m = new SeatMonitor(0);
    expect(m.checkSpeed(4.2)).toBe(false);
    expect(m.checkSpeed(6.4)).toBe(false); // sprint
    expect(m.checkSpeed(MONITOR.maxSpeed + 0.1)).toBe(true);
    expect(m.stats.speedViolations).toBe(1);
    expect(m.stats.maxSpeed).toBeGreaterThan(MONITOR.maxSpeed);
  });
});

describe('aim statistics (soft flags, never a kick)', () => {
  const run = (shots: number, hits: number, heads: number): SeatMonitor => {
    const m = new SeatMonitor(0);
    for (let i = 0; i < hits; i++) m.hit(i < heads);
    for (let i = 0; i < shots; i++) m.shot();
    return m;
  };
  it('a normal player is not flagged', () => {
    expect(run(40, 14, 2).stats.aimFlags).toBe(0);
    expect(run(40, 25, 4).stats.aimFlags).toBe(0);
  });
  it('near-perfect accuracy over a window is flagged', () => {
    expect(run(40, 37, 5).stats.aimFlags).toBe(1);
  });
  it('a headshot ratio that high over many hits is flagged', () => {
    expect(run(40, 24, 20).stats.aimFlags).toBe(1);
  });
  it('never sets the kick flag', () => {
    expect(run(400, 400, 400).kicked).toBe(false);
  });
});
