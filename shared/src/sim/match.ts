/**
 * Offline match simulation (pure TypeScript, fixed-step, deterministic for a given seed and
 * input stream). Owns combatants, projectiles, health/waves, the objective and bots.
 * The host supplies character collision (`SimHost.moveCharacter`); everything else —
 * including projectile hits against the static map — is resolved here so the same code can
 * run authoritative on the server later.
 */
import { type Combatant, type Team, createCombatant, emptyInput, eyePos } from './combatant';
import { applyDamage, respawn, revive, tapOut, tickHealth, WaveClock } from './health';
import { type Grenade, GRENADE, blastDamage, stepGrenade, throwGrenade } from './grenade';
import { BOT_CLASS_ORDER, REVIVE_RADIUS, REVIVE_SECONDS, classStats } from './classStats';
import type { PlayerClass } from './etClasses';
import { MOVE, type Stance } from './movement';
import { stepCombatantMovement } from './playerMove';
import { type Projectile, type ProjectileImpact, type RayHit, spawnProjectile, stepProjectile } from './ballistics';
import { startReload, tickWeapon, tryFire } from './weapons';
import { createObjective, OBJECTIVE, tickObjective, type ObjectiveEvent, type ObjectiveState } from './objective';
import { createBrain, thinkBot, type BotBrain } from './bot';
import { hitVolumes, rayCapsule } from './hitbox';

/**
 * Longest rewind the lag compensation will ever apply (s). The shooter's view is behind the server by the interpolation delay (120 ms),
 * the snapshot trip, the command trip and a short queue, so a 60 ms one-way connection already needs about 0.3 s. Players above
 * the limit simply have to lead their targets, which is the price of keeping shots-around-corners small.
 */
export const MAX_REWIND_SECONDS = 0.4;
const HISTORY_SECONDS = 0.7;

interface PoseSample { x: number; y: number; z: number; yaw: number; stance: Stance; downed: boolean; dead: boolean }
interface PoseFrame { t: number; poses: PoseSample[] }
import { Rng } from './rng';
import { type Vec3, v3, clamp, dirFromYawPitch, distXZ } from './vec';
import type { MapDef } from '../map/types';
import { buildNavGraph, coverPoints, lineOfSight, raycastStatic, type NavGraph } from '../map/query';

export interface SimHost {
  /** Move a character by `disp` with collision; return the resolved feet position and grounding. */
  moveCharacter(c: Combatant, disp: Vec3, dt: number): { pos: Vec3; grounded: boolean };
  /** Whether the character has room to take `stance` (ceiling check). */
  canTakeStance?(c: Combatant, stance: Stance): boolean;
  /** Teleport (spawn/respawn). */
  placeCharacter?(c: Combatant): void;
}

export type SimEvent =
  | { type: 'shot'; shooter: number; origin: Vec3; dir: Vec3; projectile: number }
  | { type: 'impact'; point: Vec3; normal: Vec3; material: RayHit['material']; targetId?: number; penetrated: boolean }
  | { type: 'damage'; attacker: number; victim: number; amount: number; zone: string; outcome: string }
  | { type: 'reload'; who: number }
  | { type: 'wave'; team: Team }
  | { type: 'objective'; event: Exclude<ObjectiveEvent, null> }
  | { type: 'grenade'; thrower: number; id: number; pos: Vec3 }
  | { type: 'grenadeBounce'; pos: Vec3 }
  | { type: 'explosion'; pos: Vec3; thrower: number }
  | { type: 'revive'; medic: number; patient: number }
  | { type: 'matchEnd'; winner: Team };

export interface MatchOptions {
  seed: number;
  attackers: number; // including the local player if `withPlayer`
  defenders: number;
  withPlayer: boolean;
  /** Server: keep a short pose history so shots of lagging shooters are tested against where targets were in their view. */
  lagCompensation?: boolean;
  /** Class of the local player (default Soldier); bots cycle through all classes. */
  playerClass?: PlayerClass;
  waveSeconds?: [number, number];
}

