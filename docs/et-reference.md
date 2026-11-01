# Gameplay reference notes — GPLv3 objective-shooter source

Source studied: `/workspace/Enemy-Territory/src` (GPLv3 release with additional terms, see `COPYING.txt` in that tree).
Paths below are relative to `src/`. Line numbers were read on 2026-10-28.

**Scope.** These are design reference notes: mechanics, numbers and where they live. No code, assets, names, maps,
sounds, strings or trademarks from that game are copied into this project. If any code is ever ported, see
"Licence consequences" at the end.

Units: 1 engine unit ≈ 2.54 cm (≈ 1 inch); 320 u/s ≈ 8.1 m/s. Our constant: `shared/src/units.ts` (`REFERENCE_UNIT_METRES`).

## 1. Classes

| Topic | Reference | Notes |
| --- | --- | --- |
| Class IDs (5 classes: soldier, medic, engineer, field ops, covert ops) | `game/bg_public.h:597-601` | One role each: firepower, healing/revive, build/defuse, support (ammo, airstrike/artillery), infiltration (disguise, scoped). |
| Per-class loadouts (primary/secondary/grenade/class tool) | `game/bg_classes.c:32-89` | Data table, team-mirrored. |
| Class "charge" meter (recharge to full) | `game/g_main.c:248-254` | Medic 45 s, engineer 30 s, field ops 40 s, soldier 20 s, covert ops 30 s (cvars, ms). |
| Charge cost per tool use | `game/bg_pmove.c:3640-3760` | Fractions of the meter per action (e.g. health/ammo pack, landmine, airstrike). |

Takeaway: abilities are gated by a single regenerating per-class resource rather than cooldown-per-ability. We keep
that model (drones and gadgets draw from one "charge" bar).

## 2. Weapons

| Topic | Reference | Notes |
| --- | --- | --- |
| Ammo table (clip/max, reload ms, fire delay ms) | `game/bg_misc.c:170-220` | SMG class: 30/90, reload 2400 ms, 150 ms between shots; MG: 150 belt, 66 ms. |
| Bullet damage per weapon | `game/g_weapon.c:2952-3001` | Hitscan, fixed per-weapon damage. |
| Bullet spread | `game/g_weapon.c:3005-3040`, `3190-3210` | Random cone scaled by an aim-spread scale. |
| Dynamic aim spread (movement/turning inflate, recovers when still) | `game/bg_pmove.c:3089-3208` | Accuracy penalty from speed and view rotation. |
| Hit locations / headshots | `game/g_combat.c:1444-1520` | Head ×2 with a minimum of 50; range falloff 1500→2500 u down to 20 %; helmet absorbs (×0.8) on some hits. |
| Lag compensation (antilag) | `game/g_antilag.c:31`, `:122` | Server stores history of player positions and rewinds hit boxes to the shooter's time. |

Takeaway: the reference is pure hitscan with heuristic falloff. We replace it with **projectile ballistics** (muzzle
velocity, gravity drop, drag, material penetration) but keep the server-side rewind idea (§ server below).

## 3. Movement

| Topic | Reference | Value |
| --- | --- | --- |
| Base speed / gravity | `game/g_main.c:306-307` | 320 u/s, 800 u/s² |
| Accelerate / air-accelerate / friction | `game/bg_pmove.c:74`, `:75`, `:80` | 10 / 1 / 6 (Quake-style) |
| Prone speed scale | `game/bg_pmove.c:72` | 0.21 (comment shows tuning history 0.18→0.24→0.21) |
| Run 0.8, sprint 1.1, crouch 0.25 scales | set `game/g_client.c:2055-2057`, applied `game/bg_pmove.c:632-634`, `:1434-1435` | relative to base speed |
| Jump | `game/bg_pmove.c:800` (`JUMP_VELOCITY` 270) | |
| Step height | `game/bg_pmove.c:353`, `:369` (`STEPSIZE` 18) | ≈ 46 cm |
| Sprint stamina | `game/bg_public.h:60` (`SPRINTTIME` 20000), regen/drain `game/bg_pmove.c:5215-5275` | drain ≈ 5000/s, jump costs 2500 |
| View heights stand/crouch/prone | `game/bg_public.h:109-113`, use at `game/bg_pmove.c:1006-1009`, `:1548` | 40 / 16 / −8 u |
| Bounding box | player mins/maxs −18..18, −24..48 u | ≈ 0.91 m wide, 1.83 m tall |
| Fall damage thresholds | `game/bg_pmove.c:1682-1720` | |

