import type { SurfaceMaterial } from '../sim/ballistics';
import type { Vec3 } from '../sim/vec';
import type { NavGrid } from './navgrid';

/** Visual family used by the renderer to pick a PBR texture set. */
export type BoxLook = 'concrete' | 'containerRed' | 'containerBlue' | 'containerGrey' | 'crate' | 'steelPlate' | 'barrier';

/** Axis-aligned static solid (centre + full size, metres). AABBs keep the shared sim fast and exact. */
export interface MapBox {
  c: Vec3;
  s: Vec3;
  material: SurfaceMaterial;
  look: BoxLook;
  /** Wall thickness for bullet penetration; hollow containers are thin sheet steel. */
  shell?: number;
  /**
   * Cargo fill 0..1. Loaded containers (fill > 0) count as solid along the whole span, so
   * rifle rounds stop in them; empty shells (wood crates) only cost the two walls.
   */
  fill?: number;
}

export interface MapDef {
  id: string;
  nameKey: string;
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  boxes: MapBox[];
  spawns: [Vec3[], Vec3[]];
  /** Spawn facing yaw per team. */
  spawnYaw: [number, number];
  objective: Vec3;
  waypoints: Vec3[];
  /** Patrol loops for defenders (waypoint indices). */
  patrols: number[][];
  waterLevel: number;
  /** Baked nav grid from the map pipeline; bots fall back to `waypoints` when absent. */
  navGrid?: NavGrid | undefined;
}