export const BOT_CALLSIGNS = ['Falco', 'Orso', 'Vipera', 'Lince', 'Tasso', 'Corvo', 'Lupo', 'Gheppio', 'Istrice', 'Martora'];

export class Match {
  readonly rng: Rng;
  readonly nav: NavGraph;
  readonly cover: Vec3[];
  combatants: Combatant[] = [];
  brains = new Map<number, BotBrain>();
  projectiles: Projectile[] = [];
  grenades: Grenade[] = [];
  /** Active revive per medic: patient id and seconds held. */
  reviveProgress = new Map<number, { patient: number; t: number }>();
  private nextGrenade = 1;
  private history: PoseFrame[] = [];
  objective: ObjectiveState = createObjective();
  waves: [WaveClock, WaveClock];
  events: SimEvent[] = [];
  time = 0;
  playerId = -1;
  private nextProjectile = 1;
  private impacts: ProjectileImpact[] = [];

  constructor(readonly map: MapDef, readonly opts: MatchOptions, private host: SimHost) {
    this.rng = new Rng(opts.seed);
    this.nav = buildNavGraph(map);
    this.cover = coverPoints(map);
    const ws = opts.waveSeconds ?? [20, 25];
    this.waves = [new WaveClock(ws[0]), new WaveClock(ws[1], 7)];
    this.populate();
  }

  private populate(): void {
    let id = 0;
    let botN = 0;
    const perTeam: [number, number] = [0, 0];
    const mk = (team: Team, bot: boolean): void => {
      const cls = bot ? BOT_CLASS_ORDER[perTeam[team]++ % BOT_CLASS_ORDER.length]! : (this.opts.playerClass ?? BOT_CLASS_ORDER[0]!);
      if (!bot) perTeam[team]++;
      const c = createCombatant(id++, team, bot, bot ? BOT_CALLSIGNS[botN++ % BOT_CALLSIGNS.length]! : 'Tu', cls);
      this.combatants.push(c);
      if (bot) this.brains.set(c.id, createBrain(team === 1 ? botN : 0));
      this.spawn(c);
    };
    if (this.opts.withPlayer) { mk(0, false); this.playerId = 0; }
    for (let i = this.opts.withPlayer ? 1 : 0; i < this.opts.attackers; i++) mk(0, true);
    for (let i = 0; i < this.opts.defenders; i++) mk(1, true);
  }

  get player(): Combatant | undefined { return this.playerId >= 0 ? this.combatants[this.playerId] : undefined; }

  spawn(c: Combatant): void {
    const spots = this.map.spawns[c.team];
    const sameTeam = this.combatants.filter((o) => o.team === c.team && o.id < c.id).length;
    const p = spots[(sameTeam + Math.floor(this.time)) % spots.length]!;
    c.pos = v3(p.x, 0.02, p.z);
    c.yaw = this.map.spawnYaw[c.team];
    c.pitch = 0;
    c.kickPitch = 0; c.kickYaw = 0;
    c.move.vel = v3();
    c.move.stance = 'stand';
    c.move.stanceTimer = 0;
    c.move.stamina = c.move.staminaMax;
    c.grenades = classStats(c.cls).grenades;
    c.grenadeCooldown = 0;
    c.prevThrow = false;
    c.move.grounded = true;
    respawn(c.health);
    const spec = c.weapon.spec;
    c.weapon.inMag = spec.magazine - 1; c.weapon.chambered = true;
    c.weapon.reserve = spec.magazine * spec.reserveMagazines;
    c.weapon.phase = 'ready'; c.weapon.cooldown = 0; c.weapon.bloom = 0;
    c.downedFor = 0;
    const b = this.brains.get(c.id);
    if (b) { b.mode = 'patrol'; b.target = -1; b.lastSeen = null; b.path = []; b.pathGoal = null; b.coverSpot = null; }
    this.host.placeCharacter?.(c);
  }

  get phase(): ObjectiveState['phase'] { return this.objective.phase; }

