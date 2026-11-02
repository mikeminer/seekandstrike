import { mapDefFromPipeline, type PipelineColliders, type PipelineMarkers } from '@shared/map/pipeline';
import type { NavGridJson } from '@shared/map/navgrid';
import type { MapDef } from '@shared/map/types';
import bMarkers from '../../../public/assets/maps/banchina-est/markers.json';
import bColliders from '../../../public/assets/maps/banchina-est/colliders.json';
import bNav from '../../../public/assets/maps/banchina-est/navgrid.json';
import mMarkers from '../../../public/assets/maps/magazzini-sale/markers.json';
import mColliders from '../../../public/assets/maps/magazzini-sale/colliders.json';
import mNav from '../../../public/assets/maps/magazzini-sale/navgrid.json';
import sMarkers from '../../../public/assets/maps/scalo-ferroviario/markers.json';
import sColliders from '../../../public/assets/maps/scalo-ferroviario/colliders.json';
import sNav from '../../../public/assets/maps/scalo-ferroviario/navgrid.json';
import pMarkers from '../../../public/assets/maps/porto-vecchio/markers.json';
import pColliders from '../../../public/assets/maps/porto-vecchio/colliders.json';
import pNav from '../../../public/assets/maps/porto-vecchio/navgrid.json';

/** Online maps: the same pipeline files the client loads (public/assets/maps/<id>/). */
export const ONLINE_MAP_IDS = ['banchina-est', 'magazzini-sale', 'scalo-ferroviario', 'porto-vecchio'] as const;
export type OnlineMapId = (typeof ONLINE_MAP_IDS)[number];

const SOURCES: Record<OnlineMapId, [unknown, unknown, unknown]> = {
  'banchina-est': [bMarkers, bColliders, bNav],
  'magazzini-sale': [mMarkers, mColliders, mNav],
  'scalo-ferroviario': [sMarkers, sColliders, sNav],
  'porto-vecchio': [pMarkers, pColliders, pNav],
};
const built = new Map<OnlineMapId, MapDef>();

/** Map definition for a room (built once per isolate, on first use). */
export function roomMap(id: OnlineMapId): MapDef {
  let m = built.get(id);
  if (!m) {
    const [markers, colliders, nav] = SOURCES[id];
    m = mapDefFromPipeline(markers as PipelineMarkers, colliders as PipelineColliders, nav as NavGridJson);
    m.id = id;
    built.set(id, m);
  }
  return m;
}

/**
 * The map of a room, from its name: `<map-id>-<n>` (e.g. `magazzini-sale-3`). Any other name — including the
 * original `lobby-<n>` rooms — plays Banchina Est.
 */
export function mapIdForRoom(roomName: string): OnlineMapId {
  for (const id of ONLINE_MAP_IDS) if (roomName.startsWith(`${id}-`)) return id;
  return 'banchina-est';
}

/** Banchina Est (kept for existing callers and tests). */
export const ROOM_MAP = roomMap('banchina-est');
