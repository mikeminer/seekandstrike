import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared/src', import.meta.url)),
      '@pass': fileURLToPath(new URL('./client/src/pass', import.meta.url)),
    },
  },
  define: { __DEV_PASS_BYPASS__: 'false' },
  test: {
    include: ['shared/src/**/*.test.ts', 'client/src/**/*.test.ts', 'server/**/*.test.ts', 'tools/validator-vectors/*.test.ts'],
    exclude: ['**/node_modules/**', '**/*.sim.ts'],
    testTimeout: 30_000,
  },
});
