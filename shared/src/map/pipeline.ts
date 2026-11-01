/**
 * Converts the output of tools/map-pipeline (markers.json + colliders.json [+ navgrid.json])
 * into the shared sim's `MapDef`. Pure and deterministic, so the same JSON gives the client
 * and a future server the same world.
 */
import type { SurfaceMaterial } from '../sim/ballistics';
import { type Vec3, v3 } from '../sim/vec';
import { decodeNavGrid, type NavGridJson } from './navgrid';
import type { BoxLook, MapBox, MapDef } from './types';

export interface PipelineMarker {
  kind: string;
  name: string;
  position: [number, number, number];
  yaw: number;
  team?: number;
}

export interface PipelineMarkers {
  format: string;
  version: number;
  id: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  waterLevel: number;
  /** Bot patrol loops (waypoint indices); the pipeline writes null when the source map defines none. */
  patrols: number[][] | null;
  markers: PipelineMarker[];
}

export interface PipelineSimBox {
  c: { x: number; y: number; z: number };
  s: { x: number; y: number; z: number };
  material: SurfaceMaterial;
  look?: BoxLook;
  shell?: number;
  fill?: number;
  approx?: boolean;
  node?: string;
}

export interface PipelineColliders {
  format: string;
  version: number;
  simBoxes: PipelineSimBox[];
}

/** Trailing number of a marker name (`spawn_attack_3` -> 3, `nav_12` -> 12). */
const indexOf = (name: string): number => Number(/(\d+)(?:\.\d+)?$/.exec(name)?.[1] ?? 0);
const byIndex = (a: PipelineMarker, b: PipelineMarker): number => indexOf(a.name) - indexOf(b.name);
const pos = (m: PipelineMarker): Vec3 => v3(m.position[0], m.position[1], m.position[2]);

export function mapDefFromPipeline(markers: PipelineMarkers, colliders: PipelineColliders, navgrid?: NavGridJson): MapDef {
  if (markers.format !== 'seek-strike-markers' || markers.version !== 1) throw new Error('unsupported markers format');
  if (colliders.format !== 'seek-strike-colliders' || colliders.version !== 1) throw new Error('unsupported colliders format');

  // The sim has its own ground plane at y = 0: drop slabs whose top is at or below it.
  const boxes: MapBox[] = [];
  const groundSlabs: MapBox[] = [];
  for (const b of colliders.simBoxes) {
    if (b.c.y + b.s.y / 2 <= 0.001) {
      // Land slabs tell the physics where there is ground; everything else at y <= 0 is water.
      if (b.node?.startsWith('ground_land')) groundSlabs.push({ c: v3(b.c.x, b.c.y, b.c.z), s: v3(b.s.x, b.s.y, b.s.z), material: b.material, look: 'concrete' });
      continue;
    }
    const box: MapBox = { c: v3(b.c.x, b.c.y, b.c.z), s: v3(b.s.x, b.s.y, b.s.z), material: b.material, look: b.look ?? 'concrete' };
    if (b.shell !== undefined) box.shell = b.shell;
    if (b.fill !== undefined) box.fill = b.fill;
    boxes.push(box);
  }

  const spawnsOf = (team: number): PipelineMarker[] => markers.markers.filter((m) => m.kind === 'spawn' && m.team === team).sort(byIndex);
  const attack = spawnsOf(0), defend = spawnsOf(1);
  const objective = markers.markers.find((m) => m.kind === 'objective');
  if (!attack.length || !defend.length || !objective) throw new Error('map needs spawns for both teams and an objective');
  const waypoints = markers.markers.filter((m) => m.kind === 'nav').sort(byIndex).map(pos);
  const authored = (markers.patrols ?? []).filter((loop) => loop.length > 0 && loop.every((i) => i >= 0 && i < waypoints.length));

  return {
    id: markers.id,
    nameKey: 'map.portoArdesia',
    bounds: { ...markers.bounds },
    boxes,
    spawns: [attack.map(pos), defend.map(pos)],
    spawnYaw: [attack[0]!.yaw, defend[0]!.yaw],
    objective: pos(objective),
    waypoints,
    patrols: authored.length ? authored.map((p) => [...p]) : defaultPatrols(waypoints, pos(objective)),
    waterLevel: markers.waterLevel,
    navGrid: navgrid ? decodeNavGrid(navgrid) : undefined,
    groundSlabs: groundSlabs.length ? groundSlabs : undefined,
  };
}

/**
 * Patrol loops for maps without authored ones: two rings of waypoints around the objective
 * (nearest 6, then the next 6), each ordered by angle so bots walk a loop, not a zig-zag.
 * Deterministic: depends only on waypoint positions.
 */
export function defaultPatrols(waypoints: readonly Vec3[], objective: Vec3): number[][] {
  const byDistance = waypoints
    .map((w, i) => ({ i, d: Math.hypot(w.x - objective.x, w.z - objective.z) }))
    .sort((a, b) => a.d - b.d || a.i - b.i);
  const loops: number[][] = [];
  for (let start = 0; start < byDistance.length && loops.length < 2; start += 6) {
    const ring = byDistance.slice(start, start + 6).map(({ i }) => i);
    if (ring.length < 2) break;
    const angle = (i: number): number => Math.atan2(waypoints[i]!.z - objective.z, waypoints[i]!.x - objective.x);
    loops.push(ring.sort((a, b) => angle(a) - angle(b) || a - b));
  }
  return loops;
}
