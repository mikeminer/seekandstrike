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
}

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
    return { id, map, glb, simBoxes: colliders.simBoxes };
  } catch (err) {
    console.warn(`Map pipeline files for ${id} unavailable, using the built-in map.`, err);
    return { id: DEFAULT_MAP, map: PORTO_ARDESIA, glb: null, simBoxes: [] };
  }
}

/** Banchina Est (kept for existing callers and tests). */
export const loadBanchinaEst = (base: string): Promise<LoadedMap> => loadPipelineMap(base, 'banchina-est');
