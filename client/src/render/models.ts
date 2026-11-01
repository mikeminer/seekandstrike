import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Bundled CC0 character models (see ASSETS_LICENSES.md), built offline by
 * tools/asset-pipeline/build-assets.mjs (meshopt + quantized + WebP textures). Served from the
 * app's own origin; no hotlinks.
 */
export interface CharacterModels {
  /** Rigged soldier body (Body + Body_LOD1 on one 65-bone skeleton) + 17 animation clips. */
  soldier: GLTF;
  /** Rifle (full + LOD1). Coordinates ("R space"): muzzle at -X, up +Y, ~1.9 units long. */
  rifle: GLTF;
}

export async function loadCharacterModels(base: string, onProgress?: (done: number, total: number) => void): Promise<CharacterModels> {
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  let done = 0;
  const one = async (name: string): Promise<GLTF> => {
    const g = await loader.loadAsync(`${base}assets/models/${name}.glb`);
    g.scene.updateMatrixWorld(true);
    onProgress?.(++done, 2);
    return g;
  };
  const [soldier, rifle] = await Promise.all([one('soldier'), one('rifle')]);
  return { soldier, rifle };
}

export function disposeGltf(g: GLTF): void {
  const seen = new Set<object>();
  const d = (x: { dispose(): void } | null | undefined): void => { if (x && !seen.has(x)) { seen.add(x); x.dispose(); } };
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    d(m.geometry);
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(mat)) if (v instanceof THREE.Texture) d(v);
      d(mat);
    }
  });
}

export function findMesh(g: GLTF, name: string): THREE.Mesh {
  const m = g.scene.getObjectByName(name) as THREE.Mesh | undefined;
  if (!m?.isMesh) throw new Error(`mesh ${name} missing in model`);
  return m;
}

/**
 * Splits an indexed mesh into geometries by triangle centroid (tested in the mesh's world space,
 * e.g. R space for the rifle). The parts share vertex attributes; only the index differs.
 */
export function splitByCentroid(mesh: THREE.Mesh, tests: ((c: THREE.Vector3) => boolean)[]): THREE.BufferGeometry[] {
  const g = mesh.geometry;
  const pos = g.getAttribute('position');
  const index = g.index;
  const n = index ? index.count : pos.count;
  const idx = (i: number): number => (index ? index.getX(i) : i);
  const parts: number[][] = tests.map(() => []);
  const rest: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < n; t += 3) {
    const i0 = idx(t), i1 = idx(t + 1), i2 = idx(t + 2);
    a.fromBufferAttribute(pos, i0); b.fromBufferAttribute(pos, i1); c.fromBufferAttribute(pos, i2);
    a.add(b).add(c).multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
    const k = tests.findIndex((f) => f(a));
    (k >= 0 ? parts[k]! : rest).push(i0, i1, i2);
  }
  return [...parts, rest].map((ids) => {
    const out = new THREE.BufferGeometry();
    for (const [k, v] of Object.entries(g.attributes)) out.setAttribute(k, v);
    out.setIndex(ids);
    out.boundingSphere = g.boundingSphere?.clone() ?? null;
    if (!out.boundingSphere) out.computeBoundingSphere();
    return out;
  });
}
