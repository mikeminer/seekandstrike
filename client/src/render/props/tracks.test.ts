import { describe, expect, it } from 'vitest';
import { MAP_TRACKS, trackGeometry } from './tracks';

describe('railway tracks (Scalo Ferroviario)', () => {
  it('render-only and low: nothing taller than 16 cm, so they never act as cover', () => {
    const p = trackGeometry(MAP_TRACKS['scalo-ferroviario']!);
    for (const g of [...p.ballast, ...p.sleepers, ...p.rails]) { g.computeBoundingBox(); expect(g.boundingBox!.max.y).toBeLessThanOrEqual(0.16); }
    expect(p.rails).toHaveLength(8);
    expect(p.sleepers.length).toBeGreaterThan(400);
  });
});
