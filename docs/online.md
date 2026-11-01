# Online mode — authoritative MatchRoom (local only, NOT deployed)

Status 2026-10-28: server side **and client online mode** implemented and tested locally, including the **Daily Pass check on the
server** (wallet signature + the server's own chain read, see "Daily Pass access" below). **No deploy**. The room is closed by
default and the online button only exists when a server is configured.

## Architecture

- `server/src/index.ts` — Worker: `/health`, `/rpc` (Daily Pass RPC proxy), `/room/<id>/ws` (WebSocket upgrade to a `MatchRoom`).
- `server/src/room/matchRoom.ts` — Durable Object (SQLite-backed class, Hibernation WebSocket API). Parses messages,
  rate-limits (60 msg/s per socket), seats players, runs a 20 Hz `setInterval` loop **only while a human is seated**
  (an empty room can hibernate), sends 15 Hz snapshots on wall-clock time.
- `server/src/room/roomSim.ts` — the authoritative room, pure TypeScript (unit-tested without Cloudflare):
  runs the shared offline simulation (`shared/src/sim/match.ts`) at 60 Hz steps with all 8 slots on the field.
  Slots without a human are bots (A* on the baked nav grid). A joining human takes over a slot (team balanced), a
  leaving human hands it back to a bot after the reconnect grace.
- `server/src/room/map.ts` — Banchina Est from the map-pipeline JSON files (same files the client loads).
- `shared/src/protocol.ts` — protocol v2 (JSON): `hello`, `ping`, `input` (client; a batch of numbered 60 Hz commands) and `welcome`, `pong`, `error`,
  `roundEnd`, `snap` (server; includes `ack` and the exact movement state `self.mv`).
- `shared/src/sim/playerMove.ts` — the movement step (`applyCmdToInput` + `stepCombatantMovement`) used by BOTH the room
  and the client predictor, on the same AABB collision host.

Authority: the client sends only commands: one per 60 Hz step with movement axes, held buttons, one-shot presses (jump, reload,
tap out, grenade), stance and view angles. Positions, health, ammo, hits, grenades, revives and the objective are computed by the server;
unknown fields are dropped by the parser. View turns are limited to 14 rad/s.

## Client (`client/src/online/`)

- `netClient.ts` — WebSocket client: `hello`, numbered `input` messages, JSON pings (RTT), and after an unexpected drop it
  resumes the same seat with the `resumeToken` (retries every second for up to 15 s; the server holds the seat 20 s).
- `snapshots.ts` — snapshot buffer and interpolation: others are drawn 120 ms in the past, blended between two snapshots,
  angles take the short way, respawn teleports are not interpolated, never extrapolated.
- `mirror.ts` — a `Match` that is **never stepped**: combatants, objective, grenades and own ammo are overwritten from snapshots so
  the existing renderers, HUD and sound work unchanged. Server events become local effects; `shot` events spawn cosmetic tracers.
  Own view angles stay local; the own position comes from the predictor.
- `predictor.ts` — client-side prediction. Each 60 Hz step the local player runs the shared movement code on the same command that is
  sent; when a snapshot arrives, the server state after command `ack` is compared with the prediction. Within 2 cm and 0.2 m/s nothing
  happens; otherwise the state is reset to the server's and the unacknowledged commands are replayed, and the visible jump is absorbed
  over about 80 ms (a correction over 2 m is a respawn teleport and snaps). While downed or dead there is no prediction.
- `session.ts` — glue used by `Game.connectOnline()`: turns frame time into 60 Hz commands (rounded to the wire precision before being
  predicted, so both ends see identical numbers), sends them in batches (about every 66 ms or 4 commands), interpolates the others.
- Entry: `ONLINE.wsUrl` in `shared/src/config.ts` (null by default, so release builds show no online button). Development builds also accept
  `?online=ws://localhost:8787&room=<id>&name=<name>`. The button needs the same Daily Pass state as offline play.

## Rules of the room

| Item | Value |
|---|---|
| Seats | 8 (4 per team), extra connections get HTTP 409 / `room_full` |
| Tick / snapshot | 20 Hz loop, 15 Hz snapshots (`shared/src/constants.ts`) |
| Input | commands are queued per seat and consumed **one per 60 Hz step, in order**; replayed numbers are ignored; the last consumed number is echoed as `ack`. Queue empty: the last movement repeats (never fire or presses). More than 8 waiting: the oldest are folded in (their presses kept) |
| Lag compensation | rewind up to 0.4 s from the command's view time (see below) |
| Reconnect | `resumeToken` from `welcome`; the seat idles for 20 s (no movement or fire), then becomes a bot |
| Round end | `roundEnd` message, new round after 8 s with the same seats and classes |
| Access | a wallet-signed proof plus an active Daily Pass read from chain; **`ONLINE_REQUIRE_PASS` exactly `"false"` skips it, for local tests only** (see "Daily Pass access") |

## Run it locally

```bash
npm run server:dev:online
```

```bash
npm run online:smoke
```

The smoke script (Node, global `WebSocket`) refuses any host except localhost. It seats 8 players, checks team balance,
that a 9th is rejected, snapshot rate and size, acknowledgements, events, and that a reconnect keeps the seat.

Measured on this machine with workerd (wrangler 4.154): 8 clients get 12–13 snapshots/s (one client: 15.2/s),
about 20 KiB/s per client (JSON, 8 players plus events), reconnect keeps the seat. The room simulation costs well under
1 ms per tick in Node (`roomSim.test.ts`, load test).

## Lag compensation

The shooter sees the other players about 0.3 s in the past (120 ms interpolation, the snapshot trip, the command trip, a short queue).
Without compensation a bullet is tested against where the target IS NOW and misses a moving target the shooter aimed at correctly.

- Every command carries `vt`: the match time of the world the client was showing (`session.ts`, from the interpolation sample).
- The server keeps a pose history (0.7 s, one entry per 60 Hz step: position, yaw, stance, downed/dead) and sets
  `combatant.lag = clamp(match.time - vt, 0, 0.4)` when it consumes the command (`roomSim.ts`). A value from the future or absent means no rewind.
- A bullet fired with a lag is tested each sim step against the targets' poses at `match.time - lag`, interpolated, with the same hit
  volumes (`Match.raycast(..., atTime)`). Static geometry and the shooter are not rewound. Bots and offline play use lag 0 (unchanged).
- Trade-offs: the rewind limit is 0.4 s (`MAX_REWIND_SECONDS`); players above it have to lead their targets. A target that dies or hides
  inside the shooter's view window can still be hit ("shot behind cover" for the victim), as in the reference engine's antilag.
- Measured in `client/src/online/online.test.ts` (client with 60 ms each way, perfect aim at the shown target, slow strafing target):
  **34 of 34 hits with compensation, 6 of 34 without.** Zero-lag baseline in the room alone: 45 of 46.

## Server-side checks (`server/src/room/monitor.ts`)

Movement and turning cannot be forged: the client sends commands, the server runs the shared sim, bounds the view turn rate (14 rad/s)
and pitch (+-1.45 rad), and the fire rate comes from the weapon cooldown. What the monitor adds, per seat:

| Check | Rule | Action |
|---|---|---|
| Command rate | token bucket, 75 commands/s refill, burst of 120 (a stalled connection catching up) | excess dropped; a sustained flood (leaky score > 300) is a **hard violation: kick** (socket closed with `rate_limited`, seat back to a bot) |
| Speed | horizontal speed of every sim step vs 1.5 x sprint speed (9.6 m/s) | counted, never punished (the sim itself cannot exceed it) |
| View time | `vt` from the future or older than 4 x the rewind limit | clamped and counted |
| Aim statistics | per 40 shots: hit ratio >= 90%, or head ratio >= 70% over >= 20 hits | **soft flag only** (reported by `RoomSim.report()`), no automatic kick: statistics alone are not proof |

Observation worth knowing: turning while sprinting makes this Quake-style sim reach about 7.8 m/s (22% above sprint speed). That is the sim's own
acceleration model, present offline too, not a client abuse; the speed limit of the check sits above it.

Live check against `wrangler dev`: `npm run online:smoke` also floods the room with ~500 commands/s and expects the disconnect (it happened after 2.0 s).

## Prediction results

- Unit/integration tests (`client/src/online/online.test.ts`, real `RoomSim` behind a fake socket): with random movement, sprint,
  jumps, crouch and wild view changes there are **0 corrections** and the prediction equals the server within 2 cm, with no latency
  and with 100 ms each way; a 1.2 m push, a respawn teleport and a downed/revive cycle are corrected, smoothed or snapped as designed.
- Live, browser against `wrangler dev` (workerd): 20.9 m of strafing, walking and sprinting (434 commands), 0 corrections, largest
  error at an acknowledgement 0.6 mm, final prediction-vs-server difference 0.4 mm, with a measured round trip up to 267 ms.
- With the real round trip the prediction runs ahead of the server by about RTT times speed (1.2 m at 267 ms): that is the point.

## Daily Pass access (server side)

> Since 2026-10-29 the pass token is PASTA (locked for one day, bought in the Meteora pool in the same transaction); the server reads locks of that mint with the same client code.

Code: `shared/src/passProof.ts` (challenge text), `server/src/room/access.ts` (gate, verifier, registry), `matchRoom.ts` (wiring),
`client/src/online/netClient.ts` + `client/src/pass/wallet/*` (signing). The server only ever **reads**: it never signs or sends.

Flow, when `ONLINE_REQUIRE_PASS` is not `"false"` (the default):

1. `hello` carries the player's `wallet`. The room answers `challenge { message }`: a fixed plain-text template (domain, wallet,
   room, 128-bit nonce, issue and expiry times, 60 s) that says it is not a transaction. The challenge lives only in that socket's
   attachment, so a signature cannot be replayed on another socket, another room or after it expired.
