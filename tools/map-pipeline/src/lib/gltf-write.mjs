// SPDX-License-Identifier: GPL-3.0-or-later
// Small helper to author map GLBs from code (example maps, OSM baker). Original code for SEEK & STRIKE.
import { Document, NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';

/** Surface palette shared by authoring tools and the preview (linear-ish sRGB base colours, PBR params). */
export const MATERIALS = {
  concrete:      { color: [0.55, 0.54, 0.51], rough: 0.92, metal: 0.0 },
  concreteDark:  { color: [0.38, 0.38, 0.37], rough: 0.95, metal: 0.0 },
  asphalt:       { color: [0.16, 0.16, 0.17], rough: 0.97, metal: 0.0 },
  quayStone:     { color: [0.47, 0.45, 0.41], rough: 0.95, metal: 0.0 },
  brick:         { color: [0.55, 0.36, 0.27], rough: 0.9,  metal: 0.0 },
  plaster:       { color: [0.78, 0.72, 0.62], rough: 0.88, metal: 0.0 },
  roof:          { color: [0.33, 0.31, 0.30], rough: 0.85, metal: 0.1 },
  containerRed:  { color: [0.55, 0.14, 0.10], rough: 0.6,  metal: 0.55 },
  containerBlue: { color: [0.11, 0.24, 0.45], rough: 0.6,  metal: 0.55 },
  containerGrey: { color: [0.45, 0.47, 0.48], rough: 0.6,  metal: 0.55 },
  crate:         { color: [0.52, 0.40, 0.25], rough: 0.85, metal: 0.0 },
  steelPlate:    { color: [0.40, 0.41, 0.42], rough: 0.45, metal: 0.9 },
  barrier:       { color: [0.70, 0.69, 0.66], rough: 0.9,  metal: 0.0 },
  rail:          { color: [0.30, 0.27, 0.25], rough: 0.6,  metal: 0.8 },
  water:         { color: [0.05, 0.14, 0.17], rough: 0.08, metal: 0.0, alpha: 0.85 },
  grass:         { color: [0.25, 0.32, 0.17], rough: 0.95, metal: 0.0 },
  marker:        { color: [1.0, 0.0, 1.0],    rough: 1.0,  metal: 0.0 },
};

export function makeIO() {
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });
}

export class MapWriter {
  constructor(name, rootExtras = {}) {
    this.doc = new Document();
    this.doc.createBuffer('main');
    this.scene = this.doc.createScene(name);
    this.root = this.doc.createNode(name).setExtras({ mapFormat: 'seek-strike-map', version: 1, name, ...rootExtras });
    this.scene.addChild(this.root);
    this.mats = new Map();
  }

  material(key) {
    if (this.mats.has(key)) return this.mats.get(key);
    const m = MATERIALS[key] ?? MATERIALS.concrete;
    const mat = this.doc.createMaterial(key)
      .setBaseColorFactor([...m.color, m.alpha ?? 1])
      .setRoughnessFactor(m.rough).setMetallicFactor(m.metal);
    if (m.alpha !== undefined) mat.setAlphaMode('BLEND');
    this.mats.set(key, mat);
    return mat;
  }

  /** Adds a mesh node. geo = { position: Float32Array, normal?: Float32Array, uv?: Float32Array, index: Uint32Array|Uint16Array }. */
  mesh(name, geo, matKey, { translation, rotation, scale, extras, parent } = {}) {
    const d = this.doc, buf = d.getRoot().listBuffers()[0];
    const prim = d.createPrimitive()
      .setAttribute('POSITION', d.createAccessor().setType('VEC3').setArray(geo.position).setBuffer(buf))
      .setMaterial(this.material(matKey));
    if (geo.normal) prim.setAttribute('NORMAL', d.createAccessor().setType('VEC3').setArray(geo.normal).setBuffer(buf));
    if (geo.uv) prim.setAttribute('TEXCOORD_0', d.createAccessor().setType('VEC2').setArray(geo.uv).setBuffer(buf));
    const idx = geo.position.length / 3 > 65535 ? Uint32Array.from(geo.index) : Uint16Array.from(geo.index);
    prim.setIndices(d.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buf));
    const node = d.createNode(name).setMesh(d.createMesh(name).addPrimitive(prim));
    return this._place(node, { translation, rotation, scale, extras, parent });
  }

  /** Empty node (marker). */
  empty(name, { translation, rotation, scale, extras, parent } = {}) {
    return this._place(this.doc.createNode(name), { translation, rotation, scale, extras, parent });
  }

  _place(node, { translation, rotation, scale, extras, parent }) {
    if (translation) node.setTranslation(translation);
    if (rotation) node.setRotation(rotation);
    if (scale) node.setScale(scale);
    if (extras) node.setExtras(extras);
    (parent ?? this.root).addChild(node);
    return node;
  }

  async write(path) { await makeIO().write(path, this.doc); }
}

/** Unit-pivot-at-centre box with per-face normals and world-scaled UVs (1 UV = uvMeters). */
export function boxGeometry(sx, sy, sz, uvMeters = 2) {
  const hx = sx / 2, hy = sy / 2, hz = sz / 2;
  const faces = [
    [[1, 0, 0], [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], sz, sy],
    [[-1, 0, 0], [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], sz, sy],
    [[0, 1, 0], [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], sx, sz],
    [[0, -1, 0], [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], sx, sz],
    [[0, 0, 1], [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], sx, sy],
    [[0, 0, -1], [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], sx, sy],
  ];
  const position = [], normal = [], uv = [], index = [];
  for (const [n, vs, w, h] of faces) {
    const b = position.length / 3;
    vs.forEach((v) => { position.push(...v); normal.push(...n); });
    uv.push(0, 0, w / uvMeters, 0, w / uvMeters, h / uvMeters, 0, h / uvMeters);
    index.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return { position: new Float32Array(position), normal: new Float32Array(normal), uv: new Float32Array(uv), index: new Uint32Array(index) };
}

/** yaw (radians, about +Y) → quaternion [x,y,z,w]. */
export const yawQuat = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
