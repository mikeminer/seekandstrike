import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await (await b.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
await p.goto('http://localhost:4174/?lang=it');
await p.waitForFunction(() => document.querySelector('[data-load]')?.textContent === '', null, { timeout: 120000 });
console.log('play disabled:', await p.$eval('[data-play]', (e) => e.disabled), 'dev label:', await p.$('.dev') !== null, '__lz:', await p.evaluate(() => 'lz' in window || '__lz' in window), errs);
await p.screenshot({ path: '/workspace/modern-war-2030/docs/screens/00-release-gate-touch.png' });
await b.close();