2. The wallet signs the text (`solana:signMessage` for wallet-standard wallets, `sign_messages` over MWA) and the client sends
   `auth { sig }`. **The client signs only text that matches the template exactly, for its own wallet, with a lifetime of at most
   60 s**, so a hostile server cannot get a signature over anything else (for example bytes that read as a transaction).
3. The server checks the Ed25519 signature against the wallet address, then reads the chain through `RPC_UPSTREAM_URL`
   (Worker secret) with **the same code as the client** (`client/src/pass/reader.ts`, the receipt rule, the vendored Season Pass
   evaluator), so both sides agree on what a valid pass is: one deposit counts, never summed; lock account, owner program, PDA and
   vault are all checked, and whatever a node returns for a wallet is re-verified.
4. Only then is the seat granted, **until the lock ends**; the room then closes the socket with `pass_expired` and gives the seat
   back to a bot. One wallet holds one seat: a new proof from the same wallet takes the seat over (second device, lingering socket).
5. A dropped player whose pass is still valid resumes with the token and **does not sign again**. A token alone never opens a new seat.

Outcomes: `pass_required` (no pass, or no wallet), `proof_invalid`, `proof_expired`, `pass_unavailable` (node unreachable or
evidence stale: never reported as "no pass", and never cached), `pass_expired`, `rate_limited`.

