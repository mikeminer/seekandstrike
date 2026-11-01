import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/** Mainnet READ-ONLY simulations (simulateTransaction, sigVerify off). Never signs or sends. */
export default defineConfig({
  resolve: { alias: { '@shared': fileURLToPath(new URL('./shared/src', import.meta.url)) } },
  define: { __DEV_PASS_BYPASS__: 'false' },
  test: { include: ['client/src/**/*.sim.ts'], testTimeout: 240_000, hookTimeout: 120_000, fileParallelism: false },
});
