import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { Combatant } from '@shared/sim/combatant';
import { MOVE } from '@shared/sim/movement';
import type { Vec3 } from '@shared/sim/vec';
import { type CharacterModels, findMesh } from './models';
import type { RagdollSystem } from './ragdoll';

/**
 * Rigged soldiers (Stage 2). Body + skeleton + clips: Quaternius "Universal Base Characters" and
 * "Universal Animation Library" 1+2 (CC0, see ASSETS_LICENSES.md), merged offline.
 *
 * Per soldier: 3 draw calls (body, merged skinned gear, rifle) + their shadow passes.
 * - Uniform: procedural camo shader on the body (bind-pose object space), mask from skin weights:
 *   head = skin (or balaclava), hands = gloves, feet/ankles = boots, rest = uniform cloth.
 *   Faction A (attackers, team 0) multicam-style; faction B (defenders, team 1) urban grey/black.
 * - Gear: helmet, ear-pro, ballistic glasses, plate carrier, pouches, belt, knee pads, optional
 *   assault pack — generated in code as ONE SkinnedMesh rigidly weighted to the same skeleton.
 * - Animation: lower body (locomotion) and upper body (aim/fire/reload) layers on one mixer;
 *   downed = death clip clamped; revive = get-up clip; prone = procedural (body pitched + head lift).
 * - LOD: the N nearest (quality tier) get full meshes, per-frame mixer and left-hand IK; others get
 *   ~25% triangle LOD body, lite gear, LOD rifle and a mixer ticked at ~20 Hz.
 * - Death: Rapier ragdoll (cosmetic world, see ragdoll.ts); if no ragdoll slot is free, the death
 *   clip plays instead.
 */
export const SOLDIER_IS_BLOCKOUT = false;
export const SOLDIER_HEIGHT = MOVE.height.stand;

/** Rifle: R-space → hand_r bone. Barrel (R -X) along bone +Y, R up (+Y) along bone +Z. */
const RIFLE_SCALE = 0.42;
/** Points on the rifle in R space. */
export const RIFLE_POINTS = { muzzle: new THREE.Vector3(-0.97, 0.124, 0), handguard: new THREE.Vector3(-0.42, 0.0, 0.02), grip: new THREE.Vector3(0.36, -0.1, 0), butt: new THREE.Vector3(0.93, 0.03, 0) };

type Rgb = readonly [number, number, number];
interface FactionStyle {
  camo: readonly [Rgb, Rgb, Rgb, Rgb, Rgb];
  gear: readonly number[];
  helmet: readonly number[];
  glove: readonly number[];
  boot: readonly number[];
  balaclava: number;
  balaclavaChance: number;
}
const FACTIONS: readonly [FactionStyle, FactionStyle] = [
  { // A: attackers — multicam-like (tan / olive / brown / dark / cream), coyote & ranger-green gear.
    camo: [[0.56, 0.49, 0.37], [0.4, 0.4, 0.28], [0.42, 0.31, 0.21], [0.23, 0.2, 0.15], [0.72, 0.67, 0.55]],
    gear: [0x8a7553, 0x4d5339, 0x6f6446], helmet: [0x7d6b4f, 0x565a40, 0x8c7a5a], glove: [0x6b5b44, 0x2e2d29], boot: [0x7a6446, 0x5b4b37],
    balaclava: 0x4b4d3a, balaclavaChance: 0,
  },
  { // B: defenders — urban grey / slate / black, black & wolf-grey gear.
    camo: [[0.43, 0.44, 0.46], [0.31, 0.32, 0.34], [0.19, 0.2, 0.21], [0.1, 0.1, 0.11], [0.6, 0.61, 0.62]],
    gear: [0x26272a, 0x4a4c50, 0x33373d], helmet: [0x2c2d30, 0x45474b], glove: [0x1e1e1f, 0x2a2a2b], boot: [0x1c1c1d, 0x2b2a28],
    balaclava: 0x1d1e20, balaclavaChance: 0.5,
  },
];
const SKIN_TONES = [[1.12, 1.02, 0.95], [1.0, 0.92, 0.84], [0.88, 0.74, 0.62], [0.68, 0.53, 0.42], [0.46, 0.35, 0.28]] as const;

interface Variant { skin: number; gear: number; helmet: number; glove: number; boot: number; pack: boolean; knee: boolean; camoCarrier: boolean; camoHelmet: boolean; balaclava: boolean; cls: number; offset: THREE.Vector3 }

/** Deterministic variant from soldier id (≥5 distinct looks per faction). */
function variantFor(id: number, team: 0 | 1, cls = 0): Variant {
  let s = (id * 2654435761 + team * 97 + 12345) >>> 0;
  const r = (): number => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  const f = FACTIONS[team];
  const pick = (n: number): number => Math.floor(r() * n);
  const v: Variant = {
    skin: (id * 3 + team) % SKIN_TONES.length, gear: pick(f.gear.length), helmet: pick(f.helmet.length), glove: pick(f.glove.length), boot: pick(f.boot.length),
    pack: r() < 0.5, knee: r() < 0.75, camoCarrier: team === 0 && r() < 0.5, camoHelmet: team === 0 && r() < 0.6,
    balaclava: r() < f.balaclavaChance, offset: new THREE.Vector3(r() * 50, r() * 50, r() * 50), cls,
  };
  // Class silhouettes: the covert operative travels light and masked, everyone else carries their class kit (below).
  if (cls === 4) { v.pack = false; v.balaclava = true; }
  else if (cls === 1 || cls === 2 || cls === 3) v.pack = false;
  return v;
}

/** Helmet band colour per class (index = PlayerClass); soldier has none. */
const CLASS_BAND = [0, 0xd8d8d0, 0xd2a526, 0x3b78c4, 0x2a2a2a] as const;

// ---------------------------------------------------------------------------------------------
// Shaders (onBeforeCompile injections into MeshStandardMaterial; one program per kind).

