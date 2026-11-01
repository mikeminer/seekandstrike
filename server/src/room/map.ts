import { mapDefFromPipeline, type PipelineColliders, type PipelineMarkers } from '@shared/map/pipeline';
import type { NavGridJson } from '@shared/map/navgrid';
import markers from '../../../public/assets/maps/banchina-est/markers.json';
import colliders from '../../../public/assets/maps/banchina-est/colliders.json';
import navgrid from '../../../public/assets/maps/banchina-est/navgrid.json';

/** Banchina Est as baked by tools/map-pipeline (same files the client loads). */
export const ROOM_MAP = mapDefFromPipeline(
  markers as unknown as PipelineMarkers,
  colliders as unknown as PipelineColliders,
  navgrid as unknown as NavGridJson,
);
