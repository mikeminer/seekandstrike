import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { HILLS, createHills, hillHeight } from './hills';
import { lateAfternoonSky, sunDirection, hazeColor } from './sky';

describe('sky model', () => {
  it('converts the map environment (azimuth 235°, elevation 22°) to a low south-west sun', () => {
    const d = sunDirection(235, 22);
    expect(d.length()).toBeCloseTo(1);
    expect(d.y).toBeCloseTo(Math.sin(THREE.MathUtils.degToRad(22)));
    expect(d.x).toBeLessThan(0); // west (x is east)
    expect(d.z).toBeGreaterThan(0); // south (z is south)
  });

  it('haze colour is the horizon stop, so distant geometry fades exactly into the sky', () => {
    const m = lateAfternoonSky(sunDirection(235, 22));
    expect(hazeColor(m).equals(m.stops[1])).toBe(true);
    expect(m.hazeDensity).toBeGreaterThan(0);
  });
});

describe('karst hills backdrop', () => {
  it('stays clear of the playable map and of the sea side', () => {
    expect(HILLS.innerRadius).toBeGreaterThan(Math.hypot(140, 150)); // Porto Vecchio corners
    expect(hillHeight(-500, 0)).toBe(0); // west = gulf
    expect(hillHeight(HILLS.innerRadius, 0)).toBeLessThan(2); // low plain at the port
    expect(hillHeight(650, 0)).toBeGreaterThan(40); // plateau to the east
  });

  it('is deterministic', () => {
    expect(hillHeight(400, -120)).toBe(hillHeight(400, -120));
  });

  it('every triangle faces up (no looking at the sky through the ground)', () => {
    const g = createHills().geometry;
    const p = g.getAttribute('position'), idx = g.index!;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    let down = 0;
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(p, idx.getX(i)); b.fromBufferAttribute(p, idx.getX(i + 1)); c.fromBufferAttribute(p, idx.getX(i + 2));
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      if (n.y < 0) down++;
    }
    expect(down).toBe(0);
    expect(idx.count / 3).toBeLessThan(8000); // one cheap draw call
  });
});