  /** Online: hand a bot slot to a human player (keeps position; class loadout is refilled). */
  assignHuman(id: number, name: string, cls: PlayerClass): void {
    const c = this.combatants[id]!;
    c.isBot = false;
    c.callsign = name;
    this.brains.delete(id);
    c.input = emptyInput();
    c.cls = cls;
    const st = classStats(cls);
    c.move.staminaMax = MOVE.staminaMax * st.staminaScale;
    c.move.stamina = c.move.staminaMax;
    c.grenades = st.grenades;
    c.grenadeCooldown = 0;
  }

  /** Online: a human left for good; the slot goes back to a bot. */
  releaseToBot(id: number): void {
    const c = this.combatants[id]!;
    c.isBot = true;
    c.callsign = BOT_CALLSIGNS[id % BOT_CALLSIGNS.length]!;
    c.input = emptyInput();
    this.brains.set(id, createBrain(c.team === 1 ? id % 4 : 0));
  }

  step(dt: number): void {
    if (this.objective.phase !== 'playing') return;
    this.time += dt;

    for (const c of this.combatants) {
      const brain = this.brains.get(c.id);
      if (brain) thinkBot(this, c, brain, dt);
    }
    for (const c of this.combatants) this.stepCombatant(c, dt);
    this.stepProjectiles(dt);
    if (this.opts.lagCompensation) this.recordPoses();
    this.stepGrenades(dt);
    this.stepWater();
    this.stepRevives(dt);

    for (const c of this.combatants) {
      const was = c.health.state;
      tickHealth(c.health, dt, classStats(c.cls).regenScale);
      if (c.health.state === 'downed') {
        c.downedFor += dt;
        if (c.input.tapOut) tapOut(c.health);
      }
      if (was !== 'dead' && c.health.state === 'dead') c.deaths++;
    }
    for (const team of [0, 1] as Team[]) {
      if (this.waves[team].tick(dt)) {
        let any = false;
        for (const c of this.combatants) if (c.team === team && c.health.state === 'dead') { this.spawn(c); any = true; }
        if (any) this.events.push({ type: 'wave', team });
      }
    }

    const near = (c: Combatant): boolean =>
      c.health.state === 'alive' && c.input.interact && distXZ(c.pos, this.map.objective) <= OBJECTIVE.interactRadius &&
      Math.abs(c.pos.y - (this.map.objective.y - 1.1)) < 1.5;
    const atk = this.combatants.filter((c) => c.team === 0 && near(c));
    const def = this.combatants.filter((c) => c.team === 1 && near(c));
    const ev = tickObjective(this.objective, {
      attackersInteracting: atk.map((c) => c.id),
      defendersInteracting: def.map((c) => c.id),
      attackerScale: atk[0] ? classStats(atk[0].cls).plantScale : 1,
      defenderScale: def[0] ? classStats(def[0].cls).plantScale : 1,
    }, dt);
    if (ev) this.events.push({ type: 'objective', event: ev });
    if (this.objective.phase !== 'playing') {
      this.events.push({ type: 'matchEnd', winner: this.objective.phase === 'attackersWin' ? 0 : 1 });
    }
  }