const CAMO_GLSL = /* glsl */ `
uniform vec3 uCamo0; uniform vec3 uCamo1; uniform vec3 uCamo2; uniform vec3 uCamo3; uniform vec3 uCamo4;
uniform vec3 uCamoOffset;
varying vec3 vBind;
float sHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float sNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x), mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x), mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 camoAt(vec3 p) {
  p = p * vec3(1.0, 0.8, 1.0) + uCamoOffset;
  float a = sNoise(p * 5.0) * 0.65 + sNoise(p * 13.0) * 0.35;
  float b = sNoise(p * 8.0 + 7.3) * 0.7 + sNoise(p * 21.0) * 0.3;
  float c = sNoise(p * 16.0 + 3.1) * 0.8 + sNoise(p * 40.0) * 0.2;
  vec3 col = uCamo0;
  col = mix(col, uCamo1, smoothstep(0.5, 0.54, a));
  col = mix(col, uCamo2, smoothstep(0.6, 0.63, b));
  col = mix(col, uCamo3, smoothstep(0.7, 0.72, c));
  col = mix(col, uCamo4, smoothstep(0.3, 0.27, c) * 0.85);
  return col * (0.93 + 0.07 * sNoise(p * 90.0));
}`;

interface SoldierUniforms { [k: string]: THREE.IUniform }

function camoUniforms(team: 0 | 1, v: Variant): SoldierUniforms {
  const f = FACTIONS[team];
  const c = (x: Rgb): THREE.Color => new THREE.Color().setRGB(x[0], x[1], x[2], THREE.SRGBColorSpace);
  const sk = SKIN_TONES[v.skin]!;
  return {
    uCamo0: { value: c(f.camo[0]) }, uCamo1: { value: c(f.camo[1]) }, uCamo2: { value: c(f.camo[2]) }, uCamo3: { value: c(f.camo[3]) }, uCamo4: { value: c(f.camo[4]) },
    uCamoOffset: { value: v.offset },
    uGlove: { value: new THREE.Color(f.glove[v.glove]!) },
    uBoot: { value: new THREE.Color(f.boot[v.boot]!) },
    uSkinTone: { value: new THREE.Vector3(sk[0], sk[1], sk[2]) },
    uBalaclava: { value: v.balaclava ? 1 : 0 },
    uBalaclavaColor: { value: new THREE.Color(f.balaclava) },
    uInflate: { value: 0.006 },
  };
}

function bodyMaterial(base: THREE.MeshStandardMaterial, u: SoldierUniforms): THREE.MeshStandardMaterial {
  const m = base.clone();
  m.name = 'Soldier_Body_Uniform';
  m.side = THREE.FrontSide;
  m.customProgramCacheKey = () => 'soldier-body-v1';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute vec3 aMask; varying vec3 vMask; varying vec3 vBind; uniform float uInflate;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vMask = aMask; vBind = position;
transformed += normal * uInflate * (1.0 - aMask.x) * (1.0 - aMask.y);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vMask; uniform vec3 uGlove; uniform vec3 uBoot; uniform vec3 uSkinTone; uniform float uBalaclava; uniform vec3 uBalaclavaColor;
${CAMO_GLSL}`)
      .replace('#include <map_fragment>', `#include <map_fragment>
float skinM = clamp(vMask.x, 0.0, 1.0);
float bare = skinM * (1.0 - uBalaclava);
vec3 cloth = camoAt(vBind);
cloth = mix(cloth, uGlove, clamp(vMask.y, 0.0, 1.0));
cloth = mix(cloth, uBoot, clamp(vMask.z, 0.0, 1.0));
cloth = mix(cloth, uBalaclavaColor, skinM * uBalaclava);
diffuseColor.rgb = mix(cloth, diffuseColor.rgb * uSkinTone, bare);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(mix(0.93, 0.62, clamp(vMask.z + vMask.y * 0.4, 0.0, 1.0)), roughnessFactor, bare);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(mix(nonPerturbedNormal, normal, bare * 0.85 + 0.15));`);
  };
  return m;
}

function gearMaterial(u: SoldierUniforms): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0.02 });
  m.name = 'Soldier_Gear';
  m.customProgramCacheKey = () => 'soldier-gear-v1';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float aCamo; varying float vCamo; varying vec3 vBind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vCamo = aCamo; vBind = position;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vCamo;
${CAMO_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = mix(diffuseColor.rgb, camoAt(vBind) * 0.95, vCamo);`);
  };
  return m;
}

// ---------------------------------------------------------------------------------------------
// Body mask + gear geometry (bind pose: model faces +Z, Y up, metres).

function addBodyMask(geo: THREE.BufferGeometry, boneNames: string[], dequant: THREE.Matrix4): void {
  if (geo.getAttribute('aMask')) return;
  const si = geo.getAttribute('skinIndex'), sw = geo.getAttribute('skinWeight'), pos = geo.getAttribute('position');
  const isHead = boneNames.map((n) => n === 'Head');
  const isNeck = boneNames.map((n) => n === 'neck_01');
  const isHand = boneNames.map((n) => /^(hand|index|middle|pinky|ring|thumb)_/.test(n));
  const isFoot = boneNames.map((n) => /^(foot|ball)_/.test(n));
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    let head = 0, neck = 0, hand = 0, foot = 0;
    for (let k = 0; k < 4; k++) {
      const b = si.getComponent(i, k), w = sw.getComponent(i, k);
      if (isHead[b]) head += w; else if (isNeck[b]) neck += w; else if (isHand[b]) hand += w; else if (isFoot[b]) foot += w;
    }
    const y = _v1.fromBufferAttribute(pos, i).applyMatrix4(dequant).y;
    const collar = THREE.MathUtils.smoothstep(y, 1.535, 1.575);
    out[i * 3] = Math.min(1, head + neck * collar);
    out[i * 3 + 1] = THREE.MathUtils.smoothstep(hand, 0.35, 0.65);
    out[i * 3 + 2] = Math.max(THREE.MathUtils.smoothstep(foot, 0.3, 0.6), 1 - THREE.MathUtils.smoothstep(y, 0.2, 0.235));
  }
  geo.setAttribute('aMask', new THREE.BufferAttribute(out, 3));
}

