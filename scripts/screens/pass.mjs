// DEV-only mock-wallet E2E of the Daily Pass (dist-dev on :4173, dist on :4174).
// RPC: scripts/screens/devrelay.mjs on :8787 (local, read-only, refuses sendTransaction); the public endpoint 403s browser Origins.
// MockAdapter never holds a key and never signs; MockChainRpc answers sends locally.
// Reads (quotes, accounts) go to the public mainnet RPC: read-only.
import { chromium } from 'playwright-core';
const OUT = '/workspace/modern-war-2030/docs/screens/';
const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const logs = [];
const PRIMARY = '.pass button:not(.pass-link):not(.pass-alt):not(.pass-chip)';
async function open(q, port = 4173) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => logs.push(`[pageerror ${q}] ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error') logs.push(`[console ${q}] ${m.text()}`); });
  await p.goto(`http://localhost:${port}/?${q}${port === 4173 ? '&devrpc=' + encodeURIComponent('http://localhost:8787/rpc') : ''}`);
  await p.waitForSelector('.pass', { timeout: 120000 });
  return p;
}
const text = (p) => p.$eval('.pass', (e) => e.innerText).catch(() => '');
async function until(p, re, ms = 60000) {
  const t0 = Date.now();
  for (;;) { const s = await text(p); if (re.test(s)) return s; if (Date.now() - t0 > ms) throw new Error(`timeout ${re}: ${s}`); await p.waitForTimeout(40); }
}
const card = (p, name) => p.locator('.menu .card').screenshot({ path: OUT + name });
const primary = (p) => p.locator(PRIMARY).first().click();
const steps = [];

// 1) Happy path, Italian.
let p = await open('mockpass=ok&lang=it');
await until(p, /Connetti|Connect/); await card(p, '20-pass-connect-it.png'); steps.push('connect');
await primary(p);
await until(p, /Ottieni il Daily Pass|Daily Pass attivo/); await card(p, '21-pass-offer-it.png'); steps.push('offer');
await p.locator(PRIMARY, { hasText: 'Ottieni' }).first().click();
await until(p, /Controlla e conferma/); await card(p, '22-pass-review-it.png'); steps.push('review');
await p.locator('.pass button.pass-link', { hasText: 'Dettagli' }).click();
await until(p, /Copia/); await card(p, '23-pass-details-it.png'); steps.push('details');
await p.locator('.pass button.pass-link', { hasText: /Nascondi/ }).click();
await p.locator(PRIMARY, { hasText: 'Conferma nel wallet' }).click();
await until(p, /Approva nel wallet/, 10000); await card(p, '24-pass-wallet-it.png'); steps.push('wallet');
await until(p, /Conferma sulla rete/, 20000); await card(p, '25-pass-confirming-it.png'); steps.push('confirming');
await until(p, /Daily Pass attivo/, 60000); await card(p, '26-pass-active-it.png'); steps.push('active');
const playEnabled = await p.$eval('[data-play]', (e) => !e.disabled);
await p.context().close();

// 2) Swap landed, lock did not: Activate recovery (English).
p = await open('mockpass=activate&lang=en');
await until(p, /Connect/); await primary(p);
await until(p, /Get the Daily Pass/); await p.locator(PRIMARY, { hasText: 'Get the Daily Pass' }).first().click();
await until(p, /Review and confirm|Check and confirm|Confirm in wallet/); await card(p, '27-pass-review-en.png');
await p.locator(PRIMARY, { hasText: 'Confirm in wallet' }).click();
await until(p, /Activate/, 60000); await card(p, '28-pass-activate-en.png'); steps.push('activate');
await p.locator(PRIMARY, { hasText: 'Activate' }).click();
await until(p, /Daily Pass active/, 60000); await card(p, '29-pass-active-en.png'); steps.push('activated');
await p.context().close();

// 3) Wallet declined.
p = await open('mockpass=DECLINED&lang=it');
await until(p, /Connetti/); await primary(p);
await until(p, /Ottieni il Daily Pass/); await p.locator(PRIMARY, { hasText: 'Ottieni' }).first().click();
await until(p, /Controlla e conferma/); await p.locator(PRIMARY, { hasText: 'Conferma nel wallet' }).click();
await until(p, /Indietro/, 20000); await card(p, '30-pass-declined-it.png'); steps.push('declined');
await p.context().close();

// 4) Release build: no mock, Play gated.
p = await open('mockpass=ok&lang=it', 4174);
await p.waitForTimeout(1500);
const rel = { play: await p.$eval('[data-play]', (e) => e.disabled), dev: (await p.$('.dev')) !== null };
await card(p, '31-pass-release-connect-it.png');
await p.context().close();
await browser.close();
console.log(JSON.stringify({ steps, playEnabledAfterPass: playEnabled, release: rel, logs }, null, 1));