  private stepCombatant(c: Combatant, dt: number): void {
    const inp = c.input;
    c.sinceShot += dt;
    // Recoil recovery.
    const rec = c.weapon.spec.recoilRecovery * dt;
    c.kickPitch = c.kickPitch > 0 ? Math.max(0, c.kickPitch - rec * (1 + c.kickPitch * 8)) : 0;
    c.kickYaw *= Math.max(0, 1 - 4 * dt);

    if (c.health.state !== 'alive') {
      c.speed = 0;
      // Downed bodies settle; dead ones are out of the world until the wave.
      if (c.health.state === 'downed') {
        const r = this.host.moveCharacter(c, v3(0, -9.81 * dt * dt, 0), dt);
        c.pos = r.pos;
      }
      return;
    }
    stepCombatantMovement(c, this.host, dt);

    // Grenade: one throw per press, with a cooldown.
    c.grenadeCooldown = Math.max(0, c.grenadeCooldown - dt);
    if (inp.throwGrenade && !c.prevThrow && c.grenades > 0 && c.grenadeCooldown <= 0) {
      c.grenades--;
      c.grenadeCooldown = GRENADE.cooldownSeconds;
      const g = throwGrenade(this.nextGrenade++, c.id, c.team, eyePos(c), c.yaw, c.pitch, c.move.vel);
      this.grenades.push(g);
      this.events.push({ type: 'grenade', thrower: c.id, id: g.id, pos: g.pos });
    }
    c.prevThrow = inp.throwGrenade;

    // Weapon.
    tickWeapon(c.weapon, dt, inp.aim && !c.move.sprinting);
    if (inp.reload && startReload(c.weapon)) this.events.push({ type: 'reload', who: c.id });
    if (inp.fire && !c.move.sprinting && c.move.stanceTimer <= 0.05) {
      const shot = tryFire(c.weapon, {
        stance: c.move.stance,
        moving: Math.min(1, c.speed / 4.2),
        airborne: !c.move.grounded,
      }, this.rng);
      if (shot) {
        const origin = eyePos(c);
        const dir = dirFromYawPitch(c.yaw + c.kickYaw + shot.spreadYaw, c.pitch + c.kickPitch + shot.spreadPitch);
        const p = spawnProjectile(this.nextProjectile++, c.id, c.team, origin, dir, c.weapon.spec.bullet);
        if (c.lag > 0) p.lag = c.lag;
        this.projectiles.push(p);
        c.kickPitch += shot.kickPitch;
        c.kickYaw += shot.kickYaw;
        c.sinceShot = 0;
        this.events.push({ type: 'shot', shooter: c.id, origin, dir, projectile: p.id });
      } else if (c.weapon.phase === 'ready' && !c.weapon.chambered && c.weapon.cooldown <= 0 && startReload(c.weapon)) {
        // Auto-reload on empty trigger pull.
        this.events.push({ type: 'reload', who: c.id });
      }
    }
  }

  private recordPoses(): void {
    this.history.push({
      t: this.time,
      poses: this.combatants.map((c) => ({
        x: c.pos.x, y: c.pos.y, z: c.pos.z, yaw: c.yaw, stance: c.move.stance,
        downed: c.health.state === 'downed', dead: c.health.state === 'dead',
      })),
    });
    while (this.history.length > 1 && this.history[0]!.t < this.time - HISTORY_SECONDS) this.history.shift();
  }