class GearBuilder {
  private parts: THREE.BufferGeometry[] = [];
  constructor(private bone: (name: string) => number) {}
  add(g: THREE.BufferGeometry, bone: string, color: number, camo: boolean, at: [number, number, number], rot?: [number, number, number], scale?: [number, number, number]): void {
    let geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    geo.deleteAttribute('uv');
    const m = new THREE.Matrix4().compose(new THREE.Vector3(...at), new THREE.Quaternion().setFromEuler(new THREE.Euler(...(rot ?? [0, 0, 0]))), new THREE.Vector3(...(scale ?? [1, 1, 1])));
    geo.applyMatrix4(m);
    const n = geo.getAttribute('position').count;
    const col = new THREE.Color(color);
    const colors = new Float32Array(n * 3), cam = new Float32Array(n), si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const b = this.bone(bone);
    for (let i = 0; i < n; i++) {
      // Slight per-vertex value noise keeps flat gear from looking like plastic.
      const j = 0.94 + ((i * 7919) % 13) / 13 * 0.08;
      colors[i * 3] = col.r * j; colors[i * 3 + 1] = col.g * j; colors[i * 3 + 2] = col.b * j;
      cam[i] = camo ? 1 : 0; si[i * 4] = b; sw[i * 4] = 1;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('aCamo', new THREE.BufferAttribute(cam, 1));
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    this.parts.push(geo);
  }
  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    if (!g) throw new Error('gear merge failed');
    return g;
  }
}

/** Distinct, readable class gear: band on the helmet plus one large item on the back or chest. */
function classKit(B: GearBuilder, box: (w: number, h: number, d: number) => THREE.BufferGeometry, cls: number, camo: boolean, gear: number, seg: (n: number) => number): void {
  const band = CLASS_BAND[cls] ?? 0;
  if (band) B.add(new THREE.CylinderGeometry(1, 1, 0.02, seg(18), 1, true), 'Head', band, false, [0, 1.74, 0.004], undefined, [0.131, 1, 0.145]);
  switch (cls) {
    case 0: // soldier: spare magazines across the chest
      for (const x of [-0.07, 0, 0.07]) B.add(box(0.05, 0.1, 0.035), 'spine_03', gear, camo, [x, 1.4, 0.2]);
      break;
    case 1: // medic: large pale medical bag with a stripe
      B.add(box(0.3, 0.3, 0.14), 'spine_03', 0xc9cbc2, false, [0, 1.27, -0.28]);
      B.add(box(0.31, 0.05, 0.145), 'spine_03', 0x3f8f5a, false, [0, 1.3, -0.28]);
      break;
    case 2: // engineer: tool roll and a satchel
      B.add(box(0.28, 0.3, 0.13), 'spine_03', gear, camo, [0, 1.28, -0.27]);
      B.add(new THREE.CylinderGeometry(0.05, 0.05, 0.34, 10), 'spine_03', 0x6b5a2a, false, [0, 1.07, -0.3], [0, 0, Math.PI / 2]);
      B.add(box(0.16, 0.12, 0.08), 'pelvis', 0x6b5a2a, false, [-0.2, 0.96, 0.02]);
      break;
    case 3: // field ops: radio set with a tall antenna
      B.add(box(0.24, 0.28, 0.11), 'spine_03', 0x2b2d2a, false, [0, 1.29, -0.26]);
      B.add(new THREE.CylinderGeometry(0.006, 0.004, 0.75, 5), 'spine_03', 0x111111, false, [0.09, 1.72, -0.29]);
      B.add(box(0.05, 0.05, 0.03), 'spine_03', 0x3b78c4, false, [-0.07, 1.36, -0.325]);
      break;
    default: break; // covert ops: nothing extra (light kit, mask)
  }
}

