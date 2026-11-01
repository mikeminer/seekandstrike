import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { PINE_SPECIES, growPine } from './pine';

describe('stone pine growth', () => {
  const tree = growPine(7);

  it('follows the species table: one trunk, continuations on every level, lateral children per slot', () => {
    const s = tree.stats;
    expect(s.branchJobs[0]).toBe(1);
    expect(s.lateral[1]).toBe(PINE_SPECIES.levels[0]!.children);
    expect(s.continuations.every((c) => c >= 1)).toBe(true);
    expect(s.leafCards).toBe(s.branchJobs[3]! * PINE_SPECIES.leaves.count * 2);
  });

  it('stays inside a per-tree triangle budget', () => {
    expect(tree.stats.barkTriangles + tree.stats.leafTriangles).toBeLessThan(2500);
  });

  it('has an umbrella crown on a clear trunk', () => {
    const p = tree.leaves.getAttribute('position');
    const box = new THREE.Box3().setFromBufferAttribute(p as THREE.BufferAttribute);
    expect(box.min.y).toBeGreaterThan(3.5); // no needles low on the trunk
    const crownHeight = box.max.y - box.min.y;
    const crownWidth = Math.max(box.max.x - box.min.x, box.max.z - box.min.z);
    expect(crownWidth).toBeGreaterThan(crownHeight);
  });

  it('roots every leaf card: wind weight is 0 at the base and 1 at the tip', () => {
    const t = tree.leaves.getAttribute('leafT');
    for (let i = 0; i < t.count; i += 4) {
      expect([t.getX(i), t.getX(i + 1), t.getX(i + 2), t.getX(i + 3)]).toEqual([1, 0, 0, 1]);
    }
  });

  it('bark triangles face their outward vertex normals', () => {
    const g = tree.bark, p = g.getAttribute('position'), n = g.getAttribute('normal'), idx = g.index!;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), nn = new THREE.Vector3();
    let good = 0, total = 0;
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(p, idx.getX(i)); b.fromBufferAttribute(p, idx.getX(i + 1)); c.fromBufferAttribute(p, idx.getX(i + 2));
      const f = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (f.lengthSq() < 1e-12) continue;
      nn.fromBufferAttribute(n, idx.getX(i));
      total++; if (f.dot(nn) > 0) good++;
    }
    expect(good / total).toBeGreaterThan(0.95);
  });

  it('seeds vary the individual, not the species', () => {
    const a = growPine(1), b = growPine(2);
    expect(JSON.stringify(growPine(1).stats)).toBe(JSON.stringify(a.stats));
    expect(a.leaves.getAttribute('position').array).not.toEqual(b.leaves.getAttribute('position').array);
    expect(a.stats.branchJobs).toEqual(b.stats.branchJobs);
  });
});
