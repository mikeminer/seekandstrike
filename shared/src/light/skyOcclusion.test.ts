import { describe, expect, it } from 'vitest';
import { OcclusionField, aabbsFromSimBoxes, type Aabb } from './skyOcclusion';

const box = (minX: number, maxX: number, minZ: number, maxZ: number, maxY: number): Aabb => ({ minX, maxX, minY: 0, maxY, minZ, maxZ });

describe('sky occlusion', () => {
  it('open ground sees the whole sky', () => {
    const f = new OcclusionField([box(100, 110, 100, 110, 10)]);
    expect(f.visibility(0, 0, 0, 0, 1, 0)).toBe(1);
  });

  it('ground at the foot of a tall wall is darker than ground far from it, monotonically', () => {
    const f = new OcclusionField([box(0, 10, -50, 50, 20)]);
    const at = (x: number): number => f.visibility(x, 0, 0, 0, 1, 0);
    expect(at(10.2)).toBeLessThan(at(14));
    expect(at(14)).toBeLessThan(at(22));
    expect(at(10.2)).toBeGreaterThan(0.4); // a single wall hides at most half the hemisphere
    expect(at(40)).toBe(1);
  });

  it('a street canyon is darker than a single wall', () => {
    const one = new OcclusionField([box(0, 10, -50, 50, 15)]);
    const two = new OcclusionField([box(0, 10, -50, 50, 15), box(16, 26, -50, 50, 15)]);
    expect(two.visibility(13, 0, 0, 0, 1, 0)).toBeLessThan(one.visibility(13, 0, 0, 0, 1, 0));
  });

  it('a wall facing open space is lit, a wall facing a neighbour is occluded', () => {
    const f = new OcclusionField([box(0, 10, -30, 30, 12), box(14, 24, -30, 30, 12)]);
    const facingNeighbour = f.visibility(10, 2, 0, 1, 0, 0);
    const facingOpen = f.visibility(0, 2, 0, -1, 0, 0);
    expect(facingNeighbour).toBeLessThan(facingOpen);
    expect(facingOpen).toBe(1);
  });

  it('is deterministic and ignores slabs at or below ground', () => {
    const boxes = aabbsFromSimBoxes([
      { c: { x: 0, y: -3, z: 0 }, s: { x: 200, y: 6, z: 200 } },
      { c: { x: 5, y: 5, z: 0 }, s: { x: 4, y: 10, z: 4 } },
    ]);
    expect(boxes).toHaveLength(1);
    const f = new OcclusionField(boxes);
    expect(f.visibility(8, 0, 0, 0, 1, 0)).toBe(f.visibility(8, 0, 0, 0, 1, 0));
  });
});

describe('baked ground lightmap of Porto Vecchio', () => {
  it('was baked from the colliders now shipped (re-run tools/light-bake when they change)', async () => {
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const dir = new URL('../../../public/assets/maps/porto-vecchio/', import.meta.url);
    const meta = JSON.parse(readFileSync(new URL('ground-ao.json', dir), 'utf8')) as { collidersSha256: string; size: number };
    const sha = createHash('sha256').update(readFileSync(new URL('colliders.json', dir))).digest('hex');
    expect(meta.collidersSha256).toBe(sha);
    const png = readFileSync(new URL('ground-ao.png', dir));
    expect(png.subarray(1, 4).toString('ascii')).toBe('PNG');
    expect(png.readUInt32BE(16)).toBe(meta.size);
  });
});
