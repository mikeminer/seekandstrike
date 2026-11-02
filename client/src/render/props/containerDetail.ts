/**
 * Render-only detail for shipping containers and crates of a pipeline map (no collision change: every
 * piece sits on the surface of its collider box, protruding at most 3 cm).
 * Containers: frame rails along the edges, corner castings, and on the door end four locking bars with
 * cam handles. Crates: two steel bands. Geometry is merged per material (2 draw calls).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export interface DetailBox { c: { x: number; y: number; z: number }; s: { x: number; y: number; z: number }; node: string }

const box = (cx: number, cy: number, cz: number, sx: number, sy: number, sz: number): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  g.deleteAttribute('uv');
  return g.translate(cx, cy, cz);
};

/** Pure geometry builder (tested): returns frame/steel pieces and dark castings/handles. */
export function containerDetailGeometry(boxes: readonly DetailBox[]): { frame: THREE.BufferGeometry[]; dark: THREE.BufferGeometry[] } {
  const frame: THREE.BufferGeometry[] = [], dark: THREE.BufferGeometry[] = [];
  for (const b of boxes) {
    const { c, s } = b;
    const x0 = c.x - s.x / 2, x1 = c.x + s.x / 2, y0 = c.y - s.y / 2, y1 = c.y + s.y / 2, z0 = c.z - s.z / 2, z1 = c.z + s.z / 2;
    if (b.node.startsWith('blk_container')) {
      const r = 0.1, e = 0.015; // rail thickness, protrusion
      const alongX = s.x >= s.z;
      // Edge rails (top and bottom, along the length and the width).
      for (const y of [y0 + r / 2, y1 - r / 2]) {
        frame.push(box(c.x, y, z0 - e, s.x, r, r), box(c.x, y, z1 + e, s.x, r, r));
        frame.push(box(x0 - e, y, c.z, r, r, s.z), box(x1 + e, y, c.z, r, r, s.z));
      }
      // Corner posts and castings.
      for (const x of [x0, x1]) for (const z of [z0, z1]) {
        frame.push(box(x, c.y, z, r + e * 2, s.y, r + e * 2));
        // Castings sit inside the corner, proud of the faces by 2 cm.
        const ix = x === x0 ? x + 0.08 : x - 0.08, iz = z === z0 ? z + 0.08 : z - 0.08;
        for (const y of [y0 + 0.09, y1 - 0.09]) dark.push(box(ix, y, iz, 0.2, 0.18, 0.2));
      }
      // Door end: the +x (or +z) face. Four vertical locking bars with cam handles.
      const n = 4;
      for (let i = 0; i < n; i++) {
        const u = -0.42 + (i / (n - 1)) * 0.84; // across the end face
        if (alongX) {
          const z = c.z + u * s.z;
          frame.push(box(x1 + 0.03, c.y, z, 0.04, s.y - 0.3, 0.05));
          dark.push(box(x1 + 0.05, c.y - 0.1, z + 0.08, 0.04, 0.05, 0.22));
        } else {
          const x = c.x + u * s.x;
          frame.push(box(x, c.y, z1 + 0.03, 0.05, s.y - 0.3, 0.04));
          dark.push(box(x + 0.08, c.y - 0.1, z1 + 0.05, 0.22, 0.05, 0.04));
        }
      }
    } else if (b.node.startsWith('blk_crate')) {
      // Two steel bands around the crate.
      for (const f of [0.25, 0.75]) {
        const y = y0 + s.y * f;
        dark.push(box(c.x, y, z0 - 0.01, s.x + 0.02, 0.05, 0.02), box(c.x, y, z1 + 0.01, s.x + 0.02, 0.05, 0.02));
        dark.push(box(x0 - 0.01, y, c.z, 0.02, 0.05, s.z + 0.02), box(x1 + 0.01, y, c.z, 0.02, 0.05, s.z + 0.02));
      }
    }
  }
  return { frame, dark };
}

export function buildContainerDetail(boxes: readonly DetailBox[]): THREE.Group {
  const g = new THREE.Group();
  g.name = 'container-detail';
  const { frame, dark } = containerDetailGeometry(boxes);
  const add = (parts: THREE.BufferGeometry[], mat: THREE.Material, name: string): void => {
    if (!parts.length) return;
    const merged = mergeGeometries(parts, false)!;
    for (const p of parts) p.dispose();
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.name = name;
    g.add(mesh);
  };
  add(frame, new THREE.MeshStandardMaterial({ color: 0x6d6a64, roughness: 0.55, metalness: 0.6 }), 'container-frame');
  add(dark, new THREE.MeshStandardMaterial({ color: 0x2a2b2c, roughness: 0.5, metalness: 0.7 }), 'container-dark');
  return g;
}