function buildGear(team: 0 | 1, v: Variant, lite: boolean, bone: (n: string) => number, toBind: THREE.Matrix4, rest: (n: string) => THREE.Vector3): THREE.BufferGeometry {
  const f = FACTIONS[team];
  const gear = f.gear[v.gear]!, helmet = f.helmet[v.helmet]!, dark = 0x1a1b1d, strap = team === 0 ? 0x3d3a2e : 0x1f2023;
  const s = lite ? 0.5 : 1;
  const seg = (n: number): number => Math.max(6, Math.round(n * s));
  const B = new GearBuilder(bone);
  const box = (w: number, h: number, d: number): THREE.BufferGeometry => new THREE.BoxGeometry(w, h, d);
  // Helmet (high-cut), rails, NVG shroud, ear-pro.
  B.add(new THREE.SphereGeometry(1, seg(18), seg(10), 0, Math.PI * 2, 0, Math.PI * 0.53), 'Head', helmet, v.camoHelmet, [0, 1.722, 0.004], undefined, [0.126, 0.122, 0.14]);
  B.add(new THREE.CylinderGeometry(1, 1, 0.012, seg(18), 1, true), 'Head', helmet, v.camoHelmet, [0, 1.716, 0.004], undefined, [0.128, 1, 0.142]);
  if (!lite) {
    B.add(box(0.016, 0.026, 0.11), 'Head', dark, false, [0.125, 1.74, 0.0]);
    B.add(box(0.016, 0.026, 0.11), 'Head', dark, false, [-0.125, 1.74, 0.0]);
    B.add(box(0.05, 0.032, 0.022), 'Head', dark, false, [0, 1.79, 0.137], [-0.35, 0, 0]);
    for (const x of [-1, 1]) B.add(new THREE.CylinderGeometry(0.043, 0.043, 0.036, 12), 'Head', team === 0 ? 0x3a3c30 : dark, false, [x * 0.1, 1.678, -0.006], [0, 0, Math.PI / 2]);
    // Ballistic glasses: front lens + wrap-around sides.
    B.add(box(0.11, 0.034, 0.008), 'Head', 0x101214, false, [0, 1.703, 0.113]);
    for (const x of [-1, 1]) B.add(box(0.05, 0.03, 0.008), 'Head', 0x101214, false, [x * 0.071, 1.704, 0.096], [0, x * 0.75, 0]);
  }
  // Plate carrier: front/back plates, cummerbund, shoulder straps, pouches.
  B.add(box(0.29, 0.3, 0.045), 'spine_03', gear, v.camoCarrier, [0, 1.3, 0.152], [-0.06, 0, 0]);
  B.add(box(0.29, 0.33, 0.045), 'spine_03', gear, v.camoCarrier, [0, 1.31, -0.19], [0.05, 0, 0]);
  B.add(new THREE.CylinderGeometry(1, 1, 0.15, seg(16), 1, true), 'spine_02', gear, v.camoCarrier, [0, 1.2, -0.012], undefined, [0.188, 1, 0.162]);
  for (const x of [-1, 1]) B.add(box(0.06, 0.022, 0.36), 'spine_03', strap, false, [x * 0.105, 1.545, -0.02]);
  if (!lite) {
    for (const x of [-0.085, 0, 0.085]) B.add(box(0.074, 0.11, 0.05), 'spine_02', gear, v.camoCarrier, [x, 1.205, 0.188]);
    B.add(box(0.16, 0.08, 0.03), 'spine_03', gear, v.camoCarrier, [0, 1.385, 0.19], [-0.06, 0, 0]);
    B.add(box(0.06, 0.14, 0.055), 'spine_02', gear, false, [-0.16, 1.24, -0.13]); // radio
    B.add(new THREE.CylinderGeometry(0.004, 0.004, 0.26, 4), 'spine_02', dark, false, [-0.17, 1.42, -0.15]);
    B.add(box(0.06, 0.08, 0.04), 'spine_02', gear, false, [0.17, 1.22, 0.05]); // IFAK
  }
  // Belt + dump pouch.
  B.add(new THREE.CylinderGeometry(1, 1, 0.055, seg(16), 1, true), 'pelvis', strap, false, [0, 1.005, -0.028], undefined, [0.185, 1, 0.142]);
  if (!lite) B.add(box(0.1, 0.1, 0.06), 'pelvis', gear, false, [0.12, 0.94, -0.16]);
  // Knee pads.
  for (const side of ['l', 'r'] as const) {
    const knee = rest(`calf_${side}`), ankle = rest(`foot_${side}`), ball = rest(`ball_${side}`);
    if (v.knee) B.add(box(0.09, 0.1, 0.03), `calf_${side}`, dark, false, [knee.x, knee.y - 0.03, knee.z + 0.07], [0.08, 0, 0]);
    // Boots: shaft round the ankle + foot box + toe cap + sole (the base body has bare feet).
    const boot = f.boot[v.boot]!, sole = 0x161616;
    const heelZ = ankle.z - 0.06, toeZ = ball.z + 0.075, len = toeZ - heelZ, midZ = (toeZ + heelZ) / 2;
    const fx = (ball.x + ankle.x) / 2;
    B.add(new THREE.CylinderGeometry(0.05, 0.056, 0.17, seg(12)), `foot_${side}`, boot, false, [ankle.x, ankle.y + 0.03, ankle.z - 0.012]);
    B.add(new THREE.CapsuleGeometry(0.045, Math.max(0.02, len * 0.62 - 0.09), 3, seg(10)), `foot_${side}`, boot, false, [fx, 0.058, heelZ + len * 0.36], [Math.PI / 2, 0, 0], [1.12, 1, 1]);
    B.add(new THREE.CapsuleGeometry(0.044, Math.max(0.02, len * 0.45 - 0.088), 3, seg(10)), `ball_${side}`, boot, false, [ball.x, 0.047, toeZ - len * 0.24], [Math.PI / 2, 0, 0], [1.12, 0.85, 1]);
    B.add(box(0.105, 0.024, len + 0.012), `foot_${side}`, sole, false, [fx, 0.012, midZ]);
  }
  classKit(B, box, v.cls, v.camoCarrier, gear, seg);
  // Assault pack.
  if (v.pack) {
    B.add(box(0.27, 0.34, 0.13), 'spine_03', gear, v.camoCarrier, [0, 1.28, -0.275]);
    if (!lite) B.add(box(0.2, 0.12, 0.04), 'spine_03', gear, false, [0, 1.22, -0.355]);
  }
  return B.build().applyMatrix4(toBind);
}

// ---------------------------------------------------------------------------------------------