  /** Pose of a combatant at match time `t` (interpolated between recorded steps); null when there is no history. */
  private poseAt(id: number, t: number): PoseSample | null {
    const h = this.history;
    if (!h.length) return null;
    if (t <= h[0]!.t) return h[0]!.poses[id] ?? null;
    const last = h[h.length - 1]!;
    if (t >= last.t) return last.poses[id] ?? null;
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1]!, b = h[i]!;
      if (t >= a.t) {
        const pa = a.poses[id], pb = b.poses[id];
        if (!pa || !pb) return pa ?? pb ?? null;
        const k = (t - a.t) / Math.max(1e-9, b.t - a.t);
        const near = k < 0.5 ? pa : pb;
        // A respawn teleports: do not blend across it.
        const jump = Math.hypot(pb.x - pa.x, pb.z - pa.z) > 3;
        return { x: jump ? near.x : pa.x + (pb.x - pa.x) * k, y: jump ? near.y : pa.y + (pb.y - pa.y) * k, z: jump ? near.z : pa.z + (pb.z - pa.z) * k, yaw: near.yaw, stance: near.stance, downed: near.downed, dead: near.dead };
      }
    }
    return null;
  }

  /**
   * Static world + combatant hit volumes; friendly fire off. With `atTime` (lag compensation) each combatant is
   * tested where it was at that match time, using the same hit volumes.
   */
  raycast = (from: Vec3, dir: Vec3, maxDist: number, ignoreId: number, atTime?: number): RayHit | null => {
    let best = raycastStatic(this.map, from, dir, maxDist);
    let bestD = best ? best.distance : maxDist;
    const shooterTeam = this.combatants[ignoreId]?.team;
    for (const c of this.combatants) {
      if (c.id === ignoreId || c.team === shooterTeam) continue;
      const past = atTime !== undefined ? this.poseAt(c.id, atTime) : null;
      const dead = past ? past.dead : c.health.state === 'dead';
      if (dead) continue;
      const px = past ? past.x : c.pos.x, pz = past ? past.z : c.pos.z;
      if (Math.abs(px - from.x) > bestD + 2 || Math.abs(pz - from.z) > bestD + 2) continue;
      const pos = past ? v3(past.x, past.y, past.z) : c.pos;
      const yaw = past ? past.yaw : c.yaw;
      const stance = past ? past.stance : c.move.stance;
      const downed = past ? past.downed : c.health.state === 'downed';
      for (const cap of hitVolumes(pos, yaw, stance, downed)) {
        const t = rayCapsule(from, dir, cap, bestD);
        if (t >= 0 && t < bestD) {
          bestD = t;
          best = {
            distance: t,
            point: v3(from.x + dir.x * t, from.y + dir.y * t, from.z + dir.z * t),
            normal: v3(-dir.x, -dir.y, -dir.z),
            material: 'flesh', thickness: 0, targetId: c.id, zone: cap.zone,
          };
        }
      }
    }
    return best;
  };

  private stepProjectiles(dt: number): void {
    const out = this.impacts;
    for (const p of this.projectiles) {
      out.length = 0;
      const owner = this.combatants[p.ownerId]!;
      // A lagging shooter's rounds are tested against where the targets were in the shooter's view.
      const rewind = p.lag ? (from: Vec3, dir: Vec3, max: number, ignore: number): RayHit | null => this.raycast(from, dir, max, ignore, this.time - p.lag!) : this.raycast;
      stepProjectile(p, owner.weapon.spec.bullet, dt, rewind, out);
      for (const imp of out) {
        const h = imp.hit;
        this.events.push({ type: 'impact', point: h.point, normal: h.normal, material: h.material, targetId: h.targetId, penetrated: imp.penetrated });
        if (h.targetId !== undefined) {
          const victim = this.combatants[h.targetId]!;
          const amount = imp.damage * owner.weapon.spec.zoneMultiplier[h.zone ?? 'torso'];
          const outcome = applyDamage(victim.health, amount, owner.id);
          if (outcome === 'downed') owner.kills++;
          this.events.push({ type: 'damage', attacker: owner.id, victim: victim.id, amount, zone: h.zone ?? 'torso', outcome });
        }
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.alive);
  }

  private stepGrenades(dt: number): void {
    for (const g of this.grenades) {
      const bounces = stepGrenade(g, dt, this.map);
      if (bounces > 0) this.events.push({ type: 'grenadeBounce', pos: { ...g.pos } });
      if (g.fuse <= 0 && g.alive) { this.explode(g); g.alive = false; }
    }
    this.grenades = this.grenades.filter((g) => g.alive);
  }

  private explode(g: Grenade): void {
    const centre = v3(g.pos.x, g.pos.y + 0.2, g.pos.z);
    this.events.push({ type: 'explosion', pos: { ...g.pos }, thrower: g.ownerId });
    const owner = this.combatants[g.ownerId]!;
    for (const c of this.combatants) {
      if (c.health.state === 'dead') continue;
      if (c.team === g.team && c.id !== g.ownerId) continue; // no team damage
      const body = v3(c.pos.x, c.pos.y + (c.health.state === 'downed' || c.move.stance === 'prone' ? 0.25 : c.move.stance === 'crouch' ? 0.85 : 1.25), c.pos.z);
      const d = Math.hypot(body.x - centre.x, body.y - centre.y, body.z - centre.z);
      let amount = blastDamage(d);
      if (amount <= 0) continue;
      if (!lineOfSight(this.map, centre, body)) continue;
      if (c.id === g.ownerId) amount *= GRENADE.selfScale;
      const outcome = applyDamage(c.health, amount, g.ownerId);
      if (outcome === 'downed' && c.id !== g.ownerId) owner.kills++;
      this.events.push({ type: 'damage', attacker: g.ownerId, victim: c.id, amount, zone: 'blast', outcome });
    }
  }

  /** Falling into the sea (maps with land slabs) is fatal: no revive, respawn with the next wave. */
  private stepWater(): void {
    const limit = this.map.waterLevel - 0.8;
    for (const c of this.combatants) {
      if (c.health.state === 'dead' || c.pos.y > limit) continue;
      c.health.hp = 0;
      c.health.state = 'dead';
      c.health.lastAttacker = c.id;
      this.events.push({ type: 'damage', attacker: c.id, victim: c.id, amount: 0, zone: 'water', outcome: 'killed' });
    }
  }

  /** Medics hold interact beside a downed teammate to revive them. */
  private stepRevives(dt: number): void {
    for (const c of this.combatants) {
      const st = classStats(c.cls);
      if (!st.canRevive || c.health.state !== 'alive' || !c.input.interact) { this.reviveProgress.delete(c.id); continue; }
      let patient: Combatant | undefined;
      let best = REVIVE_RADIUS;
      for (const o of this.combatants) {
        if (o.team !== c.team || o.id === c.id || o.health.state !== 'downed') continue;
        const d = distXZ(c.pos, o.pos);
        if (d <= best) { best = d; patient = o; }
      }
      if (!patient) { this.reviveProgress.delete(c.id); continue; }
      const cur = this.reviveProgress.get(c.id);
      const t = (cur && cur.patient === patient.id ? cur.t : 0) + dt;
      if (t >= REVIVE_SECONDS) {
        this.reviveProgress.delete(c.id);
        if (revive(patient.health)) { patient.downedFor = 0; this.events.push({ type: 'revive', medic: c.id, patient: patient.id }); }
      } else this.reviveProgress.set(c.id, { patient: patient.id, t });
    }
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }
}

