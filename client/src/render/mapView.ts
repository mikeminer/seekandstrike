import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BoxLook, MapBox, MapDef } from '@shared/map/types';
import type { AssetStore, TextureSetId } from './assets';
import { compileArchitecture, SLOTS, type Occlusion, type Slot } from './architecture/compile';
import { massFromSimBoxes, planBuildings, type BuildingPlan } from './architecture/plan';

/**
 * Builds the static map from MapDef boxes: one merged geometry per look (few draw calls),
 * world-scaled UVs so texel density is consistent (metres per texture tile below).
 */
interface LookSpec { set: TextureSetId; tile: number; tint?: number; roughness?: number; metalness?: number; colorFrom?: TextureSetId; }

const LOOKS: Record<BoxLook, LookSpec> = {
  concrete: { set: 'Concrete034', tile: 3 },
  barrier: { set: 'Concrete034', tile: 1.6, tint: 0xd8d4cc },
  containerRed: { set: 'CorrugatedSteel005', tile: 2.4, tint: 0x8a2c22, metalness: 0.5 },
  containerBlue: { set: 'CorrugatedSteel005', tile: 2.4, tint: 0x264a74, metalness: 0.5 },
  // Weathered yellow-painted container: painted colour over the corrugated relief.
  // PaintedMetal009 is a weathered yellow paint: reads as a classic yellow/rust box.
  containerGrey: { set: 'CorrugatedSteel005', colorFrom: 'PaintedMetal009', tile: 2.4, tint: 0xb8b09a, metalness: 0.4 },
  crate: { set: 'Planks037B', tile: 1.2 },
  steelPlate: { set: 'MetalPlates006', tile: 1.5, metalness: 0.9 },
};

/** BoxGeometry with UVs in world metres / tile. Face order: +x, -x, +y, -y, +z, -z (4 verts each). */
function worldBox(b: MapBox, tile: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(b.s.x, b.s.y, b.s.z);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const dims: [number, number][] = [
    [b.s.z, b.s.y], [b.s.z, b.s.y], [b.s.x, b.s.z], [b.s.x, b.s.z], [b.s.x, b.s.y], [b.s.x, b.s.y],
  ];
  for (let f = 0; f < 6; f++) {
    const [du, dv] = dims[f]!;
    // Offset by world position so neighbouring boxes don't repeat identically.
    const ou = (b.c.x * 0.37 + b.c.z * 0.61) / tile;
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * (du / tile) + ou, uv.getY(i) * (dv / tile));
    }
  }
  g.translate(b.c.x, b.c.y, b.c.z);
  return g;
}

function material(assets: AssetStore, spec: LookSpec): THREE.MeshStandardMaterial {
  const s = assets.set(spec.set);
  const color = spec.colorFrom ? assets.set(spec.colorFrom).map : s.map;
  const m = new THREE.MeshStandardMaterial({
    map: color,
    normalMap: s.normalMap,
    roughnessMap: s.roughnessMap,
    metalnessMap: s.metalnessMap ?? null,
    aoMap: s.aoMap ?? null,
    aoMapIntensity: 0.8,
    color: spec.tint ?? 0xffffff,
    metalness: s.metalnessMap ? (spec.metalness ?? 1) : (spec.metalness ?? 0),
    roughness: 1,
  });
  return assets.track(m);
}

export function buildMapView(map: MapDef, assets: AssetStore): THREE.Group {
  const group = new THREE.Group();
  group.name = 'map';
  const byLook = new Map<BoxLook, THREE.BufferGeometry[]>();
  for (const b of map.boxes) {
    const list = byLook.get(b.look) ?? [];
    list.push(worldBox(b, LOOKS[b.look].tile));
    byLook.set(b.look, list);
  }
  for (const [look, geos] of byLook) {
    const merged = assets.track(mergeGeometries(geos, false)!);
    for (const g of geos) g.dispose();
    const mesh = new THREE.Mesh(merged, material(assets, LOOKS[look]));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `map-${look}`;
    group.add(mesh);
  }

  addSurroundings(group, map, assets);
  return group;
}

/**
 * Same map, but the solids come from the pipeline's `render.glb` (joined per material, no UVs):
 * UVs are projected here in world metres, materials are the PBR looks above. The GLB's ground
 * slab and sea are skipped; the asphalt yard, quay and sea of `addSurroundings` replace them.
 */
