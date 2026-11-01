#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Bakes the ground sky-occlusion lightmap of a pipeline map (DevFridge Game Builder:
// "bake the light of static scenery at build time, ship the baked textures").
// Usage: node tools/light-bake/bake-ground-ao.mjs porto-vecchio [size=1024]
// Reads public/assets/maps/<id>/colliders.json + markers.json, writes ground-ao.png and ground-ao.json.
// Uses the same OcclusionField as the runtime façade AO (shared/src/light/skyOcclusion.ts).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';
import { OcclusionField, aabbsFromSimBoxes } from '../../shared/src/light/skyOcclusion.ts';

const id = process.argv[2];
const size = Number(process.argv[3] ?? 1024);
if (!/^[a-z0-9-]+$/.test(id ?? '') || !Number.isInteger(size) || size < 64 || size > 4096) {
  console.error('usage: bake-ground-ao.mjs <map-id> [size 64..4096]');
  process.exit(2);
}
const dir = new URL(`../../public/assets/maps/${id}/`, import.meta.url);
const collidersText = readFileSync(new URL('colliders.json', dir));
const colliders = JSON.parse(collidersText);
const markers = JSON.parse(readFileSync(new URL('markers.json', dir), 'utf8'));
const { minX, maxX, minZ, maxZ } = markers.bounds;

const SAMPLES = 24, MAX_DISTANCE = 24;
const field = new OcclusionField(aabbsFromSimBoxes(colliders.simBoxes), { samples: SAMPLES, maxDistance: MAX_DISTANCE });
const px = new Uint8Array(size * size);
const t0 = performance.now();
let min = 1;
for (let j = 0; j < size; j++) {
  const z = minZ + ((j + 0.5) / size) * (maxZ - minZ);
  for (let i = 0; i < size; i++) {
    const x = minX + ((i + 0.5) / size) * (maxX - minX);
    const v = field.visibility(x, 0.02, z, 0, 1, 0);
    if (v < min) min = v;
    px[j * size + i] = Math.round(Math.max(0, Math.min(1, v)) * 255);
  }
}
const ms = Math.round(performance.now() - t0);

// Soften the fixed-direction streaks around small solids: separable 5-tap box blur, twice.
const blur = (src) => {
  const tmp = new Float32Array(size * size), out = new Uint8Array(size * size);
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let s = 0, n = 0;
    for (let k = -2; k <= 2; k++) { const x = i + k; if (x >= 0 && x < size) { s += src[j * size + x]; n++; } }
    tmp[j * size + i] = s / n;
  }
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    let s = 0, n = 0;
    for (let k = -2; k <= 2; k++) { const y = j + k; if (y >= 0 && y < size) { s += tmp[y * size + i]; n++; } }
    out[j * size + i] = Math.round(s / n);
  }
  return out;
};
const smooth = blur(blur(px));
px.set(smooth);

// Minimal 8-bit greyscale PNG (filter 0 per row).
const raw = Buffer.alloc(size * (size + 1));
for (let j = 0; j < size; j++) { raw[j * (size + 1)] = 0; Buffer.from(px.buffer, j * size, size).copy(raw, j * (size + 1) + 1); }
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
  return Buffer.concat([len, td, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 0; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(new URL('ground-ao.png', dir), png);
writeFileSync(new URL('ground-ao.json', dir), JSON.stringify({
  format: 'seek-strike-ground-ao', version: 1, map: id, size,
  bounds: { minX, maxX, minZ, maxZ }, samples: SAMPLES, maxDistance: MAX_DISTANCE,
  // Re-bake when colliders.json changes: this hash must match its SHA-256.
  collidersSha256: createHash('sha256').update(collidersText).digest('hex'),
}, null, 1) + '\n');
console.log(`ground-ao ${id}: ${size}x${size}, ${png.length} bytes, min visibility ${min.toFixed(3)}, ${ms} ms`);