const LOWER = /^(pelvis|thigh_|calf_|foot_|ball_)/;
function filtered(clip: THREE.AnimationClip, keep: (bone: string) => boolean, name: string): THREE.AnimationClip {
  const tracks = clip.tracks.filter((t) => keep(t.name.split('.')[0]!));
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

export class SoldierFactory {
  private bodyFull: THREE.BufferGeometry;
  private bodyLod: THREE.BufferGeometry;
  private bodyBase: THREE.MeshStandardMaterial;
  private rifleFull: THREE.Mesh;
  private rifleLod: THREE.Mesh;
  private gearCache = new Map<string, THREE.BufferGeometry>();
  /** @internal */ readonly clips = new Map<string, THREE.AnimationClip>();
  private ownedMats: THREE.Material[] = [];
  private dequant = new THREE.Matrix4();
  private toBind = new THREE.Matrix4();
  private skel: THREE.Skeleton;

  constructor(private models: CharacterModels, readonly ragdolls: RagdollSystem | null) {
    const body = findMesh(models.soldier, 'Body') as THREE.SkinnedMesh;
    const lod = findMesh(models.soldier, 'Body_LOD1') as THREE.SkinnedMesh;
    const names = body.skeleton.bones.map((b) => b.name);
    this.skel = body.skeleton;
    this.bodyFull = body.geometry; this.bodyLod = lod.geometry;
    // Mesh quantization (gltfpack) bakes a dequantize transform into the inverse bind matrices, so the
    // geometry's bind space is not metres. dequant: bind space -> model metres (from the rest pose).
    const b0 = body.skeleton.bones[0]!;
    this.dequant.copy(body.bindMatrixInverse).multiply(b0.matrixWorld).multiply(body.skeleton.boneInverses[0]!).multiply(body.bindMatrix);
    this.toBind.copy(this.dequant).invert();
    addBodyMask(this.bodyFull, names, this.dequant); addBodyMask(this.bodyLod, lod.skeleton.bones.map((b) => b.name), this.dequant);
    this.bodyBase = body.material as THREE.MeshStandardMaterial;
    this.rifleFull = findMesh(models.rifle, 'Rifle');
    this.rifleLod = findMesh(models.rifle, 'Rifle_LOD1');
    if (!this.rifleLod.geometry.getAttribute('normal')) this.rifleLod.geometry.computeVertexNormals();
    for (const c of models.soldier.animations) {
      if (['death', 'getUp'].includes(c.name)) this.clips.set(c.name, c);
      if (['idle', 'walk', 'run', 'sprint', 'crouchIdle', 'crouchWalk'].includes(c.name)) this.clips.set(c.name, filtered(c, (b) => LOWER.test(b), c.name));
      if (['aimIdle', 'aim', 'aimUp', 'aimDown', 'fire', 'reload', 'hit'].includes(c.name)) this.clips.set(`up:${c.name}`, filtered(c, (b) => !LOWER.test(b) && b !== 'root', `up:${c.name}`));
    }
  }

  create(team: 0 | 1, id = 0, cls = 0): SoldierView { return new SoldierView(this, team, id, cls); }

  /** @internal */ gear(team: 0 | 1, v: Variant, lite: boolean, bone: (n: string) => number): THREE.BufferGeometry {
    const key = `${team}:${v.gear}:${v.helmet}:${v.pack}:${v.knee}:${v.camoCarrier}:${v.camoHelmet}:${v.balaclava}:${v.cls}:${lite}`;
    let g = this.gearCache.get(key);
    if (!g) { g = buildGear(team, v, lite, bone, this.toBind, (n) => {
      // Bind-pose joint position in model metres: dequant · boneInverse⁻¹.
      const inv = this.skel.boneInverses[bone(n)]!;
      return new THREE.Vector3().setFromMatrixPosition(new THREE.Matrix4().copy(inv).invert().premultiply(this.dequant));
    }); this.gearCache.set(key, g); }
    return g;
  }
  /** @internal */ instance(): { root: THREE.Object3D; body: THREE.SkinnedMesh; full: THREE.BufferGeometry; lod: THREE.BufferGeometry } {
    const root = SkeletonUtils.clone(this.models.soldier.scene);
    const lod = root.getObjectByName('Body_LOD1');
    lod?.removeFromParent();
    const body = root.getObjectByName('Body') as THREE.SkinnedMesh;
    return { root, body, full: this.bodyFull, lod: this.bodyLod };
  }
  /** @internal */ materials(team: 0 | 1, v: Variant): { body: THREE.MeshStandardMaterial; gear: THREE.MeshStandardMaterial } {
    const u = camoUniforms(team, v);
    const m = { body: bodyMaterial(this.bodyBase, u), gear: gearMaterial(u) };
    this.ownedMats.push(m.body, m.gear);
    return m;
  }
  /** @internal */ rifle(lod: boolean): THREE.Mesh { return lod ? this.rifleLod : this.rifleFull; }

  dispose(): void {
    for (const g of this.gearCache.values()) g.dispose();
    this.gearCache.clear();
    for (const m of this.ownedMats) m.dispose();
    this.ownedMats = [];
    // Body/rifle geometry, base materials and textures belong to the CharacterModels (disposed by owner).
  }
}

type Layer = 'lower' | 'upper' | 'full';
interface Act { a: THREE.AnimationAction; w: number; layer: Layer }

const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();

/**
 * Finger curl (radians for joints 01..03) applied after the arm IK so the hands wrap the rifle
 * instead of staying flat: firing hand closes round the pistol grip, support hand cups the handguard.
 */
type Curl = Record<'index' | 'middle' | 'ring' | 'pinky' | 'thumb', readonly [number, number, number]>;
const GRIP_CURL: Curl = { index: [0.3, 0.55, 0.35], middle: [0.85, 1.1, 0.85], ring: [0.95, 1.15, 0.85], pinky: [1.0, 1.15, 0.85], thumb: [0.35, 0.45, 0.3] };
const GUARD_CURL: Curl = { index: [0.5, 0.75, 0.5], middle: [0.8, 1.0, 0.8], ring: [0.85, 1.05, 0.8], pinky: [0.9, 1.05, 0.8], thumb: [0.2, 0.3, 0.2] };
/** Local axis and per-side sign the UAL finger bones curl around (checked in the dev lab). */
const CURL_AXIS: 'x' | 'y' | 'z' = 'z';
const CURL_SIGN = { l: 1, r: -1 } as const;
const _m4 = new THREE.Matrix4();
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

export class SoldierView {
  readonly root = new THREE.Group();
  /** Turns the +Z-facing model to the sim's -Z facing; pitched for prone. */
  private pivot = new THREE.Group();
  private model: THREE.Object3D;
  private body: THREE.SkinnedMesh;
  private gear: THREE.SkinnedMesh;
  private rifle: THREE.Group;
  private rifleMesh: THREE.Mesh;
  readonly muzzle = new THREE.Object3D();
  private flash: THREE.Sprite | null = null;
  private bones = new Map<string, THREE.Bone>();
  private rest = new Map<THREE.Bone, { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }>();
  private mixer: THREE.AnimationMixer;
  private acts = new Map<string, Act>();
  private geo: { full: THREE.BufferGeometry; lod: THREE.BufferGeometry; gearFull: THREE.BufferGeometry; gearLite: THREE.BufferGeometry };
  private detailed: boolean | null = null;
  private mixerAcc = 0;
  private lastState: Combatant['health']['state'] = 'alive';
  private lastShots = 0;
  private lastPhase = 'ready';
  private fireT = 9;
  private hitT = 9;
  private getUpT = 9;
  private blend = { prone: 0, downed: 0 };
  private hitDir = new THREE.Vector3(0, 0, 1);
  private deadFor = 0;
  /** True while the body is driven by the ragdoll (or frozen after it). */
  ragdolled = false;
  readonly team: 0 | 1;
  /** Class whose kit this view was built with. */
  readonly cls: number;

  constructor(private f: SoldierFactory, team: 0 | 1, id: number, cls = 0) {
    this.team = team;
    this.cls = cls;
    const v = variantFor(id, team, cls);
    const inst = f.instance();
    this.model = inst.root;
    this.body = inst.body;
    this.root.name = `soldier-${team === 0 ? 'A' : 'B'}-${id}`;
    this.root.add(this.pivot);
    this.pivot.rotation.y = Math.PI;
    this.pivot.add(this.model);
    this.model.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        const b = o as THREE.Bone;
        this.bones.set(b.name, b);
        this.rest.set(b, { p: b.position.clone(), q: b.quaternion.clone(), s: b.scale.clone() });
      }
    });
    const names = this.body.skeleton.bones.map((b) => b.name);
    const boneIx = (n: string): number => { const i = names.indexOf(n); if (i < 0) throw new Error(`bone ${n}`); return i; };
    const mats = f.materials(team, v);
    this.body.material = mats.body;
    this.body.castShadow = true;
    this.body.receiveShadow = true;
    this.body.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.8, 0), 1.9);
    this.geo = { full: inst.full, lod: inst.lod, gearFull: f.gear(team, v, false, boneIx), gearLite: f.gear(team, v, true, boneIx) };
    this.gear = new THREE.SkinnedMesh(this.geo.gearFull, mats.gear);
    this.gear.name = 'Gear';
    this.gear.castShadow = true;
    this.gear.boundingSphere = this.body.boundingSphere;
    this.body.parent!.add(this.gear);
    this.gear.bind(this.body.skeleton, this.body.bindMatrix);

    // Third-person rifle in the right hand.
    // While alive it is placed procedurally each pose update (grip in the right palm, barrel
    // along the aim); on death / get-up it is re-parented to the hand so it falls with the body.
    this.rifle = new THREE.Group();
    this.rifle.name = 'Rifle3P';
    this.root.add(this.rifle);
    this.rifleMesh = new THREE.Mesh(f.rifle(false).geometry, f.rifle(false).material);
    this.rifleMesh.matrixAutoUpdate = false;
    this.rifleMesh.matrix.copy(f.rifle(false).matrixWorld);
    this.rifleMesh.castShadow = true;
    this.rifle.add(this.rifleMesh);
    this.muzzle.position.copy(RIFLE_POINTS.muzzle);
    this.rifle.add(this.muzzle);

    this.mixer = new THREE.AnimationMixer(this.model);
    for (const [name, clip] of f.clips) {
      const layer: Layer = name.startsWith('up:') ? 'upper' : ['death', 'getUp'].includes(name) ? 'full' : 'lower';
      const a = this.mixer.clipAction(clip);
      if (['death', 'getUp', 'up:fire', 'up:reload', 'up:hit', 'knockback'].includes(name)) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
      a.play(); a.setEffectiveWeight(0);
      a.time = Math.random() * clip.duration;
      this.acts.set(name, { a, w: 0, layer });
    }
    this.setDetailed(true);
  }

  bone(name: string): THREE.Bone {
    const b = this.bones.get(name);
    if (!b) throw new Error(`bone ${name}`);
    return b;
  }

  setFlash(s: THREE.Sprite): void { this.flash = s; this.muzzle.add(s); s.visible = false; s.scale.setScalar(0.6); }

  /** Called on a damage event so death reactions/ragdolls push away from the shooter. */
  hit(dir: Vec3): void { this.hitDir.set(dir.x, dir.y, dir.z).normalize(); this.hitT = 0; }

  private setDetailed(d: boolean): void {
    if (this.detailed === d) return;
    this.detailed = d;
    this.body.geometry = d ? this.geo.full : this.geo.lod;
    this.gear.geometry = d ? this.geo.gearFull : this.geo.gearLite;
    const r = this.f.rifle(!d);
    this.rifleMesh.geometry = r.geometry; this.rifleMesh.material = r.material; this.rifleMesh.matrix.copy(r.matrixWorld);
  }

  private restPose(): void { for (const [b, r] of this.rest) { b.position.copy(r.p); b.quaternion.copy(r.q); b.scale.copy(r.s); } }

  private play(name: string, from = 0): void { const x = this.acts.get(name); if (x) { x.a.reset(); x.a.time = from; x.a.play(); } }

  update(c: Combatant, dt: number, detailed: boolean, flashOn: boolean): void {
    const state = c.health.state;
    // --- State transitions.
    if (state !== this.lastState) {
      if (state === 'downed') { this.play('death'); }
      if (state === 'alive' && this.lastState === 'downed') { this.play('getUp'); this.getUpT = 0; }
      if (state === 'dead') {
        this.deadFor = 0;
        const rd = this.f.ragdolls;
        this.root.updateMatrixWorld(true);
        const push = this.hitDir.clone().multiplyScalar(this.lastState === 'alive' ? 3.2 : 0.6);
        this.ragdolled = !!rd && rd.spawn(this, push);
        if (!this.ragdolled && this.lastState === 'alive') this.play('death');
      }
      if (state === 'alive' && this.lastState === 'dead') {
      this.holdRifle(true);
        this.f.ragdolls?.release(this);
        this.ragdolled = false;
        this.restPose();
        this.blend.downed = 0;
      }
      this.lastState = state;
    }
    if (state === 'dead') {
      this.holdRifle(false);
      this.deadFor += dt;
      this.root.visible = this.deadFor < 14;
      if (this.flash) this.flash.visible = false;
      if (!this.ragdolled) this.tickMixer(dt, true); // fallback: death clip
      return;
    }
    this.root.visible = true;
    this.setDetailed(detailed);
    this.root.position.set(c.pos.x, c.pos.y, c.pos.z);
    this.root.rotation.y = c.yaw;

    const k = 1 - Math.exp(-dt * 8);
    const downed = state === 'downed';
    const prone = c.move.stance === 'prone' && !downed;
    this.blend.prone += ((prone ? 1 : 0) - this.blend.prone) * k;
    this.blend.downed += ((downed ? 1 : 0) - this.blend.downed) * Math.min(1, dt * 3);
    this.getUpT += dt; this.fireT += dt; this.hitT += dt;

    const w = c.weapon;
    if (w.shotsFired !== this.lastShots) { this.lastShots = w.shotsFired; this.fireT = 0; this.play('up:fire', 0.02); }
    if (w.phase === 'reloading' && this.lastPhase !== 'reloading') {
      const r = this.acts.get('up:reload')!;
      this.play('up:reload');
      r.a.timeScale = r.a.getClip().duration / Math.max(0.5, w.reloadTotal);
    }
    this.lastPhase = w.phase;

    // --- Target weights.
    const tgt: Record<string, number> = {};
    const fullBody = downed ? 'death' : this.getUpT < 1.4 ? 'getUp' : null;
    if (fullBody) tgt[fullBody] = 1;
    else {
      const crouch = c.move.stance === 'crouch';
      const sp = c.speed;
      if (prone) tgt.idle = 1;
      else if (crouch) { const m = THREE.MathUtils.clamp(sp / 1.0, 0, 1); tgt.crouchIdle = 1 - m; tgt.crouchWalk = m; }
      else if (c.move.sprinting && sp > 3) tgt.sprint = 1;
      else {
        const wk = THREE.MathUtils.clamp(sp / 1.4, 0, 1), rn = THREE.MathUtils.clamp((sp - 1.6) / 1.8, 0, 1);
        tgt.idle = 1 - wk; tgt.walk = wk * (1 - rn); tgt.run = wk * rn;
      }
      const reloading = w.phase === 'reloading';
      const aiming = !c.move.sprinting && (c.sinceShot < 2 || c.input.aim || w.ads > 0.3 || prone);
      if (reloading) tgt['up:reload'] = 1;
      else if (this.fireT < 0.14) tgt['up:fire'] = 1;
      else if (this.hitT < 0.3) tgt['up:hit'] = 0.7;
      if (!reloading) {
        const rest = 1 - (tgt['up:fire'] ?? 0) - (tgt['up:hit'] ?? 0);
        if (aiming) {
          const pitch = prone ? 0.7 : c.pitch;
          const up = THREE.MathUtils.clamp(pitch / 0.9, 0, 1), dn = THREE.MathUtils.clamp(-pitch / 0.9, 0, 1);
          tgt['up:aimUp'] = up * rest; tgt['up:aimDown'] = dn * rest; tgt['up:aim'] = (1 - up - dn) * rest;
        } else tgt['up:aimIdle'] = rest;
      }
    }
    const kw = 1 - Math.exp(-dt * 12);
    for (const [name, x] of this.acts) {
      const t = tgt[name] ?? 0;
      x.w += (t - x.w) * (name === 'up:fire' || name === 'death' ? 1 : kw);
      if (x.w < 0.002 && t === 0) x.w = 0;
      x.a.setEffectiveWeight(x.w);
    }
    // Locomotion clips play at the speed the body moves.
    const scale = (n: string, native: number): void => { const x = this.acts.get(n); if (x) x.a.timeScale = THREE.MathUtils.clamp(c.speed / native, 0.6, 1.6); };
    scale('walk', 1.4); scale('run', 3.4); scale('sprint', 5.6); scale('crouchWalk', 1.1);

    const ticked = this.tickMixer(dt, detailed);

    // --- Procedural layers (applied only on frames the mixer re-posed the bones).
    const pr = this.blend.prone, dn = this.blend.downed;
    this.pivot.rotation.x = -pr * (Math.PI / 2 - 0.08);
    // Prone: lie along the facing direction (feet ~0.95 m behind origin); downed: shift so the
    // fall-backward pose lines up with the shared downed hit volumes.
    this.pivot.position.set(0, pr * 0.12, pr * 0.95 - dn * 0.44);
    if (!ticked) { /* keep last pose */ } else if (pr > 0.01) {
      // Prop the chest up and lift the head so the soldier looks/aims forward while lying.
      this.bone('spine_02').rotateX(-0.35 * pr);
      this.bone('spine_03').rotateX(-0.35 * pr);
      this.bone('neck_01').rotateX(-0.5 * pr);
      this.bone('Head').rotateX(-0.3 * pr);
      this.bone('thigh_l').rotateZ(0.12 * pr); this.bone('thigh_r').rotateZ(-0.12 * pr);
    } else if (!fullBody && this.acts.get('up:aim')!.w > 0.05) {
      // Aim pitch follows the sim a bit more than the 3 pose clips give.
      this.bone('spine_03').rotateX(-c.pitch * 0.25);
    }
    this.holdRifle(!fullBody);
    if (ticked && !fullBody) {
      this.root.updateMatrixWorld(true);
      const idle = this.acts.get('up:aimIdle')!.w, rel = this.acts.get('up:reload')!.w;
      const pitch = THREE.MathUtils.lerp(pr > 0.5 ? 0.05 : c.pitch, c.move.sprinting ? -0.75 : -0.45, Math.min(1, idle + rel * 0.6));
      this.placeRifle(pitch, c.move.sprinting ? 0.5 : idle * 0.25);
      this.armIK('r', this.rifle.localToWorld(_v4.copy(RIFLE_POINTS.grip)));
      this.curlHand('r', GRIP_CURL);
      if (rel < 0.5) { this.armIK('l', this.rifle.localToWorld(_v4.copy(RIFLE_POINTS.handguard))); this.curlHand('l', GUARD_CURL); }
    }
    if (this.flash) {
      this.flash.visible = flashOn;
      if (flashOn) { this.flash.material.rotation = Math.random() * Math.PI; this.flash.scale.setScalar(0.45 + Math.random() * 0.3); }
    }
  }

  private tickMixer(dt: number, detailed: boolean): boolean {
    this.mixerAcc += dt;
    const step = detailed ? 0 : 1 / 20;
    if (this.mixerAcc < step) return false;
    this.mixer.update(this.mixerAcc); this.mixerAcc = 0;
    return true;
  }

  private held = true;
  /** true: rifle lives under root (procedural); false: attached to hand_r keeping its world pose. */
  private holdRifle(hold: boolean): void {
    if (hold === this.held) return;
    this.held = hold;
    this.root.updateMatrixWorld(true);
    (hold ? this.root : this.bone('hand_r')).attach(this.rifle);
  }

  private placeRifle(pitch: number, yawOff: number): void {
    // Butt in the right shoulder pocket.
    const pocket = this.root.worldToLocal(this.bone('upperarm_r').getWorldPosition(_v1).lerp(this.bone('spine_03').getWorldPosition(_v2), 0.35));
    const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yawOff), sy = Math.sin(yawOff);
    const fwd = _v2.set(-sy * cp, sp, -cy * cp); // root space: -Z forward
    const up = _v3.set(sy * sp, cp, cy * sp);
    const xAxis = fwd.clone().negate();
    const zAxis = new THREE.Vector3().crossVectors(xAxis, up);
    _m4.makeBasis(xAxis, up, zAxis);
    this.rifle.quaternion.setFromRotationMatrix(_m4);
    this.rifle.scale.setScalar(RIFLE_SCALE);
    pocket.y += 0.05;
    this.rifle.position.copy(pocket).sub(_v4.copy(RIFLE_POINTS.butt).multiplyScalar(RIFLE_SCALE).applyQuaternion(this.rifle.quaternion));
    this.rifle.updateMatrixWorld(true);
  }

  /**
   * Two-bone IK placing a hand's palm on a rifle point (world). The free UAL upper-body clips
   * are pistol two-handed, so both hands are solved onto the rifle (grip / handguard).
   */
  private armIK(side: 'l' | 'r', palmTarget: THREE.Vector3): void {
    const up = this.bone(`upperarm_${side}`), lo = this.bone(`lowerarm_${side}`), ha = this.bone(`hand_${side}`);
    const wrist = ha.getWorldPosition(_v3);
    const palm = this.bone(`middle_01_${side}`).getWorldPosition(_v4).lerp(wrist, 0.45);
    const target = palmTarget.clone().sub(palm.sub(wrist));
    const a = up.getWorldPosition(_v1), b = lo.getWorldPosition(_v2), c = wrist;
    const lab = a.distanceTo(b), lcb = b.distanceTo(c);
    const at = new THREE.Vector3().subVectors(target, a);
    const lat = THREE.MathUtils.clamp(at.length(), 0.01, lab + lcb - 0.01);
    const ac = new THREE.Vector3().subVectors(c, a), ab = new THREE.Vector3().subVectors(b, a);
    const ba = new THREE.Vector3().subVectors(a, b), bc = new THREE.Vector3().subVectors(c, b);
    const ang = (x: THREE.Vector3, y: THREE.Vector3): number => Math.acos(THREE.MathUtils.clamp(x.clone().normalize().dot(y.clone().normalize()), -1, 1));
    const acab0 = ang(ac, ab), babc0 = ang(ba, bc), acat0 = ang(ac, at);
    const acab1 = Math.acos(THREE.MathUtils.clamp((lcb * lcb - lab * lab - lat * lat) / (-2 * lab * lat), -1, 1));
    const babc1 = Math.acos(THREE.MathUtils.clamp((lat * lat - lab * lab - lcb * lcb) / (-2 * lab * lcb), -1, 1));
    const axis0 = new THREE.Vector3().crossVectors(ac, ab);
    if (axis0.lengthSq() < 1e-8) return;
    axis0.normalize();
    const axis1 = new THREE.Vector3().crossVectors(ac, at);
    const r0 = _q1.setFromAxisAngle(axis0, acab1 - acab0);
    const r1 = new THREE.Quaternion().setFromAxisAngle(axis0, babc1 - babc0);
    const r2 = axis1.lengthSq() > 1e-8 ? new THREE.Quaternion().setFromAxisAngle(axis1.normalize(), acat0) : new THREE.Quaternion();
    const upW = up.getWorldQuaternion(_q2), loW = lo.getWorldQuaternion(_q3);
    // lower: world' = r1 * world → local = upperWorld⁻¹ * world'
    const loNew = r1.clone().multiply(loW);
    lo.quaternion.copy(upW.clone().invert().multiply(loNew));
    const upNew = r2.clone().multiply(r0).multiply(upW);
    const parentW = up.parent!.getWorldQuaternion(new THREE.Quaternion());
    up.quaternion.copy(parentW.invert().multiply(upNew));
    up.updateMatrixWorld(true);
  }

  private curlHand(side: 'l' | 'r', curl: Curl): void {
    const sign = CURL_SIGN[side];
    for (const finger of ['index', 'middle', 'ring', 'pinky', 'thumb'] as const) {
      for (let j = 0; j < 3; j++) {
        const b = this.bones.get(`${finger}_0${j + 1}_${side}`);
        if (b) b.rotation[CURL_AXIS] += sign * curl[finger][j]!;
      }
    }
  }

  /** @internal ragdoll access */ boneMap(): Map<string, THREE.Bone> { return this.bones; }

  dispose(): void {
    this.f.ragdolls?.release(this);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.root.removeFromParent();
  }
}

/** Camo cloth for first-person sleeves (same pattern as the faction uniform; object-space). */
export function clothMaterial(team: 0 | 1, seed = 1): THREE.MeshStandardMaterial {
  const u = camoUniforms(team, variantFor(seed, team));
  const m = new THREE.MeshStandardMaterial({ roughness: 0.93, metalness: 0 });
  m.name = 'Sleeve_Camo';
  m.customProgramCacheKey = () => 'soldier-cloth-v1';
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vBind;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vBind = position * 1.6;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
${CAMO_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb = camoAt(vBind);`);
  };
  return m;
}
