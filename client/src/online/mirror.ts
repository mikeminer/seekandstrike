import type { Snapshot, SnapEvent } from '@shared/protocol';
import { AabbHost, Match, PACE, type SimEvent } from '@shared/sim/match';
import type { Combatant } from '@shared/sim/combatant';
import type { MapDef } from '@shared/map/types';
import { raycastStatic } from '@shared/map/query';
import { HEALTH, WaveClock } from '@shared/sim/health';
import { spawnProjectile, stepProjectile, type ProjectileImpact, type SurfaceMaterial } from '@shared/sim/ballistics';
import { RIFLE_R30, approachAds } from '@shared/sim/weapons';
import type { Grenade } from '@shared/sim/grenade';
import { type Vec3, v3 } from '@shared/sim/vec';
import type { GrenadePose, Pose } from './snapshots';

const STANCE = ['stand', 'crouch', 'prone'] as const;
const LIFE = ['alive', 'downed', 'dead'] as const;
/** Same reinforcement pace as the server's Match (was a stale copy of the old 20/25 s). */
const WAVE_SECONDS: [number, number] = [...PACE.waveSeconds];

/** Keeps the received angles away from the local view for the player's own soldier. */
export interface SelfView { yaw: number; pitch: number }

/**
 * A client-side `Match` that is never stepped: its combatants, objective and grenades are overwritten from
 * server snapshots so the existing renderers, HUD and sound code work unchanged. Own view angles stay local
 * (the server limits turn rate); the own position follows the newest snapshot with smoothing instead of the
 * delayed interpolation used for everyone else (there is no client-side prediction yet).
 */
export class Mirror {
  readonly match: Match;
  private downedAt = new Map<number, number>();
  private grenadeY = new Map<number, { y: number; dy: number }>();
  private time = 0;

  constructor(map: MapDef, playerId: number) {
    this.match = new Match(map, { seed: 1, attackers: 4, defenders: 4, withPlayer: false }, new AabbHost(map));
    this.match.playerId = playerId;
    this.match.brains.clear();
    this.match.waves = [new WaveClock(WAVE_SECONDS[0]), new WaveClock(WAVE_SECONDS[1], 7)];
  }

  get self(): Combatant { return this.match.combatants[this.match.playerId]!; }

  /** Applies everything in a snapshot that is not interpolated; returns the sim events to feed the effects. */
  applyState(snap: Snapshot): SimEvent[] {
    const m = this.match;
    const extra: SimEvent[] = [];
    for (const p of snap.players) {
      const c = m.combatants[p.id];
      if (!c) continue;
      if (p.id !== m.playerId) {
        // Others: only the reload/aim flags drive their animation (the own weapon is handled from `snap.self`).
        const w = c.weapon;
        if (p.rl && w.phase !== 'reloading') {
          w.phase = 'reloading';
          w.reloadTotal = w.spec.reloadTacticalSeconds;
          w.reloadTimer = w.reloadTotal;
          extra.push({ type: 'reload', who: p.id });
        } else if (!p.rl && w.phase === 'reloading') { w.phase = 'ready'; w.reloadTimer = 0; }
        c.input.aim = p.ad === 1;
      }
      c.callsign = p.n;
      c.cls = p.cl as Combatant['cls'];
      c.isBot = p.hu === 0;
      c.kills = p.k;
      c.deaths = p.d;
      c.health.hp = p.hp;
      const prev = c.health.state;
      c.health.state = LIFE[p.lf];
      if (c.health.state === 'downed' && prev !== 'downed') { c.health.downedTimer = HEALTH.bleedOutSeconds; this.downedAt.set(c.id, this.time); }
      if (c.health.state !== 'downed') this.downedAt.delete(c.id);
      c.move.stance = STANCE[p.st];
      c.speed = p.sp;
      c.move.sprinting = c.id !== m.playerId && p.sp > 5;
      c.move.grounded = true;
    }
    const o = m.objective;
    o.charge = snap.obj.charge as typeof o.charge;
    o.progress = snap.obj.progress;
    o.fuse = snap.obj.fuse;
    o.clock = snap.obj.clock;
    o.phase = snap.obj.phase as typeof o.phase;
    m.time = snap.time;

    const me = this.self;
    const s = snap.self;
    const w = me.weapon;
    me.health.hp = s.hp;
    w.inMag = Math.max(0, s.mag - 1);
    w.chambered = s.mag > 0;
    w.reserve = s.reserve;
    me.grenades = s.grenades;
    me.move.stamina = s.stamina;
    if (s.reloading && w.phase !== 'reloading') {
      extra.push({ type: 'reload', who: m.playerId });
      w.phase = 'reloading';
      w.reloadTotal = w.chambered ? w.spec.reloadTacticalSeconds : w.spec.reloadEmptySeconds;
      w.reloadTimer = w.reloadTotal;
    } else if (!s.reloading && w.phase === 'reloading') {
      w.phase = 'ready';
      w.reloadTimer = 0;
    }
    // Events this client does not know (from a newer server) are dropped, never passed on as undefined.
    return [...extra, ...snap.ev.map((e) => this.toSimEvent(e)).filter((e): e is SimEvent => e != null)];
  }

