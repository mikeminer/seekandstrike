// Fails if the release bundle (dist/) contains any trace of the DEV Daily Pass bypass.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
// Mock wallet / mock chain (DEV ?mockpass=) must be compiled out too.
const needles = [/bypass/i, /DEV BUILD/, /__lz/, /devHook/, /Mock wallet/i, /heightBump/, /mockpass/i, /devrpc/, /5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9/];
let bad = 0;
const walk = (d) => {
  for (const f of readdirSync(d)) {
    const p = join(d, f);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    if (!/\.(js|html|css|json)$/.test(f)) continue;
    const s = readFileSync(p, 'utf8');
    for (const n of needles) if (n.test(s)) { console.error(`FOUND ${n} in ${p}`); bad++; }
  }
};
walk(root);
if (bad) process.exit(1);
console.log('release bundle: no DEV bypass traces');
