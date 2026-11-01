import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Bundled-APK architecture: relative base so the built game can be served
// from the Android host's fixed local asset origin (no remote executable code).
// DEV Daily Pass bypass: true ONLY for `vite` dev server and `--mode devbypass` builds.
// Production (`npm run build`) defines it as literal false, so the bypass branch is removed
// by dead-code elimination (verified by scripts/check-release-bypass.mjs).
const dev = (mode: string) => mode === 'development' || mode === 'devbypass';
export default defineConfig(({ mode }) => ({
  root: 'client',
  // DEV only: let the page reach a local `wrangler dev` RPC proxy (`?devrpc=`). Release CSP unchanged.
  plugins: dev(mode) ? [{ name: 'dev-csp', transformIndexHtml: (html: string) => html.replace("connect-src 'self'", "connect-src 'self' http://localhost:8787") }] : [],
  define: {
    __DEV_PASS_BYPASS__: JSON.stringify(dev(mode)),
  },
  base: './',
  publicDir: fileURLToPath(new URL('./public', import.meta.url)),
  resolve: {
    alias: { '@shared': fileURLToPath(new URL('./shared/src', import.meta.url)) },
  },
  build: {
    outDir: fileURLToPath(new URL('./dist', import.meta.url)),
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
  },
}));
