import { chromium } from 'playwright-core';
const OUT = '/workspace/modern-war-2030/docs/screens/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const logs = [];
async function boot(ctxOpts, url) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
  await page.goto(url);
  await page.waitForFunction(() => !!window.__lz, null, { timeout: 120000 });
  return page;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// Desktop
let page = await boot({ viewport: { width: 1280, height: 720 } }, 'http://localhost:4173/?lang=it&seed=7&debug');
await page.screenshot({ path: OUT + '01-menu-desktop.png' });
await page.evaluate(() => window.__lz.play());
await wait(2500);
await page.screenshot({ path: OUT + '02-spawn-desktop.png' });
await page.evaluate(() => { const m = window.__lz.match(); window.__lz.teleport(0, 39.5, 0, 0); });
await page.evaluate(() => window.__lz.simulate(16));
const view = await page.evaluate(() => {
  const m = window.__lz.match(); const p = m.player;
  const alive = (c) => c.health.state === 'alive';
  const mates = m.combatants.filter((c) => c.team === p.team && c.id !== p.id && alive(c)).sort((a, b) => a.pos.z - b.pos.z);
  const mate = mates[0];
  if (!mate || !alive(p)) return 'no-mate ' + p.health.state;
  // Stand 6 m behind the most advanced teammate, looking where he looks.
  const yaw = mate.yaw; const bx = mate.pos.x + Math.sin(yaw) * 6, bz = mate.pos.z + Math.cos(yaw) * 6;
  window.__lz.teleport(bx, bz, yaw, -0.06);
  return `mate ${mate.callsign} at ${mate.pos.x.toFixed(1)},${mate.pos.z.toFixed(1)} stance ${mate.move.stance}`;
});
console.log('view', view);
await wait(2500);
await page.screenshot({ path: OUT + '06-engagement-desktop.png' });
const obj = await page.evaluate(() => window.__lz.match().map.objective);
console.log('objective', obj);
await page.evaluate(() => window.__lz.teleport(4, 12, 0.15, -0.02));
await wait(1500);
await page.mouse.down({ button: 'left' }); await page.evaluate(() => window.__lz.simulate(0.45)); await wait(60); await page.mouse.up({ button: 'left' });
await wait(120);
await page.screenshot({ path: OUT + '03-firing-desktop.png' });
await page.mouse.down({ button: 'right' }); await wait(900);
await page.screenshot({ path: OUT + '04-ads-desktop.png' });
await page.mouse.up({ button: 'right' });
await page.evaluate((o) => window.__lz.teleport(o.x + 1.5, o.z + 7, 0.2, -0.12), obj);
await wait(1500);
await page.screenshot({ path: OUT + '05-objective-desktop.png' });

console.log('stats', await page.evaluate(() => JSON.stringify({ ...window.__lz.stats(), t: window.__lz.match().time, phase: window.__lz.match().phase,
  alive: window.__lz.match().combatants.map((c) => c.team + c.health.state.slice(0,4) + c.move.stance[0]).join(' ') })));
await page.evaluate((o) => window.__lz.teleport(o.x, o.z + 1.2, 0, -0.35), obj);
await wait(800);
await page.keyboard.down('e');
await page.evaluate(() => window.__lz.simulate(1.6));
await wait(1200);
await page.screenshot({ path: OUT + '09-planting-desktop.png' });
await page.evaluate(() => window.__lz.simulate(6));
await page.keyboard.up('e');
console.log('charge', await page.evaluate(() => JSON.stringify(window.__lz.match().objective)));
await page.evaluate(() => window.__lz.simulate(60));
await wait(2000);
await page.screenshot({ path: OUT + '10-match-end-desktop.png' });
console.log('end', await page.evaluate(() => JSON.stringify({ phase: window.__lz.match().phase, winner: window.__lz.match().winner, obj: window.__lz.match().objective.charge })));
await page.context().close();
// Touch (Seeker-like landscape)
page = await boot({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }, 'http://localhost:4173/?lang=it&seed=11&touch');
await page.screenshot({ path: OUT + '07-menu-touch.png' });
await page.evaluate(() => window.__lz.play());
await page.evaluate(() => window.__lz.teleport(-4, 14, 0.1, 0));
await wait(2500);
await page.screenshot({ path: OUT + '08-gameplay-touch.png' });
await page.context().close();
await browser.close();
console.log(logs.filter((l) => !l.includes('[debug]')).slice(0, 30).join('\n'));