Protections against abuse of the chain read: a signature must come first (so only wallets the caller controls), answers are cached
(60 s positive, 10 s "no pass"), reads of the same wallet are shared, at most 4 reads run at once (more get `pass_unavailable`),
and `AUTH_LIMIT` (12 proofs per minute per IP, Workers Rate Limiting binding in `wrangler.toml`). A socket that has not taken a seat
within 15 s (75 s while a proof is pending) is closed. `RPC_UPSTREAM_URL` must be `https://`, except a loopback address (used by the
local test); with no usable URL nobody gets in. The key must stay in the Worker secret, never in the client or in a file.

Verified: `server/src/room/access.test.ts` (19 tests: template round trip, foreign key, replay, expiry, no pass / too small / ended /
somebody else's lock / empty vault, outage, caching, concurrency, registry), `online.test.ts` (client signs, refuses forged
challenges, resumes without signing) and `npm run pass:smoke`, which starts a **real `wrangler dev` (workerd)** plus a fake read-only
Solana node on localhost and checks: no wallet refused, proof then seat, input before auth refused, a challenge answers once, wrong
key, wallet without pass, replay between sockets, node down then back, takeover, resume without signing, unknown token, pass ending
during play (`pass_expired`), per-IP limit (17 of 20 attempts refused). Ed25519 verification and `@solana/web3.js` work in workerd;
the Worker bundle is 166 KiB gzip.

**Not verified**: signing with a real wallet (MWA `signMessages` on a Seeker, Phantom / Solflare `solana:signMessage`): no wallet
was used. In particular the MWA return value is assumed to be message followed by the 64-byte signature (the code accepts that or a
bare signature); a wallet that rewrites the text makes the proof fail with `proof_invalid`. Also not measured: reads against the real
RPC (cost of `getProgramAccounts`, latency of the join) and the effect of the proof round trip on the time to enter a room.

## Not done (needed before any public online test)

1. **Visual polish.** Done locally: reload/aim animations of the others (optional `rl`/`ad` flags in `SnapPlayer`, sent only when
   set), their reload and fire sounds, grenade throw/bounce sounds (bounce is inferred client side from the height of the
   interpolated grenade), and the round-end countdown in the HUD (from `roundEnd.restartInMs`). Not tried by ear or on a device.
   The per-class soldier look is in too (helmet band + kit per class: medic bag, engineer tool roll, field-ops radio, covert ops light and masked). Online play uses the AABB collision host on the client (the same as the server), not Rapier: the
   online feel of walking over low ledges and corners can differ slightly from offline play.
2. **Daily Pass on the server**: done locally (see above). Still to do: try it with a real wallet on a Seeker, then with the real
   RPC secret at deploy time; `ONLINE_REQUIRE_PASS` must stay at its default (fail closed) in any deployed Worker.
3. **Anti-cheat beyond these basics**: the aim statistics are only flags (nothing reads them yet, no persistence, no review tooling); no
   detection of third-party aim assistance beyond statistics; no replay or evidence capture.
4. **Binary protocol**, matchmaking/room discovery, a persistent lobby.
5. **Budget measurement on Cloudflare Free** (55 player-hours/day is an estimate from the docs, not a measurement).
6. Deploy, only with the owner's approval.
