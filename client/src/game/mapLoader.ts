import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { PORTO_ARDESIA } from '@shared/map/portoArdesia';
import { mapDefFromPipeline, type PipelineColliders, type PipelineMarkers } from '@shared/map/pipeline';
import type { NavGridJson } from '@shared/map/navgrid';
import type { MapDef } from '@shared/map/types';

export interface LoadedMap {
  map: MapDef;
  /** Pipeline `render.glb`; null when the hand-written fallback map is used. */
  glb: GLTF | null;
}

/**
 * Loads Banchina Est as baked by tools/map-pipeline (markers + colliders + navgrid + render.glb),
 * all bundled under assets/maps/. If anything fails the hand-written map is used so the game
 * still starts; the failure is logged.
 */
export async function loadBanchinaEst(base: string): Promise<LoadedMap> {
  const dir = `${base}assets/maps/banchina-est/`;
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
    return { map: mapDefFromPipeline(markers, colliders, navgrid), glb };
  } catch (err) {
    console.warn('Map pipeline files unavailable, using the built-in map.', err);
    return { map: PORTO_ARDESIA, glb: null };
  }
}