export function buildMapViewFromGlb(gltf: GLTF, map: MapDef, assets: AssetStore): THREE.Group {
  const group = new THREE.Group();
  group.name = 'map';
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const src = o as THREE.Mesh;
    if (!src.isMesh) return;
    const srcMat = Array.isArray(src.material) ? src.material[0] : src.material;
    const name = (srcMat?.name ?? '') as BoxLook | 'quayStone' | 'water';
    if (name === 'quayStone' || name === 'water' || !(name in LOOKS)) return;
    const look = name as BoxLook;
    const mesh = new THREE.Mesh(assets.track(worldGeometryFromGlb(src, LOOKS[look].tile)), material(assets, LOOKS[look]));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = `map-${look}`;
    group.add(mesh);
  });
  addSurroundings(group, map, assets);
  return group;
}

/** Pipeline GLB mesh → world-space geometry with UVs box-projected in metres / tile. */
function worldGeometryFromGlb(src: THREE.Mesh, tile: number): THREE.BufferGeometry {
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMat = new THREE.Matrix3();
  {
    const spec = { tile };
    const pa = src.geometry.getAttribute('position');
    const na = src.geometry.getAttribute('normal');
    const pos = new Float32Array(pa.count * 3);
    const nor = new Float32Array(pa.count * 3);
    const uv = new Float32Array(pa.count * 2);
    normalMat.getNormalMatrix(src.matrixWorld);
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(src.matrixWorld);
      n.fromBufferAttribute(na, i).applyMatrix3(normalMat).normalize();
      pos.set([v.x, v.y, v.z], i * 3);
      nor.set([n.x, n.y, n.z], i * 3);
      const ax = Math.abs(n.x), ay = Math.abs(n.y), az = Math.abs(n.z);
      // Box projection on the dominant axis; offset by position like worldBox so neighbours differ.
      const u = ay >= ax && ay >= az ? v.x : ax >= az ? v.z : v.x;
      const w = ay >= ax && ay >= az ? v.z : v.y;
      uv[i * 2] = u / spec.tile;
      uv[i * 2 + 1] = w / spec.tile;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (src.geometry.index) geo.setIndex(Array.from(src.geometry.index.array));
    return geo;
  }
}

/** Ground, roads, rails and seabed of an OSM pipeline map (the GLB's own non-building surfaces). */
const GROUND_LOOKS: Record<string, LookSpec> = {
  quayStone: { set: 'Concrete034', tile: 3, tint: 0xc4ac8a },
  asphalt: { set: 'Asphalt031', tile: 4, tint: 0xa8a8a8 },
  concreteDark: { set: 'Concrete034', tile: 4, tint: 0x4d5354 },
  rail: { set: 'MetalPlates006', tile: 1.5, tint: 0x5e5249, metalness: 0.6 },
};

/** Baked ground sky-occlusion lightmap (tools/light-bake) and the world rectangle it covers. */
export interface GroundAo { texture: THREE.Texture; bounds: { minX: number; maxX: number; minZ: number; maxZ: number } }

export interface ArchitectureViewOptions {
  /** Per-vertex façade occlusion, computed once at load from the same model as the ground bake. */
  occlusion?: Occlusion;
  groundAo?: GroundAo | null;
}

/** Applies the per-vertex `ao` attribute to indirect light only (like aoMap): direct sun is untouched. */
function useVertexAo(m: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float ao;\nvarying float vAo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAo = ao;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAo;')
      .replace('#include <aomap_fragment>', 'reflectedLight.indirectDiffuse *= vAo;\nreflectedLight.indirectSpecular *= vAo;');
  };
  m.customProgramCacheKey = () => 'vertex-ao';
  return m;
}

/** uv1 = world XZ mapped onto the baked lightmap (row 0 of the PNG is minZ). */
function addLightmapUv(geo: THREE.BufferGeometry, b: GroundAo['bounds']): void {
  const p = geo.getAttribute('position');
  const uv1 = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    uv1[i * 2] = (p.getX(i) - b.minX) / (b.maxX - b.minX);
    uv1[i * 2 + 1] = 1 - (p.getZ(i) - b.minZ) / (b.maxZ - b.minZ);
  }
  geo.setAttribute('uv1', new THREE.BufferAttribute(uv1, 2));
}

