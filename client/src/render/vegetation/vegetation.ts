/**
 * Vegetation for pipeline maps (DevFridge Game Builder v1.10.0, threejs-procedural-vegetation +
 * threejs-landscape): stone pines grown as branch hierarchies, ruderal weeds, wall ivy and karst
 * groves. Render-only; placement rules live in placement.ts (fairness: nothing tall where people
 * fight). Wind is rooted everywhere: needle and ivy cards pivot at their base, grass bends from
 * the root. Textures are drawn on canvases at load (no external assets).
 */
import * as THREE from 'three';
import type { BuildingPlan, FacadeEdge } from '../architecture/plan';
import { hillHeight, HILLS } from '../environment/hills';
import { growPine } from './pine';
import { ivyPatches, treeSpots, weedSpots, WEED_MAX_HEIGHT, type Point2, type Rect2 } from './placement';

const WIND_GLSL = /* glsl */ `
uniform float uTime;
float windAt(vec2 p) {
  float ph = dot(p, vec2(0.071, 0.053));
  return 0.5 * sin(uTime * 1.1 + ph) + 0.3 * sin(uTime * 2.3 + 1.3 * ph) + 0.2 * sin(uTime * 5.1 + 1.7 * ph);
}`;

/** Adds rooted wind: `weightAttr` is 0 at the root and 1 at the tip. */
function withWind(m: THREE.Material, weightAttr: string, strength: number, key: string, timeRef: { value: number }): void {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = timeRef;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nattribute float ${weightAttr};\n${WIND_GLSL}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec2 wBase = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz;
        #ifdef USE_INSTANCING
          wBase += instanceMatrix[3].xz;
        #endif
        float wv = windAt(wBase + position.xz) * ${weightAttr} * ${weightAttr};
        transformed.x += wv * ${strength.toFixed(3)};
        transformed.z += wv * ${(strength * 0.6).toFixed(3)};`);
  };
  m.customProgramCacheKey = () => key;
}

function canvasTexture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, w: number, h: number): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Needle tuft: strokes radiating from the base (alpha-tested card). */
const needleTexture = (): THREE.CanvasTexture => canvasTexture((g, w, h) => {
  g.clearRect(0, 0, w, h);
  let s = 12345;
  const r = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
  for (let i = 0; i < 70; i++) {
    const a = -Math.PI / 2 + (r() - 0.5) * 2.2, len = h * (0.55 + r() * 0.45);
    g.strokeStyle = `rgb(${70 + r() * 40},${100 + r() * 50},${45 + r() * 25})`;
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2 + Math.cos(a) * len, h + Math.sin(a) * len); g.stroke();
  }
}, 64, 128);

/** Three-lobed ivy leaf, petiole at the bottom centre. */
const ivyTexture = (): THREE.CanvasTexture => canvasTexture((g, w, h) => {
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(w * 0.5, h * 0.98);
  g.bezierCurveTo(w * 0.05, h * 0.75, w * 0.0, h * 0.35, w * 0.28, h * 0.42);
  g.bezierCurveTo(w * 0.2, h * 0.1, w * 0.45, h * 0.0, w * 0.5, h * 0.05);
  g.bezierCurveTo(w * 0.55, h * 0.0, w * 0.8, h * 0.1, w * 0.72, h * 0.42);
  g.bezierCurveTo(w * 1.0, h * 0.35, w * 0.95, h * 0.75, w * 0.5, h * 0.98);
  g.fill();
}, 64, 64);

/** Three blades, three segments each, height 1 (scaled per instance), `bladeT` 0 → 1. */
function weedClusterGeometry(): THREE.BufferGeometry {
  const pos: number[] = [], t: number[] = [], idx: number[] = [];
  for (let b = 0; b < 3; b++) {
    const yaw = (b / 3) * Math.PI * 2 + 0.4, lean = 0.18 + 0.1 * b;
    const dx = Math.cos(yaw), dz = Math.sin(yaw), px = -dz, pz = dx;
    const base = pos.length / 3;
    for (let s = 0; s <= 3; s++) {
      const k = s / 3, half = 0.035 * (1 - k * 0.85);
      const cx = dx * lean * k * k, cz = dz * lean * k * k;
      pos.push(cx - px * half, k, cz - pz * half, cx + px * half, k, cz + pz * half);
      t.push(k, k);
    }
    for (let s = 0; s < 3; s++) { const a = base + s * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('bladeT', new THREE.Float32BufferAttribute(t, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Leaf cards climbing a wall: seeded random-walk stems from the ground, leaves along them. */
function ivyGeometry(patches: ReturnType<typeof ivyPatches>): THREE.BufferGeometry | null {
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], lt: number[] = [], idx: number[] = [];
  for (const p of patches) {
    let s = p.seed || 1;
    const r = (): number => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const e: FacadeEdge = p.edge;
    const out = e.side === '+x' ? [1, 0] : e.side === '-x' ? [-1, 0] : e.side === '+z' ? [0, 1] : [0, -1];
    const world = (u: number, y: number, w: number): THREE.Vector3 => e.side === '+x' || e.side === '-x'
      ? new THREE.Vector3(e.plane + out[0]! * w, y, u) : new THREE.Vector3(u, y, e.plane + out[1]! * w);
    const stems = Math.max(3, Math.round(p.width * 1.6));
    for (let k = 0; k < stems; k++) {
      let u = p.center - p.width / 2 + p.width * (k + r()) / stems, y = 0.05;
      const top = p.height * (0.5 + r() * 0.5);
      while (y < top) {
        u += (r() - 0.5) * 0.12; y += 0.11 + r() * 0.06;
        u = Math.min(Math.max(u, p.center - p.width / 2), p.center + p.width / 2);
        const size = 0.13 + r() * 0.09, ang = (r() - 0.5) * 1.4, w = 0.02 + r() * 0.05;
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const base = pos.length / 3;
        for (const [lx, ly] of [[-0.5, 0], [0.5, 0], [0.5, 1], [-0.5, 1]] as const) {
          const du = (lx * ca - ly * sa) * size, dy = (lx * sa + ly * ca) * size;
          const v = world(u + du, y + dy, w);
          pos.push(v.x, v.y, v.z); nor.push(out[0]!, 0.25, out[1]!); uv.push(lx + 0.5, ly); lt.push(ly);
        }
        // Face outward from the wall.
        const a = new THREE.Vector3(pos[base * 3]!, pos[base * 3 + 1]!, pos[base * 3 + 2]!);
        const b = new THREE.Vector3(pos[base * 3 + 3]!, pos[base * 3 + 4]!, pos[base * 3 + 5]!);
        const c = new THREE.Vector3(pos[base * 3 + 6]!, pos[base * 3 + 7]!, pos[base * 3 + 8]!);
        const f = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
        if (f.x * out[0]! + f.z * out[1]! >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
      }
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('leafT', new THREE.Float32BufferAttribute(lt, 1));
  g.setIndex(idx);
  g.normalizeNormals();
  return g;
}

/** Low-poly karst tree for the distant hills (crown + trunk, ~28 triangles). */
function groveTreeGeometry(): THREE.BufferGeometry {
  const crown = new THREE.IcosahedronGeometry(1, 0).scale(2.6, 2.2, 2.6).translate(0, 3.6, 0);
  const trunk = new THREE.CylinderGeometry(0.18, 0.25, 2.4, 4, 1, true).translate(0, 1.2, 0);
  const paint = (g: THREE.BufferGeometry, hex: number): THREE.BufferGeometry => {
    const c = new THREE.Color(hex), n = g.getAttribute('position').count;
    g.setAttribute('color', new THREE.Float32BufferAttribute(Array.from({ length: n * 3 }, (_, i) => [c.r, c.g, c.b][i % 3]!), 3));
    return g.index ? g.toNonIndexed() : g;
  };
  const parts = [paint(crown, 0xffffff), paint(trunk, 0x6b5a48)];
  const merged = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color']) {
    const arrays = parts.map((p) => p.getAttribute(name).array as Float32Array);
    const out = new Float32Array(arrays.reduce((s, a) => s + a.length, 0));
    let o = 0; for (const a of arrays) { out.set(a, o); o += a.length; }
    merged.setAttribute(name, new THREE.BufferAttribute(out, 3));
  }
  return merged;
}

export interface VegetationInput {
  plans: readonly BuildingPlan[];
  bounds: Rect2;
  land: readonly Rect2[];
  solids: readonly Rect2[];
  markers: readonly Point2[];
  seed: number;
}

export interface VegetationStats { trees: number; weeds: number; ivyLeaves: number; groves: number; triangles: number; drawCallsMax: number }

export function buildVegetation(input: VegetationInput): { group: THREE.Group; update: (seconds: number, camera: THREE.Vector3) => void; stats: VegetationStats } {
  const group = new THREE.Group();
  group.name = 'vegetation';
  const time = { value: 0 };
  let triangles = 0, drawCalls = 0;

  // --- Stone pines (perimeter only): 3 grown variants, bark + needles instanced per variant.
  const spots = treeSpots({ bounds: input.bounds, land: input.land, solids: input.solids, markers: input.markers, seed: input.seed, variants: 3 });
  const needles = new THREE.MeshStandardMaterial({ map: needleTexture(), alphaTest: 0.45, side: THREE.DoubleSide, color: 0x7f9a5e, roughness: 0.9 });
  withWind(needles, 'leafT', 0.12, 'pine-needles', time);
  const bark = new THREE.MeshStandardMaterial({ color: 0x6a5545, roughness: 0.95 });
  for (let v = 0; v < 3; v++) {
    const mine = spots.filter((s) => s.variant === v);
    if (!mine.length) continue;
    const tree = growPine(1000 + v * 77);
    const m = new THREE.Matrix4();
    for (const [geo, mat, name] of [[tree.bark, bark, 'bark'], [tree.leaves, needles, 'needles']] as const) {
      const im = new THREE.InstancedMesh(geo, mat, mine.length);
      mine.forEach((s, i) => im.setMatrixAt(i, m.compose(new THREE.Vector3(s.x, 0, s.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.rotation), new THREE.Vector3(s.scale, s.scale, s.scale))));
      im.castShadow = true; im.receiveShadow = true; im.name = `pine-${name}-${v}`;
      im.computeBoundingSphere();
      group.add(im);
      triangles += (geo.index!.count / 3) * mine.length; drawCalls++;
    }
  }

  // --- Weeds at wall bases and quay edges, in 32 m tiles shown only near the camera.
  const weeds = weedSpots({ edges: input.plans.flatMap((p) => p.edges), land: input.land, solids: input.solids, seed: input.seed + 1 });
  const weedGeo = weedClusterGeometry();
  const weedMat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, color: 0xffffff });
  withWind(weedMat, 'bladeT', 0.05, 'weeds', time);
  const tiles = new Map<string, typeof weeds>();
  for (const w of weeds) { const k = `${Math.floor(w.x / 32)},${Math.floor(w.z / 32)}`; tiles.set(k, [...(tiles.get(k) ?? []), w]); }
  const weedTiles: { mesh: THREE.InstancedMesh; cx: number; cz: number }[] = [];
  const dry = new THREE.Color(0x9c8f5a), green = new THREE.Color(0x5f7a35), c = new THREE.Color(), m = new THREE.Matrix4();
  for (const [k, list] of tiles) {
    const im = new THREE.InstancedMesh(weedGeo, weedMat, list.length);
    list.forEach((w, i) => {
      const h = WEED_MAX_HEIGHT * w.scale;
      im.setMatrixAt(i, m.compose(new THREE.Vector3(w.x, 0, w.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), w.rotation), new THREE.Vector3(1.4, h, 1.4)));
      im.setColorAt(i, c.copy(green).lerp(dry, w.tint));
    });
    im.receiveShadow = true; im.name = `weeds-${k}`;
    im.computeBoundingSphere();
    const [tx, tz] = k.split(',').map(Number) as [number, number];
    weedTiles.push({ mesh: im, cx: tx * 32 + 16, cz: tz * 32 + 16 });
    group.add(im);
  }
  const weedTris = weedGeo.index!.count / 3;

  // --- Ivy on shady façades (one merged mesh).
  const ivy = ivyGeometry(ivyPatches({ edges: input.plans.flatMap((p) => p.edges), seed: input.seed + 2, shadySides: ['+x', '-z'] }));
  let ivyLeaves = 0;
  if (ivy) {
    const ivyMat = new THREE.MeshStandardMaterial({ map: ivyTexture(), alphaTest: 0.5, side: THREE.DoubleSide, color: 0x3f6a2c, roughness: 0.7 });
    withWind(ivyMat, 'leafT', 0.015, 'ivy', time);
    const mesh = new THREE.Mesh(ivy, ivyMat);
    mesh.name = 'ivy'; mesh.receiveShadow = true;
    group.add(mesh);
    ivyLeaves = ivy.index!.count / 6;
    triangles += ivy.index!.count / 3; drawCalls++;
  }

  // --- Karst groves on the backdrop hills (instanced low-poly).
  const grove: THREE.Vector3[] = [];
  let gs = input.seed + 3;
  const gr = (): number => { gs = (gs * 16807) % 2147483647; return gs / 2147483647; };
  for (let i = 0; i < 3000 && grove.length < 520; i++) {
    const th = (gr() * 2 - 1) * THREE.MathUtils.degToRad(HILLS.arcDeg * 0.85);
    const rad = HILLS.innerRadius + 60 + gr() * (HILLS.outerRadius - HILLS.innerRadius - 120);
    const x = Math.cos(th) * rad, z = Math.sin(th) * rad, y = hillHeight(x, z);
    const slope = Math.hypot(hillHeight(x + 4, z) - y, hillHeight(x, z + 4) - y) / 4;
    const woods = Math.sin(x * 0.013) * Math.cos(z * 0.017) + Math.sin((x + z) * 0.007);
    if (y < 6 || y > 150 || slope > 0.55 || woods < 0.1) continue;
    grove.push(new THREE.Vector3(x, y - 0.3, z));
  }
  if (grove.length) {
    const gg = groveTreeGeometry();
    const im = new THREE.InstancedMesh(gg, new THREE.MeshLambertMaterial({ vertexColors: true }), grove.length);
    const tint = new THREE.Color();
    grove.forEach((p, i) => {
      const s = 0.8 + gr() * 0.7;
      im.setMatrixAt(i, m.compose(p, new THREE.Quaternion(), new THREE.Vector3(s, s * (0.9 + gr() * 0.3), s)));
      im.setColorAt(i, tint.setHSL(0.25 + gr() * 0.05, 0.38, 0.09 + gr() * 0.05)); // dark holm oak; haze lightens it with distance
    });
    im.name = 'karst-groves';
    im.computeBoundingSphere();
    group.add(im);
    triangles += (gg.getAttribute('position').count / 3) * grove.length; drawCalls++;
  }

  const update = (seconds: number, cam: THREE.Vector3): void => {
    time.value = seconds;
    for (const t of weedTiles) t.mesh.visible = Math.hypot(t.cx - cam.x, t.cz - cam.z) < 48;
  };
  const nearTiles = Math.min(weedTiles.length, 12);
  return {
    group, update,
    stats: { trees: spots.length, weeds: weeds.length, ivyLeaves, groves: grove.length, triangles: triangles + weedTris * Math.round(weeds.length / Math.max(1, weedTiles.length)) * nearTiles, drawCallsMax: drawCalls + nearTiles },
  };
}
