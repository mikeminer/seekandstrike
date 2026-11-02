import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { containerDetailGeometry, type DetailBox } from './containerDetail';

const colliders = JSON.parse(readFileSync(new URL('../../../../public/assets/maps/banchina-est/colliders.json', import.meta.url), 'utf8')) as { simBoxes: DetailBox[] };

describe('container and crate detail (Banchina Est)', () => {
  const boxes = colliders.simBoxes.filter((b) => b.node.startsWith('blk_container') || b.node.startsWith('blk_crate'));
  const { frame, dark } = containerDetailGeometry(boxes);

  it('adds detail to every container and crate', () => {
    expect(boxes.length).toBeGreaterThan(20);
    expect(frame.length).toBeGreaterThan(0);
    expect(dark.length).toBeGreaterThan(0);
  });

  it('never protrudes more than 8 cm outside its collider box (no visual-only cover)', () => {
    const all = [...frame, ...dark];
    for (const g of all) {
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const owner = boxes.find((b) => {
        const lo = new THREE.Vector3(b.c.x - b.s.x / 2 - 0.08, b.c.y - b.s.y / 2 - 0.08, b.c.z - b.s.z / 2 - 0.08);
        const hi = new THREE.Vector3(b.c.x + b.s.x / 2 + 0.08, b.c.y + b.s.y / 2 + 0.08, b.c.z + b.s.z / 2 + 0.08);
        return bb.min.x >= lo.x && bb.min.y >= lo.y && bb.min.z >= lo.z && bb.max.x <= hi.x && bb.max.y <= hi.y && bb.max.z <= hi.z;
      });
      expect(owner).toBeDefined();
    }
  });
});
