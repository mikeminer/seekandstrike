// SPDX-License-Identifier: GPL-3.0-or-later
// Minimal column-major mat4 / quaternion helpers (glTF conventions).
export const xform = (m, x, y, z) => [
  m[0] * x + m[4] * y + m[8] * z + m[12],
  m[1] * x + m[5] * y + m[9] * z + m[13],
  m[2] * x + m[6] * y + m[10] * z + m[14],
];
/** Decompose TRS (no shear). Returns { t, r:[x,y,z,w], s }. */
export function decompose(m) {
  const sx = Math.hypot(m[0], m[1], m[2]), sy = Math.hypot(m[4], m[5], m[6]), sz = Math.hypot(m[8], m[9], m[10]);
  const r00 = m[0] / sx, r10 = m[1] / sx, r20 = m[2] / sx;
  const r01 = m[4] / sy, r11 = m[5] / sy, r21 = m[6] / sy;
  const r02 = m[8] / sz, r12 = m[9] / sz, r22 = m[10] / sz;
  const tr = r00 + r11 + r22;
  let q;
  if (tr > 0) { const S = Math.sqrt(tr + 1) * 2; q = [(r21 - r12) / S, (r02 - r20) / S, (r10 - r01) / S, 0.25 * S]; }
  else if (r00 > r11 && r00 > r22) { const S = Math.sqrt(1 + r00 - r11 - r22) * 2; q = [0.25 * S, (r01 + r10) / S, (r02 + r20) / S, (r21 - r12) / S]; }
  else if (r11 > r22) { const S = Math.sqrt(1 + r11 - r00 - r22) * 2; q = [(r01 + r10) / S, 0.25 * S, (r12 + r21) / S, (r02 - r20) / S]; }
  else { const S = Math.sqrt(1 + r22 - r00 - r11) * 2; q = [(r02 + r20) / S, (r12 + r21) / S, 0.25 * S, (r10 - r01) / S]; }
  return { t: [m[12], m[13], m[14]], r: q, s: [sx, sy, sz], basis: [[r00, r10, r20], [r01, r11, r21], [r02, r12, r22]] };
}
/** Yaw (about +Y) of a rotation quaternion, three.js convention (0 = facing −Z). */
export function quatYaw([x, y, z, w]) {
  // forward = R * (0,0,-1)
  const fx = -(2 * (x * z + w * y)), fz = -(1 - 2 * (x * x + y * y));
  return Math.atan2(-fx, -fz);
}
/** True when the basis is a pure yaw by a multiple of 90° (axis-aligned box stays an AABB). */
export function isAxisAligned(basis, eps = 1e-4) {
  return basis.every((col) => col.filter((v) => Math.abs(v) > eps).length === 1 && col.some((v) => Math.abs(Math.abs(v) - 1) < eps));
}
export const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
export const r3 = (a, d = 4) => a.map((v) => round(v, d));
