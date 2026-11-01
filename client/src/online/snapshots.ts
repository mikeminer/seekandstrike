import type { Snapshot, SnapPlayer } from '@shared/protocol';

/** Interpolation delay: about two snapshot intervals at 15 Hz, so there are almost always two snapshots to blend. */
export const INTERP_DELAY_MS = 120;
const KEEP = 12;

export interface Sample {
  a: Snapshot;
  b: Snapshot;
  /** Blend factor 0..1 from a to b. */
  t: number;
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
/** Shortest-path angle interpolation (radians). */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export interface Pose { x: number; y: number; z: number; yw: number; pt: number }

/** Recent snapshots with their local receive times. Out-of-order or duplicate ticks are dropped. */
export class SnapshotBuffer {
  private items: { s: Snapshot; at: number }[] = [];

  push(s: Snapshot, at: number): boolean {
    const last = this.items[this.items.length - 1];
    if (last && s.tick <= last.s.tick) return false;
    this.items.push({ s, at });
    if (this.items.length > KEEP) this.items.shift();
    return true;
  }

  get latest(): Snapshot | null { return this.items[this.items.length - 1]?.s ?? null; }
  get size(): number { return this.items.length; }
  clear(): void { this.items = []; }

  /** Snapshots around `renderMs` (local clock). Before the first: the first; after the last: the last (held, never extrapolated). */
  sample(renderMs: number): Sample | null {
    const it = this.items;
    if (!it.length) return null;
    const first = it[0]!, last = it[it.length - 1]!;
    if (renderMs <= first.at) return { a: first.s, b: first.s, t: 0 };
    if (renderMs >= last.at) return { a: last.s, b: last.s, t: 0 };
    for (let i = it.length - 1; i > 0; i--) {
      const a = it[i - 1]!, b = it[i]!;
      if (renderMs >= a.at) return { a: a.s, b: b.s, t: (renderMs - a.at) / Math.max(1, b.at - a.at) };
    }
    return { a: first.s, b: first.s, t: 0 };
  }
}

const poseOf = (p: SnapPlayer): Pose => ({ x: p.x, y: p.y, z: p.z, yw: p.yw, pt: p.pt });

/** Blends two snapshots into poses by player id (players missing from `a` use `b` as is). */
export function interpolatePoses(s: Sample): Map<number, Pose> {
  const out = new Map<number, Pose>();
  const byId = new Map(s.a.players.map((p) => [p.id, p] as const));
  for (const pb of s.b.players) {
    const pa = byId.get(pb.id);
    if (!pa || s.t === 0) { out.set(pb.id, poseOf(s.t === 0 && pa ? pa : pb)); continue; }
    // A respawn teleports: do not slide across the map between two far-apart points.
    const jump = Math.hypot(pb.x - pa.x, pb.z - pa.z) > 6;
    const t = jump ? 1 : s.t;
    out.set(pb.id, {
      x: lerp(pa.x, pb.x, t), y: lerp(pa.y, pb.y, t), z: lerp(pa.z, pb.z, t),
      yw: lerpAngle(pa.yw, pb.yw, t), pt: lerp(pa.pt, pb.pt, t),
    });
  }
  return out;
}

export interface GrenadePose { id: number; x: number; y: number; z: number }
export function interpolateGrenades(s: Sample): GrenadePose[] {
  const byId = new Map(s.a.grenades.map((g) => [g.id, g] as const));
  return s.b.grenades.map((gb) => {
    const ga = byId.get(gb.id);
    if (!ga) return gb;
    return { id: gb.id, x: lerp(ga.x, gb.x, s.t), y: lerp(ga.y, gb.y, s.t), z: lerp(ga.z, gb.z, s.t) };
  });
}
