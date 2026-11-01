import { chromium } from 'playwright-core';
const OUT = '/workspace/modern-war-2030/docs/screens/';
const TMP = '/tmp/s2/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
await page.goto('http://localhost:4173/?lang=it&seed=' + (process.env.SEED ?? '5'));
await page.waitForFunction(() => !!window.__lz, null, { timeout: 120000 });
await page.screenshot({ path: OUT + '11-menu-logo-desktop.png' });
await page.evaluate(() => { window.__lz.play(); setInterval(() => { const h = window.__lz.match()?.player?.health; if (h && h.state === 'alive') h.hp = 1e6; }, 30); });
await wait(1500);
await page.evaluate(() => window.__lz.simulate(Number(new URL(location.href).searchParams.get('pre') ?? 4)));
const faceEnemy = async (dist) => page.evaluate((dist) => {
  const m = window.__lz.match(); const p = m.player;
  const foes = m.combatants.filter((c) => c.team !== p.team && c.health.state === 'alive');
  if (!foes.length) return null;
  foes.sort((a, b) => Math.hypot(a.pos.x - p.pos.x, a.pos.z - p.pos.z) - Math.hypot(b.pos.x - p.pos.x, b.pos.z - p.pos.z));
  const f = foes[0];
  // Stand `dist` m from the foe along its own facing so we see its front.
  const fx = 0, fz = 1;
  const px = f.pos.x + fx * dist, pz = f.pos.z + fz * dist;
  const yaw = Math.atan2(-(f.pos.x - px), -(f.pos.z - pz));
  window.__lz.teleport(px, pz, yaw, Math.atan2(-0.35, dist));
  return { id: f.id, cs: f.callsign, x: f.pos.x, z: f.pos.z, stance: f.move.stance };
}, dist);
const info = await faceEnemy(Number(process.env.DIST ?? 7));
console.log('foe', JSON.stringify(info));
await wait(350);
await page.screenshot({ path: TMP + 't-' + (process.env.TAG ?? 'a') + '-foe.png' });
await page.mouse.move(640, 360);
for (let i = 0; i < 30; i++) {
  const alive = await page.evaluate((id) => {
    const m = window.__lz.match(); const p = m.player; const f = m.combatants.find((c) => c.id === id);
    if (!f || f.health.state !== 'alive') return false;
    const dx = f.pos.x - p.pos.x, dz = f.pos.z - p.pos.z, d = Math.hypot(dx, dz);
    const chest = f.move.stance === 'prone' ? 0.3 : f.move.stance === 'crouch' ? 0.9 : 1.3;
    window.__lz.teleport(p.pos.x, p.pos.z, Math.atan2(-dx, -dz), Math.atan2(chest - 1.62, d));
    return true;
  }, info.id);
  if (!alive) break;
  await page.mouse.down({ button: 'left' }); await wait(70); await page.mouse.up({ button: 'left' }); await wait(90);
}
const st = await page.evaluate((id) => window.__lz.match().combatants.find((c) => c.id === id)?.health.state, info?.id);
console.log('foe state', st);
for (const t of [300, 900, 2200]) { await wait(t === 300 ? 300 : t - 300); await page.screenshot({ path: TMP + 't-' + (process.env.TAG ?? 'a') + '-k' + t + '.png' }); }
await page.keyboard.press('r');
await wait(450); await page.screenshot({ path: TMP + 't-' + (process.env.TAG ?? 'a') + '-r1.png' });
await wait(700); await page.screenshot({ path: TMP + 't-' + (process.env.TAG ?? 'a') + '-r2.png' });
await ctx.close(); await browser.close();
console.log(logs.slice(0, 10).join('\n'));
