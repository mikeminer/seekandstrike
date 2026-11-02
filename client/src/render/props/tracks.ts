/**
 * Render-only railway track (no collision: 14 cm tall, players walk over it): ballast bed, sleepers every
 * 0.65 m and two steel rails at standard gauge. Merged into 3 meshes for the whole map.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface TrackLayout { xs: number[]; z0: number; z1: number }

/** Tracks of the maps that have them (map id → layout). */
export const MAP_TRACKS: Record<string, TrackLayout> = {
  'scalo-ferroviario': { xs: [-15, -5, 5, 15], z0: -41.5, z1: 41.5 },
};

const GAUGE = 1.435;
const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.deleteAttribute('uv');
  return g.translate(cx, cy, cz);
};

export function trackGeometry(t: TrackLayout): { ballast: THREE.BufferGeometry[]; sleepers: THREE.BufferGeometry[]; rails: THREE.BufferGeometry[] } {
  const len = t.z1 - t.z0, cz = (t.z0 + t.z1) / 2;
  const ballast: THREE.BufferGeometry[] = [], sleepers: THREE.BufferGeometry[] = [], rails: THREE.BufferGeometry[] = [];
  for (const x of t.xs) {
    ballast.push(box(x, 0.02, cz, 3.0, 0.04, len));
    for (let z = t.z0 + 0.3; z < t.z1 - 0.3; z += 0.65) sleepers.push(box(x, 0.06, z, 2.5, 0.08, 0.24));
    for (const s of [-1, 1]) rails.push(box(x + (s * GAUGE) / 2, 0.12, cz, 0.07, 0.08, len));
  }
  return { ballast, sleepers, rails };
}

export function buildTracks(t: TrackLayout): THREE.Group {
  const g = new THREE.Group();
  g.name = 'tracks';
  const parts = trackGeometry(t);
  const add = (geos: THREE.BufferGeometry[], mat: THREE.Material): void => {
    const merged = mergeGeometries(geos, false)!;
    for (const x of geos) x.dispose();
    const m = new THREE.Mesh(merged, mat);
    m.receiveShadow = true;
    g.add(m);
  };
  add(parts.ballast, new THREE.MeshStandardMaterial({ color: 0x6b645a, roughness: 1 }));
  add(parts.sleepers, new THREE.MeshStandardMaterial({ color: 0x4a3a2c, roughness: 0.9 }));
  add(parts.rails, new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.35, metalness: 0.85 }));
  return g;
}
