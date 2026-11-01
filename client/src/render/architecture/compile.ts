/**
 * Procedural warehouse architecture — the COMPILE stage: plan → one BufferGeometry per material slot
 * (skill: threejs-procedural-architecture, "compile by material slot to reduce draw calls without
 * destroying material separation"). UVs are in world metres / tile so texel density stays physical.
 */
import * as THREE from 'three';
import { PLASTER_PALETTE, type BuildingPlan, type FacadeEdge, type Placement, type Side } from './plan';

export type Slot = 'wall' | 'stone' | 'window' | 'roof';
export const SLOTS: readonly Slot[] = ['wall', 'stone', 'window', 'roof'];
/** Metres per texture repeat for each slot. */
export const SLOT_TILE: Record<Slot, number> = { wall: 3, stone: 1.5, window: 2, roof: 2.5 };
const STONE_COLOR = 0xe6dfd0;
const GLASS_COLOR = 0x1b2226;
const ROOF_COLOR = 0x8a4f3a;
const ARCH_SEGMENTS = 6;

/** Sky visibility in [0, 1] at a surface point and normal (shared/src/light/skyOcclusion.ts). */
export type Occlusion = (x: number, y: number, z: number, nx: number, ny: number, nz: number) => number;

class SlotWriter {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; idx: number[] = []; ao: number[] = [];
  constructor(private readonly occlusion?: Occlusion) {}
  private aoAt(v: THREE.Vector3, n: THREE.Vector3): number { return this.occlusion ? this.occlusion(v.x, v.y, v.z, n.x, n.y, n.z) : 1; }
  get triangles(): number { return this.idx.length / 3; }

  /** Quad p0..p3 (any winding); made to face `n`. */
  quad(p: THREE.Vector3[], n: THREE.Vector3, uvs: [number, number][], color: THREE.Color): void {
    const base = this.pos.length / 3;
    for (let i = 0; i < 4; i++) {
      this.pos.push(p[i]!.x, p[i]!.y, p[i]!.z);
      this.nor.push(n.x, n.y, n.z);
      this.uv.push(uvs[i]![0], uvs[i]![1]);
      this.col.push(color.r, color.g, color.b);
      this.ao.push(this.aoAt(p[i]!, n));
    }
    const e1 = new THREE.Vector3().subVectors(p[1]!, p[0]!), e2 = new THREE.Vector3().subVectors(p[2]!, p[0]!);
    const front = e1.cross(e2).dot(n) >= 0;
    if (front) this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else this.idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }

  /** Triangle fan facing `n`. */
  fan(center: THREE.Vector3, ring: THREE.Vector3[], n: THREE.Vector3, uvOf: (v: THREE.Vector3) => [number, number], color: THREE.Color): void {
    const base = this.pos.length / 3;
    for (const v of [center, ...ring]) {
      this.pos.push(v.x, v.y, v.z); this.nor.push(n.x, n.y, n.z);
      const [u, w] = uvOf(v); this.uv.push(u, w); this.col.push(color.r, color.g, color.b); this.ao.push(this.aoAt(v, n));
    }
    for (let i = 0; i + 1 < ring.length; i++) {
      const a = base + 1 + i, b = base + 2 + i;
      const e1 = new THREE.Vector3().subVectors(ring[i]!, center), e2 = new THREE.Vector3().subVectors(ring[i + 1]!, center);
      if (e1.cross(e2).dot(n) >= 0) this.idx.push(base, a, b); else this.idx.push(base, b, a);
    }
  }