Takeaway: snappy arcade acceleration. For a "realistic 2030" feel we lower acceleration, add inertia and weapon sway,
but keep stance-based speed scales and a stamina bar.

## 4. Health, revive, limbo, waves

| Topic | Reference | Notes |
| --- | --- | --- |
| Max health 100 + 10 per medic on team, cap 125 | `game/g_client.c:1185-1199` | (+15 with a high skill level) |
| Revive restores 50 % (100 % with skill) | `game/g_weapon.c:471-474` | |
| "Wounded/limbo" state: downed, can be revived or tap out to spawn queue | `game/g_active.c:1285-1300` | |
| Wave respawn timers per team (30 s) | `game/g_main.c:246-247` | Everyone dead waits for the next team wave, synchronising pushes. |

Takeaway: downed → revivable → wave respawn is the core of objective pacing. We keep it (wave 20–30 s, tuned per map).

## 5. Objectives and XP

| Topic | Reference | Notes |
| --- | --- | --- |
| Constructibles (engineer builds bridges/MG nests/barriers) | `game/g_mover.c:5169-5175` | Progress driven by charge. |
| Explosive plant/defuse (30 s fuse) | `game/g_weapon.c` dynamite handling; team objective hooks `game/g_team.c:1146`, `:1504` | |
| Objective triggers (capture/steal/escort) | `game/g_trigger.c:1433` | |
| Map script events (stage advance, win conditions) | `game/g_script.c:1075` | Per-map scripted state machine. |
| Skill/XP categories | `game/bg_public.h:876-883` | Battle sense, engineering, first aid, signals, light weapons, heavy weapons, scoped. |
| Skill level thresholds 0/20/50/90/140 | `game/bg_misc.c:96-102` | |
| XP awards | `game/g_stats.c:250` (`G_AddSkillPoints`), kills `:376-420`, combat state `game/g_active.c:1118-1130`, packs `game/g_items.c:575`, `:689` | 3 per kill, 5 per headshot kill, 1 per health/ammo pack handed out, 2–8 per combat intensity tick. |

Takeaway: asymmetric attack/defend stages driven by a map script, with XP for teamwork actions. We use a declarative
map-objective graph (JSON) instead of a script language; XP persists only per match unless the owner decides otherwise.

## 6. Server and bots

| Topic | Reference | Notes |
| --- | --- | --- |
| Server frame rate 20 Hz | `server/sv_init.c:791` | Our `SERVER_TICK_HZ` = 20. |
| Antilag rewind | `game/g_antilag.c:31`, `:122` | Server-side hit validation at shooter time. |
| Bot AI node state machine | `botai/ai_dmnet_mp.h:72-91` | Nodes: seek goal, battle (fight/chase/retreat), seek objective, revive, build, plant, defend, etc. |

Takeaway: local offline mode uses the same idea — a per-bot finite-state/utility machine whose nodes map to class jobs
(attack objective, defend, revive, build/defuse, resupply) over a navigation mesh.

## Licence consequences

- Reading this source for mechanics is fine; facts and numbers are not copyrightable expression.
- Porting **any** code makes our game a derivative work under GPLv3; we already license the project
  GPL-3.0-or-later (`COPYING`). In that case we must also ship that release's **additional terms** verbatim
  (they are at the top of its `COPYING.txt`: no trademark licence, warranty disclaimer, etc.) and keep its notices.
- Never use the original title, faction names, map names, logos, sounds or art.