  private toSimEvent(e: SnapEvent): SimEvent | null {
    const m = this.match;
    switch (e.e) {
      case 'shot': {
        const origin = v3(e.x, e.y, e.z), dir = v3(e.dx, e.dy, e.dz);
        const shooter = m.combatants[e.by];
        if (!shooter) return null;
        const p = spawnProjectile(-(m.projectiles.length + 1), e.by, shooter.team, origin, dir, RIFLE_R30.bullet);
        m.projectiles.push(p); // cosmetic tracer only: hits come from the server
        shooter.sinceShot = 0;
        shooter.weapon.shotsFired++; // drives the fire clip of every soldier
        if (e.by === m.playerId) shooter.kickPitch += RIFLE_R30.recoilPitch;
        return { type: 'shot', shooter: e.by, origin, dir, projectile: p.id };
      }
      case 'impact':
        return { type: 'impact', point: v3(e.x, e.y, e.z), normal: v3(0, 1, 0), material: e.mat as SurfaceMaterial, ...(e.tgt !== undefined ? { targetId: e.tgt } : {}), penetrated: false };
      case 'damage':
        return { type: 'damage', attacker: e.by, victim: e.vic, amount: e.amt, zone: e.zone, outcome: e.out };
      case 'grenade': return { type: 'grenade', thrower: e.by, id: 0, pos: v3(e.x, e.y, e.z) };
      case 'explosion': return { type: 'explosion', pos: v3(e.x, e.y, e.z), thrower: e.by };
      case 'revive': return { type: 'revive', medic: e.by, patient: e.vic };
      case 'resupply': return { type: 'resupply', giver: e.by, recipient: e.vic, rounds: e.n };
      case 'objective': return { type: 'objective', event: e.ev as Extract<SimEvent, { type: 'objective' }>['event'] };
      case 'wave': {
        m.waves[e.tm] = new WaveClock(WAVE_SECONDS[e.tm]);
        return { type: 'wave', team: e.tm };
      }
      case 'matchEnd': return { type: 'matchEnd', winner: e.winner };
    }
  }

  /** Positions every frame. Others use the interpolated pose; the local player eases toward the newest one. */
  applyPoses(poses: Map<number, Pose>, selfLatest: Pose | undefined, view: SelfView, dt: number): void {
    const m = this.match;
    for (const [id, p] of poses) {
      const c = m.combatants[id];
      if (!c || id === m.playerId) continue;
      c.pos.x = p.x; c.pos.y = p.y; c.pos.z = p.z; c.yaw = p.yw; c.pitch = p.pt;
    }
    const me = this.self;
    if (selfLatest) {
      const k = 1 - Math.exp(-dt * 14);
      const far = Math.hypot(selfLatest.x - me.pos.x, selfLatest.z - me.pos.z) > 4;
      me.pos.x = far ? selfLatest.x : me.pos.x + (selfLatest.x - me.pos.x) * k;
      me.pos.y = far ? selfLatest.y : me.pos.y + (selfLatest.y - me.pos.y) * k;
      me.pos.z = far ? selfLatest.z : me.pos.z + (selfLatest.z - me.pos.z) * k;
    }
    me.yaw = view.yaw;
    me.pitch = view.pitch;
  }

  /** Own movement from the predictor: position, velocity, stance (no waiting for a snapshot). */
  applySelfPrediction(pos: Vec3, vel: Vec3, stance: Combatant['move']['stance'], sprinting: boolean): void {
    const me = this.self;
    me.pos.x = pos.x; me.pos.y = pos.y; me.pos.z = pos.z;
    me.move.vel = { x: vel.x, y: vel.y, z: vel.z };
    me.move.stance = stance;
    me.move.sprinting = sprinting;
    me.speed = Math.hypot(vel.x, vel.z);
  }

  /** Grenades follow the interpolated poses; a downward-to-upward turn in height is reported as a bounce (sound). */
  applyGrenades(poses: GrenadePose[]): SimEvent[] {
    const out: SimEvent[] = [];
    const seen = new Map<number, { y: number; dy: number }>();
    for (const g of poses) {
      const before = this.grenadeY.get(g.id);
      const dy = before ? g.y - before.y : 0;
      if (before && before.dy < -0.01 && dy > 0.01) out.push({ type: 'grenadeBounce', pos: v3(g.x, g.y, g.z) });
      seen.set(g.id, { y: g.y, dy: Math.abs(dy) < 1e-4 && before ? before.dy : dy });
    }
    this.grenadeY = seen;
    this.match.grenades = poses.map((g): Grenade => ({
      id: g.id, ownerId: -1, team: 0, pos: v3(g.x, g.y, g.z), vel: v3(), fuse: 1, alive: true, bounces: 0,
    }));
    return out;
  }

  /** Local-only visuals: ADS blend, reload clock, recoil decay, wave clocks and tracer flight. */
  tickLocal(dt: number, aim: boolean, sprinting: boolean): void {
    this.time += dt;
    const m = this.match;
    const me = this.self;
    const w = me.weapon;
    const target = aim && !sprinting && w.phase !== 'reloading' ? 1 : 0;
    w.ads = approachAds(w.ads, target, dt / w.spec.adsSeconds);
    if (w.phase === 'reloading') { w.reloadTimer -= dt; if (w.reloadTimer <= 0) { w.phase = 'ready'; w.reloadTimer = 0; } }
    me.move.sprinting = sprinting;
    me.kickPitch = me.kickPitch > 0 ? Math.max(0, me.kickPitch - w.spec.recoilRecovery * dt * (1 + me.kickPitch * 8)) : 0;
    for (const c of m.combatants) {
      c.sinceShot += dt;
      const at = this.downedAt.get(c.id);
      if (at !== undefined) c.health.downedTimer = Math.max(0, HEALTH.bleedOutSeconds - (this.time - at));
    }
    for (const wc of m.waves) wc.tick(dt);
    const out: ProjectileImpact[] = [];
    for (const p of m.projectiles) {
      out.length = 0;
      stepProjectile(p, RIFLE_R30.bullet, dt, (o, d, max) => raycastStatic(m.map, o, d, max), out);
    }
    m.projectiles = m.projectiles.filter((p) => p.alive);
  }
}