  geometry(): THREE.BufferGeometry | null {
    if (!this.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    if (this.occlusion) g.setAttribute('ao', new THREE.Float32BufferAttribute(this.ao, 1));
    g.setIndex(this.idx);
    g.computeBoundingSphere();
    return g;
  }
}

/** Local façade frame: u along the wall, y up, w out of the wall. */
function frame(side: Side, plane: number): { at: (u: number, y: number, w: number) => THREE.Vector3; out: THREE.Vector3; along: THREE.Vector3 } {
  switch (side) {
    case '+x': return { at: (u, y, w) => new THREE.Vector3(plane + w, y, u), out: new THREE.Vector3(1, 0, 0), along: new THREE.Vector3(0, 0, 1) };
    case '-x': return { at: (u, y, w) => new THREE.Vector3(plane - w, y, u), out: new THREE.Vector3(-1, 0, 0), along: new THREE.Vector3(0, 0, 1) };
    case '+z': return { at: (u, y, w) => new THREE.Vector3(u, y, plane + w), out: new THREE.Vector3(0, 0, 1), along: new THREE.Vector3(1, 0, 0) };
    case '-z': return { at: (u, y, w) => new THREE.Vector3(u, y, plane - w), out: new THREE.Vector3(0, 0, -1), along: new THREE.Vector3(1, 0, 0) };
  }
}

/** Wall piece; split into ~cell-sized quads when baking occlusion so the AO has vertices to live on. */
function wallQuad(w: SlotWriter, e: FacadeEdge, a: number, b: number, y0: number, y1: number, off: number, color: THREE.Color, tile: number, cell: number): void {
  const f = frame(e.side, e.plane);
  const nu = Math.max(1, Math.ceil((b - a) / cell)), nv = Math.max(1, Math.ceil((y1 - y0) / cell));
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const ua = a + ((b - a) * i) / nu, ub = a + ((b - a) * (i + 1)) / nu;
    const va = y0 + ((y1 - y0) * j) / nv, vb = y0 + ((y1 - y0) * (j + 1)) / nv;
    w.quad([f.at(ua, va, off), f.at(ub, va, off), f.at(ub, vb, off), f.at(ua, vb, off)], f.out,
      [[ua / tile, va / tile], [ub / tile, va / tile], [ub / tile, vb / tile], [ua / tile, vb / tile]], color);
  }
}

/** Box module standing out of the wall: front, top, bottom and both ends (the back is inside the wall). */
function trimBox(w: SlotWriter, e: FacadeEdge, p: Placement, color: THREE.Color, tile: number): void {
  const f = frame(e.side, e.plane);
  const d = p.projection, { a, b, y0, y1 } = p;
  const up = new THREE.Vector3(0, 1, 0), down = new THREE.Vector3(0, -1, 0);
  const t = (x: number): number => x / tile;
  w.quad([f.at(a, y0, d), f.at(b, y0, d), f.at(b, y1, d), f.at(a, y1, d)], f.out, [[t(a), t(y0)], [t(b), t(y0)], [t(b), t(y1)], [t(a), t(y1)]], color);
  w.quad([f.at(a, y1, 0), f.at(b, y1, 0), f.at(b, y1, d), f.at(a, y1, d)], up, [[t(a), 0], [t(b), 0], [t(b), t(d)], [t(a), t(d)]], color);
  w.quad([f.at(a, y0, 0), f.at(b, y0, 0), f.at(b, y0, d), f.at(a, y0, d)], down, [[t(a), 0], [t(b), 0], [t(b), t(d)], [t(a), t(d)]], color);
  const endA = f.along.clone().negate(), endB = f.along.clone();
  w.quad([f.at(a, y0, 0), f.at(a, y0, d), f.at(a, y1, d), f.at(a, y1, 0)], endA, [[0, t(y0)], [t(d), t(y0)], [t(d), t(y1)], [0, t(y1)]], color);
  w.quad([f.at(b, y0, 0), f.at(b, y0, d), f.at(b, y1, d), f.at(b, y1, 0)], endB, [[0, t(y0)], [t(d), t(y0)], [t(d), t(y1)], [0, t(y1)]], color);
}

