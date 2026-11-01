import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { compileArchitecture, SLOTS } from './compile';
import { TRIM_MAX_PROJECTION, massFromSimBoxes, planBuildings, type MassRect } from './plan';

const colliders = JSON.parse(readFileSync(new URL('../../../../public/assets/maps/porto-vecchio/colliders.json', import.meta.url), 'utf8')) as { simBoxes: Parameters<typeof massFromSimBoxes>[0] };
const mass = massFromSimBoxes(colliders.simBoxes);
const plans = planBuildings(mass);
const out = compileArchitecture(plans);

/** Distance from a point to the nearest mass box (0 inside). */
function outside(p: THREE.Vector3, rects: readonly MassRect[]): number {
  let best = Infinity;
  for (const r of rects) {
    const dx = Math.max(r.minX - p.x, 0, p.x - r.maxX);
    const dz = Math.max(r.minZ - p.z, 0, p.z - r.maxZ);
    const dy = Math.max(0 - p.y, 0, p.y - r.top);
    best = Math.min(best, Math.hypot(dx, dy, dz));
  }
  return best;
}

describe('material-slot compiler on Porto Vecchio', () => {
  it('emits at most one geometry per slot, all indexed and non-empty', () => {
    const present = SLOTS.filter((s) => out.geometries[s]);
    expect(present).toEqual(['wall', 'stone', 'window', 'roof']);
    for (const s of present) {
      const g = out.geometries[s]!;
      expect(g.index!.count % 3).toBe(0);
      expect(g.getAttribute('position').count).toBe(g.getAttribute('uv').count);
    }
  });

  it('every triangle faces its stored normal (no inside-out faces)', () => {
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
    for (const s of SLOTS) {
      const g = out.geometries[s]!;
      const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), idx = g.index!;
      for (let i = 0; i < idx.count; i += 3) {
        a.fromBufferAttribute(pos, idx.getX(i)); b.fromBufferAttribute(pos, idx.getX(i + 1)); c.fromBufferAttribute(pos, idx.getX(i + 2));
        n.fromBufferAttribute(nor, idx.getX(i));
        const face = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
        if (face.lengthSq() < 1e-12) continue;
        expect(face.dot(n)).toBeGreaterThan(0);
      }
    }
  });

  it('never extends more than the trim projection outside the collision boxes', () => {
    const p = new THREE.Vector3();
    let worst = 0;
    for (const s of SLOTS) {
      const pos = out.geometries[s]!.getAttribute('position');
      for (let i = 0; i < pos.count; i++) worst = Math.max(worst, outside(p.fromBufferAttribute(pos, i), mass));
    }
    // Float32 positions near 100 m have ~8 µm resolution.
    expect(worst).toBeLessThanOrEqual(TRIM_MAX_PROJECTION + 1e-4);
  });

  it('reports a bounded triangle budget for the Seeker (4 draw calls)', () => {
    const total = SLOTS.reduce((s, k) => s + out.triangles[k], 0);
    console.info('architecture triangles', JSON.stringify(out.triangles), 'total', total, 'modules', JSON.stringify(out.modules));
    expect(total).toBeLessThan(60_000);
    expect(out.modules.window).toBeGreaterThan(1000);
  });
});
