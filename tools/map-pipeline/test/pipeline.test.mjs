// SPDX-License-Identifier: GPL-3.0-or-later
// node --test test/  (run `npm run example` and `npm run build:example` first)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';
import { decodeGrid, findPath, snap, REACHABLE } from '../src/lib/nav-runtime.mjs';

const OUT = 'out/banchina-est';
const SRC = process.env.MAP_SRC ?? [new URL('../../../shared/src/map/portoArdesia.ts', import.meta.url).pathname, '/workspace/modern-war-2030/shared/src/map/portoArdesia.ts'].find((p) => existsSync(p));

test('Banchina Est: simBoxes round-trip the stage-1 MapDef boxes exactly', async (t) => {
  if (!existsSync(SRC)) return t.skip('project source not available');
  const js = (await build({ entryPoints: [SRC], bundle: true, write: false, format: 'esm', platform: 'node' })).outputFiles[0].text;
  writeFileSync('/tmp/_map_test.mjs', js);
  const def = Object.values(await import('/tmp/_map_test.mjs?' + Date.now())).find((v) => v?.boxes);
  const col = JSON.parse(readFileSync(`${OUT}/colliders.json`));
  const sim = col.simBoxes.filter((b) => b.node.startsWith('blk_'));
  assert.equal(sim.length, def.boxes.length);
  const key = (b) => [b.c.x, b.c.y, b.c.z, b.s.x, b.s.y, b.s.z].map((v) => v.toFixed(3)).join(',') + b.material + (b.look ?? '') + (b.shell ?? '') + (b.fill ?? '');
  assert.deepEqual(sim.map(key).sort(), def.boxes.map(key).sort());
});

test('Banchina Est: markers match spawns, objective and waypoints', async () => {
  const m = JSON.parse(readFileSync(`${OUT}/markers.json`));
  assert.equal(m.counts.spawnAttack, 6); assert.equal(m.counts.spawnDefend, 6);
  assert.equal(m.counts.objective, 1); assert.equal(m.counts.nav, 44);
  const obj = m.markers.find((x) => x.kind === 'objective');
  assert.deepEqual(obj.position.map((v) => +v.toFixed(2)), [0, 1.1, -24.9]);
  const sp = m.markers.find((x) => x.name === 'spawn_attack_0');
  assert.ok(Math.abs(sp.yaw) < 1e-6, 'attack faces -Z (yaw 0)');
  assert.ok(m.waypointGraph.edges.length > 40);
});

test('Nav grid: every spawn reaches the objective', () => {
  const g = decodeGrid(JSON.parse(readFileSync(`${OUT}/navgrid.json`)));
  const m = JSON.parse(readFileSync(`${OUT}/markers.json`));
  const obj = m.markers.find((x) => x.kind === 'objective');
  for (const s of m.markers.filter((x) => x.kind === 'spawn')) {
    const p = findPath(g, s.position, obj.position);
    assert.ok(p, `path from ${s.name}`);
    assert.ok(p.length > 10 && p.length < 150);
  }
  const c = snap(g, 0, 0, 8, 0);
  assert.ok(g.flags[c[1] * g.w + c[0]] & REACHABLE);
});

test('Report has no validation errors and render budget is tiny', () => {
  for (const dir of [OUT, 'out/porto-vecchio-ts']) {
    if (!existsSync(`${dir}/report.json`)) continue;
    const r = JSON.parse(readFileSync(`${dir}/report.json`));
    assert.deepEqual(r.validation, [], dir);
    assert.ok(r.render.drawCalls <= 20, `${dir} draw calls ${r.render.drawCalls}`);
  }
});
