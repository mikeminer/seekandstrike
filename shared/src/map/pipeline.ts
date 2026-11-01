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
  patrols: number[][];
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
  for (const b of colliders.simBoxes) {
    if (b.c.y + b.s.y / 2 <= 0.001) continue;
    const box: MapBox = { c: v3(b.c.x, b.c.y, b.c.z), s: v3(b.s.x, b.s.y, b.s.z), material: b.material, look: b.look ?? 'concrete' };
    if (b.shell !== undefined) box.shell = b.shell;
    if (b.fill !== undefined) box.fill = b.fill;
    boxes.push(box);
  }

  const spawnsOf = (team: number): PipelineMarker[] => markers.markers.filter((m) => m.kind === 'spawn' && m.team === team).sort(byIndex);
  const attack = spawnsOf(0), defend = spawnsOf(1);
  const objective = markers.markers.find((m) => m.kind === 'objective');
  if (!attack.length || !defend.length || !objective) throw new Error('map needs spawns for both teams and an objective');

  return {
    id: markers.id,
    nameKey: 'map.portoArdesia',
    bounds: { ...markers.bounds },
    boxes,
    spawns: [attack.map(pos), defend.map(pos)],
    spawnYaw: [attack[0]!.yaw, defend[0]!.yaw],
    objective: pos(objective),
    waypoints: markers.markers.filter((m) => m.kind === 'nav').sort(byIndex).map(pos),
    patrols: markers.patrols.map((p) => [...p]),
    waterLevel: markers.waterLevel,
    navGrid: navgrid ? decodeNavGrid(navgrid) : undefined,
  };
}
