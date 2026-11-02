import { describe, expect, it } from 'vitest';
import { LOOK, WORLD_FOV } from './input';

/** Screen-space speed of the sight while aiming, relative to hip fire, for the same finger/mouse movement. */
const aimedScreenSpeed = (): number => {
  const half = (deg: number): number => Math.tan((deg * Math.PI) / 360);
  return LOOK.adsScale * (half(WORLD_FOV.hip) / half(WORLD_FOV.ads));
};

describe('aim sensitivity', () => {
  it('slows the sight on screen while aiming (zoom accounted for), so the red dot is steady', () => {
    const r = aimedScreenSpeed();
    expect(r).toBeGreaterThan(0.5);
    expect(r).toBeLessThan(0.7);
  });
  it('the world zooms in when aiming', () => {
    expect(WORLD_FOV.ads).toBeLessThan(WORLD_FOV.hip);
  });
});
