import { describe, expect, it } from 'vitest';
import { createWeapon, RIFLE_R30, tickWeapon } from './weapons';

/** Regression: on the Seeker the sight jumped between two poses because a fully aimed weapon was lowered every other tick. */
describe('aim-down-sights blend', () => {
  const dt = 1 / 60;

  it('reaches 1 and holds it while aim is held (no flicker)', () => {
    const w = createWeapon(RIFLE_R30);
    const seen: number[] = [];
    for (let i = 0; i < 600; i++) { tickWeapon(w, dt, true); seen.push(w.ads); }
    const settled = seen.slice(Math.ceil(RIFLE_R30.adsSeconds / dt) + 1);
    expect(settled.every((a) => a === 1)).toBe(true);
  });

  it('reaches 0 and holds it at the hip', () => {
    const w = createWeapon(RIFLE_R30);
    for (let i = 0; i < 60; i++) tickWeapon(w, dt, true);
    for (let i = 0; i < 600; i++) tickWeapon(w, dt, false);
    expect(w.ads).toBe(0);
  });

  it('eases monotonically in and out over adsSeconds', () => {
    const w = createWeapon(RIFLE_R30);
    let prev = 0;
    for (let i = 0; i < 30; i++) { tickWeapon(w, dt, true); expect(w.ads).toBeGreaterThanOrEqual(prev); prev = w.ads; }
    for (let i = 0; i < 30; i++) { tickWeapon(w, dt, false); expect(w.ads).toBeLessThanOrEqual(prev); prev = w.ads; }
  });
});
