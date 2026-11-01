/**
 * Stone pine (Pinus pinea) grown as a branch hierarchy, after DevFridge Game Builder v1.10.0
 * threejs-procedural-vegetation (structured growth model): a per-level species table, iterative
 * growth from a queue, a terminal continuation plus stratified lateral children with independently
 * permuted azimuth slots, section evolution (seeded gnarliness amplified on thin branches, twist,
 * rotation toward a growth force), taper coupled to the parent radius, leaves (needle tufts) only
 * after the branch topology is final, leaf-only rooted wind (`leafT` = 0 at the card root).
 *
 * Intentional divergences from the ash contract: our own species table (umbrella crown on a clear
 * trunk), needle-tuft cards drawn from a procedural canvas instead of the ash alpha texture, and
 * real-distance bark V instead of the alternating ring V. Sizes are in metres.
 */
import * as THREE from 'three';

export interface SpeciesLevel {
  length: number; radius: number; sections: number; segments: number;
  angleDeg: number; children: number; start: number; gnarliness: number; twist: number;
}

/** Pinus pinea: clear trunk to ~55 %, a few strong limbs rising outward, flat-topped crown. */
export const PINE_SPECIES: { levels: SpeciesLevel[]; taper: number; force: THREE.Vector3; forceStrength: number; leaves: { count: number; start: number; angleDeg: number; size: number; variance: number } } = {
  levels: [
    { length: 8.5, radius: 0.26, sections: 7, segments: 6, angleDeg: 0, children: 4, start: 0, gnarliness: 0.04, twist: 0.08 },
    { length: 5.2, radius: 0.55, sections: 4, segments: 5, angleDeg: 64, children: 2, start: 0.6, gnarliness: 0.14, twist: -0.06 },
    { length: 2.8, radius: 0.6, sections: 3, segments: 4, angleDeg: 62, children: 2, start: 0.35, gnarliness: 0.16, twist: 0 },
    { length: 1.3, radius: 0.6, sections: 2, segments: 3, angleDeg: 50, children: 0, start: 0.25, gnarliness: 0.1, twist: 0 },
  ],
  taper: 0.7,
  force: new THREE.Vector3(0, 1, 0),
  forceStrength: 0.006,
  leaves: { count: 3, start: 0.2, angleDeg: 35, size: 2.2, variance: 0.2 },
};

/** Mulberry32: tiny seeded RNG (species identity stays, seeds only vary the individual). */
export function rng(seed: number): { value: (max?: number, min?: number) => number; shuffled: (n: number) => number[] } {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    value: (max = 1, min = 0) => min + (max - min) * next(),
    shuffled: (n) => {
      const out = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [out[i], out[j]] = [out[j]!, out[i]!]; }
      return out;
    },
  };
}

interface Section { origin: THREE.Vector3; q: THREE.Quaternion; radius: number }
interface Job { origin: THREE.Vector3; q: THREE.Quaternion; length: number; radius: number; level: number; sections: number; segments: number; continuation: boolean }

function interpolate(sections: Section[], t: number): Section {
  const f = THREE.MathUtils.clamp(t, 0, 1) * (sections.length - 1);
  const i = Math.min(sections.length - 2, Math.floor(f)), alpha = f - i;
  const a = sections[i]!, b = sections[i + 1]!;
  return {
    origin: a.origin.clone().lerp(b.origin, alpha),
    radius: THREE.MathUtils.lerp(a.radius, b.radius, alpha),
    q: b.q.clone().slerp(a.q, 1 - alpha), // contract: start from B, slerp toward A
  };
}

export interface PineStats { branchJobs: number[]; continuations: number[]; lateral: number[]; leafCards: number; barkTriangles: number; leafTriangles: number }

