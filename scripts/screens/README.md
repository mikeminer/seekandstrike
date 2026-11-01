Headless screenshot scripts (Playwright-core + Chrome SwiftShader). Not part of the build.
Run from a folder with `playwright-core` installed; serve `dist-dev/` on :4173 (shots.mjs) and `dist/` on :4174 (release.mjs).
SwiftShader runs at ~5–7 fps: screenshots are not FPS proof; `__lz.simulate()` (DEV only) fast-forwards the sim.
`stage2.mjs` (dist-dev on :4173): menu with logo (`11-…`), engagement and reload frames (`15/16-…`). It pins the player's HP every 30 ms so the harness survives (DEV automation only; never in release).
`12/13/14-…-lab.png` come from the DEV-only render lab (`client/lab.html` + `client/src/dev/lab.ts`, served by `npm run dev`), which poses soldiers/ragdolls on a flat plane; lab.html is not part of the release build.
`pass.mjs` (dist-dev on :4173, dist on :4174, `node scripts/screens/devrelay.mjs` on :8787): mock-wallet E2E of the Daily Pass (`20…31-pass-*.png`). MockAdapter has no key and never signs; MockChainRpc answers sends locally; the relay is read-only and refuses `sendTransaction`. The relay exists because the public mainnet RPC answers 403 to requests with a browser `Origin` (and to Cloudflare Worker egress).