/** Flat glass opening a few centimetres proud of the wall; arched head when the style asks for it. */
function windowPane(w: SlotWriter, e: FacadeEdge, p: Placement, color: THREE.Color, tile: number): void {
  const f = frame(e.side, e.plane);
  const { a, b, y0, y1 } = p, d = p.projection;
  const r = (b - a) / 2, cu = (a + b) / 2;
  const arched = p.arched === true && y1 - y0 > r * 2;
  const spring = arched ? y1 - r : y1;
  const t = (x: number): number => x / tile;
  w.quad([f.at(a, y0, d), f.at(b, y0, d), f.at(b, spring, d), f.at(a, spring, d)], f.out, [[t(a), t(y0)], [t(b), t(y0)], [t(b), t(spring)], [t(a), t(spring)]], color);
  if (!arched) return;
  const ring: THREE.Vector3[] = [];
  for (let i = 0; i <= ARCH_SEGMENTS; i++) {
    const ang = Math.PI * (i / ARCH_SEGMENTS);
    ring.push(f.at(cu + r * Math.cos(ang), spring + r * Math.sin(ang), d));
  }
  w.fan(f.at(cu, spring, d), ring, f.out, (v) => [t(v.dot(f.along)), t(v.y)], color);
}

export interface CompiledArchitecture {
  geometries: Partial<Record<Slot, THREE.BufferGeometry>>;
  triangles: Record<Slot, number>;
  modules: Record<string, number>;
}

/** Compiles every plan into at most one geometry per slot (≤ 4 draw calls for all buildings). */
export function compileArchitecture(plans: readonly BuildingPlan[], occlusion?: Occlusion): CompiledArchitecture {
  // Roofs see open sky: no occlusion there. Walls are split only when occlusion is baked.
  const writers: Record<Slot, SlotWriter> = { wall: new SlotWriter(occlusion), stone: new SlotWriter(occlusion), window: new SlotWriter(occlusion), roof: new SlotWriter() };
  const cell = occlusion ? 2.2 : Infinity;
  const stone = new THREE.Color(STONE_COLOR), glass = new THREE.Color(GLASS_COLOR), roof = new THREE.Color(ROOF_COLOR);
  const modules: Record<string, number> = {};
  for (const plan of plans) {
    const plaster = new THREE.Color(PLASTER_PALETTE[plan.style.plaster]!);
    const edges = new Map(plan.edges.map((e) => [e.id, e]));
    // Mass closure: exposed walls and roof caps only (hidden faces are never emitted).
    for (const e of plan.edges) wallQuad(writers.wall, e, e.a, e.b, e.y0, e.y1, 0, plaster, SLOT_TILE.wall, cell);
    for (const r of plan.rects) {
      const t = SLOT_TILE.roof;
      writers.roof.quad(
        [new THREE.Vector3(r.minX, r.top, r.minZ), new THREE.Vector3(r.maxX, r.top, r.minZ), new THREE.Vector3(r.maxX, r.top, r.maxZ), new THREE.Vector3(r.minX, r.top, r.maxZ)],
        new THREE.Vector3(0, 1, 0), [[r.minX / t, r.minZ / t], [r.maxX / t, r.minZ / t], [r.maxX / t, r.maxZ / t], [r.minX / t, r.maxZ / t]], roof);
    }
    for (const p of plan.placements) {
      const e = edges.get(p.edge)!;
      modules[p.kind] = (modules[p.kind] ?? 0) + 1;
      if (p.kind === 'window') windowPane(writers.window, e, p, glass, SLOT_TILE.window);
      else trimBox(writers.stone, e, p, stone, SLOT_TILE.stone);
    }
  }
  const geometries: Partial<Record<Slot, THREE.BufferGeometry>> = {};
  const triangles = {} as Record<Slot, number>;
  for (const s of SLOTS) {
    triangles[s] = writers[s].triangles;
    const g = writers[s].geometry();
    if (g) geometries[s] = g;
  }
  return { geometries, triangles, modules };
}