/** Grows one pine; returns bark and needle geometries (tree base at the origin). */
export function growPine(seed: number): { bark: THREE.BufferGeometry; leaves: THREE.BufferGeometry; stats: PineStats } {
  const sp = PINE_SPECIES, L = sp.levels, last = L.length - 1;
  const r = rng(seed);
  const bp: number[] = [], bn: number[] = [], buv: number[] = [], bi: number[] = [];
  const lp: number[] = [], ln: number[] = [], luv: number[] = [], lt: number[] = [], li: number[] = [];
  const stats: PineStats = { branchJobs: L.map(() => 0), continuations: L.map(() => 0), lateral: L.map(() => 0), leafCards: 0, barkTriangles: 0, leafTriangles: 0 };
  const up = new THREE.Vector3(0, 1, 0);
  const jobs: Job[] = [{ origin: new THREE.Vector3(), q: new THREE.Quaternion(), length: L[0]!.length * r.value(1.1, 0.9), radius: L[0]!.radius, level: 0, sections: L[0]!.sections, segments: L[0]!.segments, continuation: true }];

  const orient = (parent: THREE.Quaternion, azimuth: number, tiltDeg: number): THREE.Quaternion =>
    parent.clone().multiply(new THREE.Quaternion().setFromAxisAngle(up, azimuth).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), THREE.MathUtils.degToRad(tiltDeg))));

  const emitLeaf = (origin: THREE.Vector3, q: THREE.Quaternion): void => {
    const size = sp.leaves.size * (1 + r.value(sp.leaves.variance, -sp.leaves.variance));
    const cardNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
    for (const rot of [0, Math.PI / 2]) {
      const base = lp.length / 3;
      const local = [[-0.5, 1], [-0.5, 0], [0.5, 0], [0.5, 1]] as const;
      for (const [x, y] of local) {
        const v = new THREE.Vector3(x * size, y * size, 0).applyAxisAngle(up, rot).applyQuaternion(q).add(origin);
        const n = cardNormal.clone().add(v.clone().sub(origin)).normalize(); // rounded crown normal
        lp.push(v.x, v.y, v.z); ln.push(n.x, n.y, n.z); luv.push(x + 0.5, y); lt.push(y);
      }
      li.push(base, base + 1, base + 2, base, base + 2, base + 3);
      stats.leafCards++;
    }
  };

  while (jobs.length) {
    const b = jobs.shift()!;
    const spec = L[b.level]!;
    stats.branchJobs[b.level]!++;
    if (b.continuation) stats.continuations[b.level]!++;
    const sections: Section[] = [];
    const q = b.q.clone();
    const origin = b.origin.clone();
    const segLen = b.length / b.sections;
    const ringStart = bp.length / 3;
    let vAlong = 0;
    for (let s = 0; s <= b.sections; s++) {
      let radius = b.radius * (1 - sp.taper * (s / b.sections));
      if (s === b.sections && b.level === last) radius = 0.002;
      for (let k = 0; k <= b.segments; k++) { // duplicated seam vertex
        const ang = (k / b.segments) * Math.PI * 2;
        const local = new THREE.Vector3(Math.cos(ang) * radius, 0, Math.sin(ang) * radius).applyQuaternion(q);
        bp.push(origin.x + local.x, origin.y + local.y, origin.z + local.z);
        const n = local.clone().normalize(); bn.push(n.x, n.y, n.z);
        buv.push((k / b.segments) * Math.max(1, Math.round(b.radius * 12)), vAlong / 1.2);
      }
      sections.push({ origin: origin.clone(), q: q.clone(), radius });
      if (s === b.sections) break;
      origin.add(new THREE.Vector3(0, segLen, 0).applyQuaternion(q));
      vAlong += segLen;
      const g = Math.max(1, 1 / Math.sqrt(Math.max(radius, 1e-3))) * spec.gnarliness;
      const e = new THREE.Euler().setFromQuaternion(q);
      e.x += r.value(g, -g); e.z += r.value(g, -g);
      q.setFromEuler(e).multiply(new THREE.Quaternion().setFromAxisAngle(up, spec.twist));
      const localUp = up.clone().applyQuaternion(q);
      const maxStep = localUp.angleTo(sp.force);
      const step = Math.min(sp.forceStrength / Math.max(radius, 1e-3), maxStep);
      if (step > 1e-6) {
        const axis = new THREE.Vector3().crossVectors(localUp, sp.force);
        if (axis.lengthSq() > 1e-10) q.premultiply(new THREE.Quaternion().setFromAxisAngle(axis.normalize(), step));
      }
    }
    const ring = b.segments + 1;
    for (let s = 0; s < b.sections; s++) for (let k = 0; k < b.segments; k++) {
      const a0 = ringStart + s * ring + k, a1 = a0 + 1, c0 = a0 + ring, c1 = c0 + 1;
      bi.push(a0, c0, a1, a1, c0, c1);
    }

    if (b.level === last) {
      // Leaves only after topology: along every final-level branch, stratified + permuted slots.
      const n = sp.leaves.count, off = r.value(), slots = r.shuffled(n), stepL = (1 - sp.leaves.start) / n;
      for (let i = 0; i < n; i++) {
        const at = interpolate(sections, sp.leaves.start + (i + r.value()) * stepL);
        emitLeaf(at.origin, orient(at.q, Math.PI * 2 * (off + (slots[i]! + r.value(0.5, -0.5)) / n), sp.leaves.angleDeg));
      }
      continue;
    }
    const next = b.level + 1, ns = L[next]!;
    // Terminal continuation inherits the tip section and the parent's ring counts.
    const tip = sections[sections.length - 1]!;
    jobs.push({ origin: tip.origin.clone(), q: tip.q.clone(), length: ns.length, radius: tip.radius, level: next, sections: b.sections, segments: b.segments, continuation: true });
    const n = spec.children, off = r.value(), slots = r.shuffled(n), stepC = (1 - ns.start) / Math.max(1, n);
    for (let i = 0; i < n; i++) {
      const at = interpolate(sections, ns.start + (i + r.value()) * stepC);
      jobs.push({
        origin: at.origin, q: orient(at.q, Math.PI * 2 * (off + (slots[i]! + r.value(0.5, -0.5)) / n), ns.angleDeg),
        length: ns.length * r.value(1.15, 0.85), radius: ns.radius * at.radius, level: next, sections: ns.sections, segments: ns.segments, continuation: false,
      });
      stats.lateral[next]!++;
    }
  }

  const bark = new THREE.BufferGeometry();
  bark.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
  bark.setAttribute('normal', new THREE.Float32BufferAttribute(bn, 3));
  bark.setAttribute('uv', new THREE.Float32BufferAttribute(buv, 2));
  bark.setIndex(bi);
  const leaves = new THREE.BufferGeometry();
  leaves.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  leaves.setAttribute('normal', new THREE.Float32BufferAttribute(ln, 3));
  leaves.setAttribute('uv', new THREE.Float32BufferAttribute(luv, 2));
  leaves.setAttribute('leafT', new THREE.Float32BufferAttribute(lt, 1));
  leaves.setIndex(li);
  stats.barkTriangles = bi.length / 3;
  stats.leafTriangles = li.length / 3;
  bark.computeBoundingSphere(); leaves.computeBoundingSphere();
  return { bark, leaves, stats };
}