/**
 * Pipeline map whose buildings are rebuilt procedurally (DevFridge Game Builder v1.10.0,
 * landscapes-and-architecture → threejs-procedural-architecture). The GLB supplies ground, roads,
 * rails and the box props; its blockout buildings (plaster/brick) are replaced by façades compiled
 * from the same collision boxes (four draw calls) and its flat water by the analytic sea (see
 * render/environment/sea.ts, added by the caller). Ground and façades carry baked sky occlusion.
 */
export function buildArchitectureMapView(gltf: GLTF, map: MapDef, simBoxes: Parameters<typeof massFromSimBoxes>[0], assets: AssetStore, opts: ArchitectureViewOptions = {}): { group: THREE.Group; triangles: Record<string, number>; plans: BuildingPlan[] } {
  const group = new THREE.Group();
  group.name = 'map';
  gltf.scene.updateMatrixWorld(true);
  gltf.scene.traverse((o) => {
    const src = o as THREE.Mesh;
    if (!src.isMesh) return;
    const srcMat = Array.isArray(src.material) ? src.material[0] : src.material;
    const name = srcMat?.name ?? '';
    // Blockout buildings → procedural architecture; flat water → analytic sea (caller).
    if (name === 'plaster' || name === 'brick' || name === 'water') return;
    const spec = GROUND_LOOKS[name] ?? (name in LOOKS ? LOOKS[name as BoxLook] : null);
    if (!spec) return;
    const geo = worldGeometryFromGlb(src, spec.tile);
    const mat = material(assets, spec);
    if (name in GROUND_LOOKS) {
      // Paving is matte: at grazing angles the blue sky reflection made it look icy (owner: "tono freddo").
      mat.roughness = Math.max(mat.roughness, 0.96);
      mat.envMapIntensity = 0.4;
    }
    if (opts.groundAo && name in GROUND_LOOKS && name !== 'concreteDark') {
      addLightmapUv(geo, opts.groundAo.bounds);
      mat.aoMap = opts.groundAo.texture;
      mat.aoMapIntensity = 1;
    }
    const mesh = new THREE.Mesh(assets.track(geo), mat);
    mesh.castShadow = !(name in GROUND_LOOKS);
    mesh.receiveShadow = true;
    mesh.name = `map-${name}`;
    group.add(mesh);
  });
  void map;
  const plans = planBuildings(massFromSimBoxes(simBoxes));
  const compiled = compileArchitecture(plans, opts.occlusion);
  const stoneSet = assets.set('Concrete034');
  const slotMaterial: Record<Slot, THREE.MeshStandardMaterial> = {
    wall: new THREE.MeshStandardMaterial({ map: stoneSet.map, normalMap: stoneSet.normalMap, roughnessMap: stoneSet.roughnessMap, vertexColors: true, roughness: 1 }),
    stone: new THREE.MeshStandardMaterial({ map: stoneSet.map, normalMap: stoneSet.normalMap, roughnessMap: stoneSet.roughnessMap, vertexColors: true, roughness: 0.95 }),
    window: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.12, metalness: 0, envMapIntensity: 1.3 }),
    roof: new THREE.MeshStandardMaterial({ map: stoneSet.map, normalMap: stoneSet.normalMap, vertexColors: true, roughness: 1 }),
  };
  for (const slot of SLOTS) {
    const geo = compiled.geometries[slot];
    if (!geo) continue;
    const mat = geo.getAttribute('ao') ? useVertexAo(slotMaterial[slot]) : slotMaterial[slot];
    const mesh = new THREE.Mesh(assets.track(geo), assets.track(mat));
    // Only the mass (walls, roofs) casts shadows: thin trims and glass would add shadow-pass cost for little gain.
    mesh.castShadow = slot === 'wall' || slot === 'roof';
    mesh.receiveShadow = true;
    mesh.name = `architecture-${slot}`;
    group.add(mesh);
  }
  return { group, triangles: compiled.triangles, plans };
}

