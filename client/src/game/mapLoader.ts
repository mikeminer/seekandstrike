import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { PORTO_ARDESIA } from '@shared/map/portoArdesia';
import { mapDefFromPipeline, type PipelineColliders, type PipelineMarkers } from '@shared/map/pipeline';
import type { NavGridJson } from '@shared/map/navgrid';
import type { MapDef } from '@shared/map/types';

/** Maps bundled under public/assets/maps/<id>/ by tools/map-pipeline. */
export const MAPS = {
  'banchina-est': { nameKey: 'map.portoArdesia', online: true, architecture: false, attribution: null },
  'porto-vecchio': { nameKey: 'map.portoVecchio', online: false, architecture: true, attribution: '© OpenStreetMap contributors (ODbL)' },
} as const;
export type MapId = keyof typeof MAPS;
export const DEFAULT_MAP: MapId = 'banchina-est';
export const isMapId = (v: unknown): v is MapId => typeof v === 'string' && Object.hasOwn(MAPS, v);

export interface LoadedMap {
  id: MapId;
  map: MapDef;
  /** Pipeline `render.glb`; null when the hand-written fallback map is used. */
  glb: GLTF | null;
  /** Collider boxes with their pipeline node names (buildings are `bld_…`), for procedural architecture. */
  simBoxes: PipelineColliders['simBoxes'];
  /** Authored lighting of the map (markers.json `environment`), when present. */
  environment: MapEnvironment | null;
}

export interface MapEnvironment { sun?: { azimuthDeg: number; elevationDeg: number } }

/**
 * Loads a pipeline-baked map (markers + colliders + navgrid + render.glb). If anything fails the
 * hand-written Banchina map is used so the game still starts; the failure is logged.
 */
export async function loadPipelineMap(base: string, id: MapId): Promise<LoadedMap> {
  const dir = `${base}assets/maps/${id}/`;
  try {
    const json = async <T>(name: string): Promise<T> => {
      const r = await fetch(dir + name);
      if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
      return (await r.json()) as T;
    };
    const [markers, colliders, navgrid, glb] = await Promise.all([
      json<PipelineMarkers>('markers.json'),
      json<PipelineColliders>('colliders.json'),
      json<NavGridJson>('navgrid.json'),
      new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(`${dir}render.glb`),
    ]);
    const map = mapDefFromPipeline(markers, colliders, navgrid);
    map.nameKey = MAPS[id].nameKey;
    const env = (markers as PipelineMarkers & { environment?: MapEnvironment | null }).environment ?? null;
    return { id, map, glb, simBoxes: colliders.simBoxes, environment: env };
  } catch (err) {
    console.warn(`Map pipeline files for ${id} unavailable, using the built-in map.`, err);
    return { id: DEFAULT_MAP, map: PORTO_ARDESIA, glb: null, simBoxes: [], environment: null };
  }
}

/** Banchina Est (kept for existing callers and tests). */
export const loadBanchinaEst = (base: string): Promise<LoadedMap> => loadPipelineMap(base, 'banchina-est');

/** Baked ground sky-occlusion lightmap (tools/light-bake/bake-ground-ao.mjs); null when the map has none. */
export async function loadGroundAo(base: string, id: MapId): Promise<{ texture: THREE.Texture; bounds: { minX: number; maxX: number; minZ: number; maxZ: number } } | null> {
  const dir = `${base}assets/maps/${id}/`;
  try {
    const r = await fetch(`${dir}ground-ao.json`);
    if (!r.ok) return null;
    const meta = (await r.json()) as { format: string; version: number; bounds: { minX: number; maxX: number; minZ: number; maxZ: number } };
    if (meta.format !== 'seek-strike-ground-ao' || meta.version !== 1) return null;
    const texture = await new THREE.TextureLoader().loadAsync(`${dir}ground-ao.png`);
    texture.colorSpace = THREE.NoColorSpace; // data, not colour
    texture.channel = 1; // uv1 = world XZ mapped onto the map bounds
    return { texture, bounds: meta.bounds };
  } catch (err) {
    console.warn(`Ground lightmap for ${id} unavailable.`, err);
    return null;
  }
}