/**
 * Minimal AABB collision host (used by tests and usable server-side): pushes a vertical
 * capsule out of map boxes in XZ, steps up low ledges, ground at y = 0 and box tops.
 */
export class AabbHost implements SimHost {
  constructor(private map: MapDef, private radius = 0.32) {}
  moveCharacter(c: Combatant, disp: Vec3): { pos: Vec3; grounded: boolean } {
    const p = v3(c.pos.x + disp.x, c.pos.y + disp.y, c.pos.z + disp.z);
    const r = this.radius;
    let floor = 0;
    for (const b of this.map.boxes) {
      const top = b.c.y + b.s.y / 2, bottom = b.c.y - b.s.y / 2;
      const dx = Math.abs(p.x - b.c.x) - b.s.x / 2;
      const dz = Math.abs(p.z - b.c.z) - b.s.z / 2;
      if (dx < r && dz < r) {
        if (top <= p.y + 0.45 && top >= p.y - 0.05) { floor = Math.max(floor, top); continue; }
        if (bottom > p.y + 1.7 || top < p.y) continue;
        // Push out along the axis of least penetration.
        if (r - dx < r - dz) p.x = b.c.x + Math.sign(p.x - b.c.x || 1) * (b.s.x / 2 + r);
        else p.z = b.c.z + Math.sign(p.z - b.c.z || 1) * (b.s.z / 2 + r);
      }
    }
    p.x = clamp(p.x, this.map.bounds.minX + r, this.map.bounds.maxX - r);
    p.z = clamp(p.z, this.map.bounds.minZ + r, this.map.bounds.maxZ - r);
    let grounded = false;
    if (p.y <= floor + 0.001) { p.y = floor; grounded = true; }
    return { pos: p, grounded };
  }
}