/** Asphalt yard, lane paint, quay wall, sea and breakwater around the solids. */
function addSurroundings(group: THREE.Group, map: MapDef, assets: AssetStore): void {
  // Ground: asphalt yard up to the quay, a concrete quay strip, then water.
  const { minX, maxX, minZ, maxZ } = map.bounds;
  const quayX = maxX + 0.9;
  const yardW = quayX - (minX - 6), depth = maxZ - minZ + 12;
  const asphalt = new THREE.PlaneGeometry(yardW, depth);
  asphalt.rotateX(-Math.PI / 2);
  asphalt.translate((quayX + minX - 6) / 2, 0, (minZ + maxZ) / 2);
  const uv = asphalt.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * yardW / 4, uv.getY(i) * depth / 4);
  const asphaltSet = assets.set('Asphalt031');
  const ground = new THREE.Mesh(assets.track(asphalt), assets.track(new THREE.MeshStandardMaterial({
    map: asphaltSet.map, normalMap: asphaltSet.normalMap, roughnessMap: asphaltSet.roughnessMap,
    aoMap: asphaltSet.aoMap ?? null, roughness: 1, metalness: 0, color: 0xb8b8b8,
  })));
  ground.receiveShadow = true;
  ground.name = 'ground';
  group.add(ground);

  // Painted lane markings (subtle, decal-like quads slightly above the asphalt).
  const paint = assets.track(new THREE.MeshStandardMaterial({ color: 0xd9c14a, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 }));
  for (const z of [-30, -10, 10, 30]) {
    const m = new THREE.Mesh(assets.track(new THREE.PlaneGeometry(0.15, 14).rotateX(-Math.PI / 2)), paint);
    m.position.set(31.5, 0.005, z);
    m.receiveShadow = true;
    group.add(m);
  }

  // Quay wall face down to the water and the water surface.
  const concrete = assets.set('Concrete034');
  const wallGeo = new THREE.PlaneGeometry(depth, 2.2);
  const wuv = wallGeo.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < wuv.count; i++) wuv.setXY(i, wuv.getX(i) * depth / 3, wuv.getY(i) * 2.2 / 3);
  const quayWall = new THREE.Mesh(assets.track(wallGeo), assets.track(new THREE.MeshStandardMaterial({
    map: concrete.map, normalMap: concrete.normalMap, roughnessMap: concrete.roughnessMap, color: 0x8f8a82, roughness: 1,
  })));
  quayWall.rotation.y = Math.PI / 2;
  quayWall.position.set(quayX, -1.1, (minZ + maxZ) / 2);
  quayWall.receiveShadow = true;
  group.add(quayWall);

  const water = new THREE.Mesh(
    assets.track(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2)),
    assets.track(new THREE.MeshStandardMaterial({
      color: 0x1d3a40, roughness: 0.06, metalness: 0.0, envMapIntensity: 1.1,
      normalMap: assets.set('Concrete034').normalMap, normalScale: new THREE.Vector2(0.15, 0.15),
    })),
  );
  water.position.set(quayX + 200, map.waterLevel, 0);
  water.name = 'water';
  group.add(water);

  // Far shore silhouette / breakwater so the horizon is not empty.
  const breakwater = new THREE.Mesh(
    assets.track(new THREE.BoxGeometry(6, 2.5, 260)),
    assets.track(new THREE.MeshStandardMaterial({ map: concrete.map, color: 0x7d7a74, roughness: 1 })),
  );
  breakwater.position.set(quayX + 140, map.waterLevel + 0.6, 0);
  group.add(breakwater);
}

/** Breaching-charge site marker: a hazard-striped panel on the console plus the charge itself. */
export function buildObjectiveProp(assets: AssetStore): { root: THREE.Group; charge: THREE.Object3D; light: THREE.Mesh } {
  const root = new THREE.Group();
  const plate = assets.set('MetalPlates006');
  const chargeMat = assets.track(new THREE.MeshStandardMaterial({ color: 0x3d4434, roughness: 0.7, metalness: 0.1 }));
  const charge = new THREE.Group();
  const body = new THREE.Mesh(assets.track(new THREE.BoxGeometry(0.34, 0.12, 0.22)), chargeMat);
  const panel = new THREE.Mesh(assets.track(new THREE.BoxGeometry(0.14, 0.02, 0.1)), assets.track(new THREE.MeshStandardMaterial({ map: plate.map, color: 0x222222, metalness: 0.8, roughness: 0.4 })));
  panel.position.y = 0.07;
  const light = new THREE.Mesh(assets.track(new THREE.SphereGeometry(0.018, 8, 6)), assets.track(new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff2010, emissiveIntensity: 0 })));
  light.position.set(0.05, 0.085, 0);
  charge.add(body, panel, light);
  charge.visible = false;
  root.add(charge);
  return { root, charge, light };
}
