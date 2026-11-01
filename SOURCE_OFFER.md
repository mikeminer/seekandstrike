# Corresponding source — how to get it

SEEK & STRIKE is licensed under GPL-3.0-or-later ([`LICENSE.md`](LICENSE.md)). For every APK or other binary we distribute, the complete corresponding source is available as described here.

## Where

- Source repository: https://github.com/mikeminer/seekandstrike (must stay public and reachable without payment, account or wallet, and must contain the tagged commit of every released APK).
- Each release lists in the in-game "About / Licences" screen and in the store listing: the version, the exact source commit or tag, and the SHA-256 of the APK.
- If the repository is ever unavailable, a copy on a physical medium or by download can be requested in writing from the address below, for at most the cost of providing it, for at least three years after the last distribution of that version.

Contact: **PENDING** (publisher name, postal address and e-mail, same as in the privacy and terms pages).

## What "corresponding source" includes

- all of `client/`, `shared/`, `server/`, `android-host/`, `tools/`, `scripts/`;
- build files: `package.json`, `package-lock.json`, `vite.config.ts`, Gradle files and the exact build commands (`HANDOFF.md` §5);
- the licence texts in `licenses/`, `COPYING`, `LICENSE.md`, `NOTICE.md`, `ASSETS_LICENSES.md`.

It does **not** include secrets: signing keystores and passwords, RPC provider keys (`RPC_UPSTREAM_URL`) and `.env` files. The signing key is not needed to study, modify or rebuild the program; a rebuilt APK is signed with the rebuilder's own key.

## Release checklist

1. Tag the commit that produced the APK; record tag and APK SHA-256 in the release manifest.
2. `npm run build && npm run check:release` on that tag.
3. Confirm `NOTICE.md` lists every ported upstream file (including any Enemy Territory file with its original header and a modification line).
4. Confirm the in-game credits show "© OpenStreetMap contributors" if the OSM map ships.
5. Publish the tag in the public repository before, or at the same time as, the APK.
