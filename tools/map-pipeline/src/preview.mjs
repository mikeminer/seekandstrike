#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Headless preview of a built map (render.glb + markers + nav heatmap + A* paths) via Chrome/SwiftShader.
// Screenshots are visual QA only — NOT performance evidence (Seeker FPS must be measured on device).
//   node src/preview.mjs out/banchina-est --dest ../../modern-war-2030/docs/maps --name banchina-est
import http from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { decodeGrid, findPath } from './lib/nav-runtime.mjs';

const dir = resolve(process.argv[2]);
const opt = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const dest = resolve(opt('--dest', dir)); const name = opt('--name', 'map');
const views = opt('--views', 'top,persp,fp').split(',');
mkdirSync(dest, { recursive: true });
const markers = JSON.parse(readFileSync(join(dir, 'markers.json')));
const navJson = JSON.parse(readFileSync(join(dir, 'navgrid.json')));
const report = JSON.parse(readFileSync(join(dir, 'report.json')));
const g = decodeGrid(navJson);
const sp = markers.markers.find((m) => m.kind === 'spawn' && m.team === 0), ob = markers.markers.find((m) => m.kind === 'objective');
const lift = (pts) => pts?.map(([x, z]) => { const c = [Math.floor((x - g.origin[0]) / g.cell), Math.floor((z - g.origin[1]) / g.cell)]; const h = g.height[c[1] * g.w + c[0]] / 100; return [x, Number.isFinite(h) && h > -300 ? h : 0, z]; });
const p1 = sp && ob ? findPath(g, sp.position, ob.position) : null;
const p2 = sp && ob ? findPath(g, sp.position, ob.position, { exposure: 0.6 }) : null;
const toXZ = (p) => p?.points.map((q) => (q.length === 3 ? [q[0], q[2]] : q));
const attribution = existsSync(join(dir, '..', 'ATTRIBUTION.md')) && /osm|porto-vecchio/i.test(name) ? '© OpenStreetMap contributors (ODbL)' : null;
const data = JSON.stringify({ markers: { ...markers, attribution }, nav: { w: navJson.w, h: navJson.h, cell: navJson.cell, origin: navJson.origin, flags: navJson.flags, coverHigh: navJson.coverHigh }, path: lift(toXZ(p1)), pathCovered: lift(toXZ(p2)), report });

const root = resolve('node_modules/three');
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x').pathname;
  let body, type;
  if (u === '/' || u === '/index.html') { body = readFileSync(new URL('./preview/viewer.html', import.meta.url)); type = MIME['.html']; }
  else if (u === '/data.json') { body = data; type = MIME['.json']; }
  else if (u === '/render.glb') { body = readFileSync(join(dir, 'render.glb')); type = MIME['.glb']; }
  else if (u.startsWith('/three/')) { const f = join(root, u.slice(7)); if (!f.startsWith(root) || !existsSync(f)) { res.writeHead(404).end(); return; } body = readFileSync(f); type = MIME[extname(f)] ?? 'application/octet-stream'; }
  else { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': type }).end(body);
}).listen(0, '127.0.0.1');
await new Promise((r) => srv.once('listening', r));
const port = srv.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const out = [];
try {
  for (const v of views) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.on('pageerror', (e) => console.error('pageerror', e.message));
    page.on('console', (m) => { if (m.type() === 'error') console.error('console', m.text()); });
    await page.goto(`http://127.0.0.1:${port}/?view=${v}`);
    await page.waitForFunction(() => window.__done, null, { timeout: 120000 });
    const stats = await page.evaluate(() => window.__done);
    const file = join(dest, `${name}-${v}.png`);
    await page.screenshot({ path: file });
    out.push({ view: v, file, ...stats });
    await page.close();
  }
} finally { await browser.close(); srv.close(); }
console.log(JSON.stringify(out, null, 1));
