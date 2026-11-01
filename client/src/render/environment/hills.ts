/**
 * Karst hills (the Carso above Trieste) as a backdrop beyond the playable map
 * (DevFridge Game Builder v1.10.0: threejs-landscape — polar grid denser near, domain warp before
 * octaves, ridge amplitude growing with distance, colour from slope and height, one draw call).
 * Land side only: +x is east in the OSM bake, the Gulf of Trieste is to the west.
 */
import * as THREE from 'three';

/** Deterministic value noise. */
function hash(x: number, z: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function noise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return (a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v) * 2 - 1;
}
function fbm(x: number, z: number, octaves: number): number {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) { s += amp * noise(x * f, z * f); f *= 2.03; amp *= 0.5; }
  return s;
}
const ridged = (x: number, z: number, octaves: number): number => {
  let s = 0, amp = 0.5, f = 1;
  for (let i = 0; i < octaves; i++) { s += amp * (1 - Math.abs(noise(x * f, z * f))); f *= 2.03; amp *= 0.5; }
  return s;
};

export const HILLS = { innerRadius: 215, outerRadius: 760, arcDeg: 125, angular: 150, radial: 22 } as const;

/** Bearing from +x (east) in radians, in (−π, π]. */
const bearing = (x: number, z: number): number => Math.atan2(z, x);

/**
 * Terrain height (metres) at a world point beyond the map. 0 at the inner ring (a low plain that
 * meets the harbour), rising into the plateau; tapers to sea level at both ends of the arc.
 */
export function hillHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  const t = THREE.MathUtils.clamp((r - HILLS.innerRadius) / (HILLS.outerRadius - HILLS.innerRadius), 0, 1);
  const arc = THREE.MathUtils.degToRad(HILLS.arcDeg);
  const ends = 1 - THREE.MathUtils.smoothstep(Math.abs(bearing(x, z)), arc * 0.7, arc);
  const wx = x + fbm(x * 0.006, z * 0.006, 3) * 60;
  const wz = z + fbm(x * 0.006 + 41, z * 0.006 - 17, 3) * 60;
  const rise = THREE.MathUtils.smoothstep(t, 0.12, 0.75);
  let h = rise * (40 + 85 * t);
  h += rise * fbm(wx * 0.004, wz * 0.004, 5) * 45;
  h += rise * ridged(wx * 0.011, wz * 0.011, 3) * (8 + 26 * t); // ridges scale with distance
  return Math.max(0, h * ends);
}

// Karst palette: grey limestone, olive scrub, dark holm-oak woods; built-up plain near the port.
const ROCK = new THREE.Color(0x8e8c84), SCRUB = new THREE.Color(0x5f6436), WOOD = new THREE.Color(0x3a4628), TOWN = new THREE.Color(0xa99d8b);

export function createHills(): THREE.Mesh {
  const { innerRadius: R0, outerRadius: R1, angular: AN, radial: RN } = HILLS;
  const arc = THREE.MathUtils.degToRad(HILLS.arcDeg);
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let r = 0; r <= RN; r++) {
    const rad = R0 + (R1 - R0) * Math.pow(r / RN, 1.6);
    for (let a = 0; a <= AN; a++) {
      const th = -arc + (2 * arc * a) / AN;
      const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
      pos.push(x, hillHeight(x, z), z);
    }
  }
  const W = AN + 1;
  for (let r = 0; r < RN; r++) for (let a = 0; a < AN; a++) {
    const a0 = r * W + a, a1 = a0 + 1, b0 = a0 + W, b1 = b0 + 1;
    idx.push(a0, b1, b0, a0, a1, b1); // winding checked: faces point up (see hills.test.ts)
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const nor = geo.getAttribute('normal');
  const c = new THREE.Color();
  for (let i = 0; i < nor.count; i++) {
    const x = pos[i * 3]!, y = pos[i * 3 + 1]!, z = pos[i * 3 + 2]!;
    const slope = 1 - nor.getY(i);
    const moist = THREE.MathUtils.smoothstep(fbm(x * 0.01 + 7, z * 0.01, 3), -0.2, 0.4);
    c.copy(WOOD).lerp(SCRUB, 0.55 - moist * 0.5).lerp(ROCK, THREE.MathUtils.clamp(slope * 2.4 + (y > 120 ? 0.15 : 0), 0, 0.85));
    c.lerp(TOWN, 1 - THREE.MathUtils.smoothstep(y, 2, 18)); // low plain near the port: built-up
    col.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
  mesh.name = 'hills';
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  return mesh;
}
