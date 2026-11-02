/**
 * Bot brain: a small finite-state machine (patrol / advance / engage / take cover /
 * objective / investigate), modelled on the reference bot AI node set (seek goal, attack,
 * retreat to cover, plant/defuse — see docs/et-reference.md) but written from scratch.
 * Pure and deterministic given the RNG seed.
 */
import type { Combatant } from './combatant';
import type { Match } from './match';
import { chestPos, eyePos } from './combatant';
import { findPath, lineOfSight, nearestNode, raycastStatic } from '../map/query';
import { GRENADE, pitchForDistance } from './grenade';
import { RESUPPLY, classStats } from './classStats';
import { findGridPath } from '../map/navgrid';
import { OBJECTIVE } from './objective';
import { roundsLoaded } from './weapons';
import { type Vec3, v3, clamp, dirFromYawPitch, dist, distXZ, wrapAngle } from './vec';

export type BotMode = 'patrol' | 'advance' | 'engage' | 'cover' | 'objective' | 'investigate';

export interface BotSkill {
  reactionMin: number;
  reactionMax: number;
  /** Initial aim error (rad) that decays while tracking. */
  aimErrorStart: number;
  aimErrorFloor: number;
  aimSettleSeconds: number;
  turnRate: number;
  viewDistance: number;
  fovCos: number;
}

export const DEFAULT_SKILL: BotSkill = {
  reactionMin: 0.35,
  reactionMax: 0.75,
  aimErrorStart: 0.09,
  aimErrorFloor: 0.012,
  aimSettleSeconds: 1.6,
  turnRate: 5,
  viewDistance: 75,
  fovCos: Math.cos((115 / 2) * Math.PI / 180),
};

/**
 * Difficulty presets. Attacker bots (the player's team) always use the regular skill so the team stays useful;
 * the preset changes the defenders, who are the player's opponents.
 */
export function skillFor(d: 'recruit' | 'regular' | 'veteran', playerTeam: boolean): BotSkill {
  if (playerTeam || d === 'regular') return { ...DEFAULT_SKILL, reactionMin: 0.45, reactionMax: 0.85, aimErrorStart: 0.11 };
  if (d === 'recruit') return { ...DEFAULT_SKILL, reactionMin: 0.65, reactionMax: 1.15, aimErrorStart: 0.15, aimErrorFloor: 0.022, aimSettleSeconds: 2.4, turnRate: 3.6, viewDistance: 60 };
  return { ...DEFAULT_SKILL };
}

/** Opening of a round: bots aim worse for the first 20 s (factor 1.6 → 1) so nobody is cut down while getting oriented. */
export const warmupAimFactor = (time: number): number => 1 + 0.6 * Math.max(0, 1 - time / 20);

export interface BotBrain {
  mode: BotMode;
  skill: BotSkill;
  target: number;
  lastSeen: Vec3 | null;
  lastSeenAge: number;
  reaction: number;
  trackTime: number;
  aimErrX: number;
  aimErrY: number;
  burstLeft: number;
  burstPause: number;
  path: Vec3[];
  pathGoal: Vec3 | null;
  repathTimer: number;
  coverSpot: Vec3 | null;
  coverTimer: number;
  patrolLoop: number;
  patrolIdx: number;
  waitTimer: number;
  perceiveTimer: number;
  stuckTimer: number;
  stuckRef: Vec3;
  strafeSign: number;
  strafeTimer: number;
  grenadeTimer: number;
}

export function createBrain(patrolLoop: number, skill: BotSkill = DEFAULT_SKILL): BotBrain {
  return {
    mode: 'patrol', skill, target: -1, lastSeen: null, lastSeenAge: 99, reaction: 0, trackTime: 0,
    aimErrX: 0, aimErrY: 0, burstLeft: 0, burstPause: 0, path: [], pathGoal: null, repathTimer: 0,
    coverSpot: null, coverTimer: 0, patrolLoop, patrolIdx: 0, waitTimer: 0, perceiveTimer: 0,
    stuckTimer: 0, stuckRef: v3(), strafeSign: 1, strafeTimer: 0, grenadeTimer: 4,
  };
}

/** Writes `self.input`, `self.yaw`, `self.pitch` for this step. */
export function thinkBot(m: Match, self: Combatant, b: BotBrain, dt: number): void {
  const inp = self.input;
  inp.fire = false; inp.reload = false; inp.interact = false; inp.jump = false; inp.sprint = false; inp.aim = false;
  inp.moveX = 0; inp.moveY = 0; inp.lookYaw = 0; inp.lookPitch = 0; inp.tapOut = false; inp.throwGrenade = false;
  if (self.health.state === 'downed') {
    // Wait longer when a medic teammate is alive, otherwise go to limbo quickly.
    const medicAlive = m.combatants.some((o) => o.team === self.team && o.health.state === 'alive' && classStats(o.cls).canRevive);
    inp.tapOut = self.downedFor > (medicAlive ? 12 : 3);
    return;
  }
  if (self.health.state !== 'alive') return;

  // --- Perception (throttled like a real bot think rate).
  b.perceiveTimer -= dt;
  b.lastSeenAge += dt;
  if (b.perceiveTimer <= 0) {
    b.perceiveTimer = 0.15 + m.rng.next() * 0.1;
    perceive(m, self, b);
  }
  const target = b.target >= 0 ? m.combatants[b.target] : undefined;
  const targetVisible = !!target && b.lastSeenAge < 0.3 && target.health.state === 'alive';

  // --- Mode transitions.
  const lowHealth = self.health.hp < 45;
  const needReload = roundsLoaded(self.weapon) === 0 || (roundsLoaded(self.weapon) < 8 && !targetVisible);
  if (b.mode === 'cover') {
    b.coverTimer -= dt;
    if (b.coverTimer <= 0 && !lowHealth && self.weapon.phase === 'ready') b.mode = targetVisible ? 'engage' : 'investigate';
  } else if (targetVisible) {
    if ((lowHealth || roundsLoaded(self.weapon) === 0) && pickCover(m, self, b, target!)) {
      b.mode = 'cover';
    } else {
      if (b.mode !== 'engage') { b.reaction = m.rng.range(b.skill.reactionMin, b.skill.reactionMax); b.trackTime = 0; }
      b.mode = 'engage';
    }
  } else if (b.mode === 'engage') {
    b.mode = b.lastSeen && b.lastSeenAge < 6 ? 'investigate' : defaultMode(m, self);
  } else if (b.mode === 'investigate' && (b.lastSeenAge > 6 || !b.lastSeen)) {
    b.mode = defaultMode(m, self);
  } else if (b.mode === 'patrol' || b.mode === 'advance' || b.mode === 'objective') {
    b.mode = defaultMode(m, self);
  }
  if (needReload && self.weapon.phase === 'ready') inp.reload = true;

  // --- Behaviour per mode.
  let moveGoal: Vec3 | null = null;
  let face: Vec3 | null = null;
  let urgent = false;
  switch (b.mode) {
    case 'engage': {
      const t = target!;
      face = chestPos(t);
      b.trackTime += dt;
      const d = dist(self.pos, t.pos);
      // Stance: crouch at range or when shooting from cover.
      inp.wantStance = d > 30 ? 'crouch' : 'stand';
      inp.aim = d > 12;
      // Strafe while fighting at close/mid range.
      b.strafeTimer -= dt;
      if (b.strafeTimer <= 0) { b.strafeTimer = m.rng.range(0.6, 1.6); b.strafeSign = m.rng.next() < 0.5 ? -1 : 1; }
      if (inp.wantStance === 'stand') inp.moveX = 0.6 * b.strafeSign;
      if (d > 45) inp.moveY = 0.5;
      if (b.reaction > 0) b.reaction -= dt;
      else fireControl(m, self, b, t, dt);
      break;
    }
    case 'cover': {
      moveGoal = b.coverSpot;
      urgent = true;
      if (b.coverSpot && distXZ(self.pos, b.coverSpot) < 0.8) {
        inp.wantStance = 'crouch';
        if (self.weapon.phase === 'ready' && roundsLoaded(self.weapon) < self.weapon.spec.magazine) inp.reload = true;
      } else inp.wantStance = 'stand';
      if (b.lastSeen) face = b.lastSeen;
      break;
    }
    case 'investigate': {
      moveGoal = b.lastSeen;
      face = b.lastSeen;
      inp.wantStance = 'stand';
      inp.aim = true;
      if (b.lastSeen && distXZ(self.pos, b.lastSeen) < 1.5) { b.lastSeen = null; }
      break;
    }
    case 'objective': {
      const obj = m.map.objective;
      const near = distXZ(self.pos, obj) <= OBJECTIVE.interactRadius * 0.8;
      inp.wantStance = 'stand';
      if (!near) { moveGoal = v3(obj.x, 0, obj.z + 0.9); urgent = true; }
      else { inp.interact = true; inp.wantStance = 'crouch'; face = obj; }
      break;
    }
    case 'advance': {
      // Attacker bots push toward the site via the yard, then hold near it.
      const obj = m.map.objective;
      const guard = v3(obj.x + (self.id % 2 ? 2.5 : -2.5), 0, obj.z + 5.5);
      moveGoal = distXZ(self.pos, guard) > 1.5 ? guard : null;
      inp.wantStance = moveGoal ? 'stand' : 'crouch';
      break;
    }
    case 'patrol':
    default: {
      if (!m.map.patrols.length) {
        // No patrol loops on this map: hold near the objective instead of failing.
        const obj = m.map.objective;
        const hold = v3(obj.x + (self.id % 2 ? 3 : -3), 0, obj.z + (self.id % 3) - 1);
        moveGoal = distXZ(self.pos, hold) > 1.5 ? hold : null;
        inp.wantStance = moveGoal ? 'stand' : 'crouch';
        break;
      }
      const loop = m.map.patrols[b.patrolLoop % m.map.patrols.length]!;
      const node = m.map.waypoints[loop[b.patrolIdx % loop.length]!]!;
      if (b.waitTimer > 0) { b.waitTimer -= dt; break; }
      moveGoal = node;
      if (distXZ(self.pos, node) < 1.2) { b.patrolIdx++; b.waitTimer = m.rng.range(0.5, 3); }
      inp.wantStance = 'stand';
      break;
    }
  }

  // Medics go to a downed teammate (no enemy in sight) and hold interact beside them.
  if (classStats(self.cls).canRevive && b.mode !== 'engage' && b.mode !== 'cover') {
    const patient = nearestDowned(m, self, 40);
    if (patient) {
      face = patient.pos;
      if (distXZ(self.pos, patient.pos) > 1.1) { moveGoal = patient.pos; urgent = true; }
      else { moveGoal = null; inp.interact = true; inp.wantStance = 'crouch'; }
    }
  }

  // Field Ops bring ammunition to a teammate running low (no enemy in sight).
  if (classStats(self.cls).canResupply && b.mode !== 'engage' && b.mode !== 'cover') {
    const mate = nearestLowAmmo(m, self, 30);
    if (mate && distXZ(self.pos, mate.pos) > RESUPPLY.radius * 0.6) { moveGoal = mate.pos; urgent = true; }
  }

  if (moveGoal) steer(m, self, b, moveGoal, dt, urgent && !face);
  if (!face && moveGoal && b.path.length) face = b.path[0]!;
  if (face) turnToward(self, eyePos(self), face, b, dt, b.mode === 'engage', warmupAimFactor(m.time));
  maybeThrowGrenade(m, self, b, target, targetVisible, dt);
}

function nearestLowAmmo(m: Match, self: Combatant, maxDist: number): Combatant | undefined {
  let best: Combatant | undefined;
  let bd = maxDist;
  for (const o of m.combatants) {
    if (o.team !== self.team || o.id === self.id || o.health.state !== 'alive') continue;
    if (o.weapon.reserve >= o.weapon.spec.magazine * RESUPPLY.lowMagazines) continue;
    const d = distXZ(self.pos, o.pos);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

function nearestDowned(m: Match, self: Combatant, maxDist: number): Combatant | undefined {
  let best: Combatant | undefined;
  let bd = maxDist;
  for (const o of m.combatants) {
    if (o.team !== self.team || o.id === self.id || o.health.state !== 'downed') continue;
    const d = distXZ(self.pos, o.pos);
    if (d < bd) { bd = d; best = o; }
  }
  return best;
}

/** Lob a grenade at a hidden or distant enemy 7-19 m away; runs after aiming so it can snap yaw/pitch for the throw. */
function maybeThrowGrenade(m: Match, self: Combatant, b: BotBrain, target: Combatant | undefined, visible: boolean, dt: number): void {
  b.grenadeTimer -= dt;
  if (self.grenades <= 0 || b.grenadeTimer > 0 || self.grenadeCooldown > 0) return;
  if (b.mode !== 'engage' && b.mode !== 'investigate') return;
  const at = visible && target ? target.pos : (b.lastSeen && b.lastSeenAge < 5 ? b.lastSeen : null);
  if (!at) return;
  const d = distXZ(self.pos, at);
  if (d < 7 || d > 19) return;
  // A target in plain sight is usually shot, not grenaded.
  if (visible && m.rng.next() > 0.25) { b.grenadeTimer = 1; return; }
  const pitch = pitchForDistance(d);
  if (pitch === null) return;
  const eye = eyePos(self);
  const yaw = Math.atan2(-(at.x - eye.x), -(at.z - eye.z));
  // No wall right in front of the thrower.
  if (raycastStatic(m.map, eye, dirFromYawPitch(yaw, pitch + GRENADE.liftRad), 4)) { b.grenadeTimer = 1.5; return; }
  self.yaw = yaw;
  self.pitch = pitch;
  self.input.throwGrenade = true;
  b.grenadeTimer = m.rng.range(6, 12);
}

function defaultMode(m: Match, self: Combatant): 'patrol' | 'advance' | 'objective' {
  const charge = m.objective.charge;
  if (self.team === 1) return charge === 'armed' || charge === 'defusing' ? 'objective' : 'patrol';
  return charge === 'idle' || charge === 'planting' ? 'objective' : 'advance';
}

function perceive(m: Match, self: Combatant, b: BotBrain): void {
  const eye = eyePos(self);
  const fwdX = -Math.sin(self.yaw), fwdZ = -Math.cos(self.yaw);
  const recentlyHit = self.health.sinceDamage < 1.0;
  let best = -1, bestD = Infinity;
  for (const o of m.combatants) {
    if (o.team === self.team || o.health.state !== 'alive' || o.spawnShield > 0) continue;
    const tp = chestPos(o);
    const d = dist(eye, tp);
    if (d > b.skill.viewDistance) continue;
    const cos = ((tp.x - eye.x) * fwdX + (tp.z - eye.z) * fwdZ) / Math.max(1e-6, Math.hypot(tp.x - eye.x, tp.z - eye.z));
    const attacker = recentlyHit && self.health.lastAttacker === o.id;
    if (cos < b.skill.fovCos && !attacker && d > 4) continue;
    // Prone targets far away are harder to spot.
    if (o.move.stance === 'prone' && d > 35 && !attacker) continue;
    if (!lineOfSight(m.map, eye, tp) && !lineOfSight(m.map, eye, eyePos(o))) continue;
    if (d < bestD) { bestD = d; best = o.id; }
  }
  if (best >= 0) {
    if (best !== b.target) { b.trackTime = 0; b.aimErrX = m.rng.gauss(); b.aimErrY = m.rng.gauss(); }
    b.target = best;
    b.lastSeen = { ...m.combatants[best]!.pos };
    b.lastSeenAge = 0;
  } else if (recentlyHit && self.health.lastAttacker >= 0 && !b.lastSeen) {
    b.lastSeen = { ...m.combatants[self.health.lastAttacker]!.pos };
    b.lastSeenAge = 0.5;
  }
}

function fireControl(m: Match, self: Combatant, b: BotBrain, t: Combatant, dt: number): void {
  if (self.weapon.phase !== 'ready') return;
  if (b.burstPause > 0) { b.burstPause -= dt; return; }
  const e = eyePos(self), c = chestPos(t);
  const want = Math.atan2(-(c.x - e.x), -(c.z - e.z));
  if (Math.abs(wrapAngle(want - self.yaw)) > 0.15) return;
  if (b.burstLeft <= 0) { b.burstLeft = 3 + Math.floor(m.rng.next() * 5); }
  // Only fire once roughly on target.
  self.input.fire = true;
  if (self.weapon.cooldown <= 0 && self.weapon.chambered) {
    b.burstLeft--;
    if (b.burstLeft <= 0) b.burstPause = m.rng.range(0.2, 0.55);
  }
}

function turnToward(self: Combatant, eye: Vec3, p: Vec3, b: BotBrain, dt: number, withError: boolean, errScale = 1): void {
  const dx = p.x - eye.x, dy = p.y - eye.y, dz = p.z - eye.z;
  let yaw = Math.atan2(-dx, -dz);
  let pitch = Math.atan2(dy, Math.hypot(dx, dz));
  if (withError) {
    const k = Math.max(0, 1 - b.trackTime / b.skill.aimSettleSeconds);
    const err = (b.skill.aimErrorFloor + (b.skill.aimErrorStart - b.skill.aimErrorFloor) * k) * errScale;
    yaw += b.aimErrX * err;
    pitch += b.aimErrY * err * 0.6;
    // Compensate own recoil like a trained shooter (partially).
    pitch -= self.kickPitch * 0.7;
  }
  const maxTurn = b.skill.turnRate * dt;
  self.yaw = wrapAngle(self.yaw + clamp(wrapAngle(yaw - self.yaw), -maxTurn, maxTurn));
  self.pitch = clamp(self.pitch + clamp(pitch - self.pitch, -maxTurn, maxTurn), -1.4, 1.4);
}

function steer(m: Match, self: Combatant, b: BotBrain, goal: Vec3, dt: number, sprint: boolean): void {
  b.repathTimer -= dt;
  if (!b.pathGoal || distXZ(b.pathGoal, goal) > 1 || b.repathTimer <= 0 || b.path.length === 0) {
    b.pathGoal = { ...goal };
    b.repathTimer = 3;
    // Baked grid A* when the map has one; waypoint graph otherwise (or if the grid finds no route).
    const grid = m.map.navGrid ? findGridPath(m.map.navGrid, self.pos, goal) : null;
    let nodes: Vec3[];
    if (grid) {
      nodes = grid.points.map((p) => ({ x: p.x, y: 0, z: p.z }));
    } else {
      const s = nearestNode(m.nav, m.map, self.pos);
      const g = nearestNode(m.nav, m.map, goal);
      nodes = findPath(m.nav, s, g).map((i) => m.nav.nodes[i]!);
    }
    // Skip the first node if we are already past it toward the next.
    if (nodes.length > 1 && distXZ(self.pos, nodes[1]!) < distXZ(nodes[0]!, nodes[1]!)) nodes.shift();
    b.path = [...nodes, { ...goal }];
  }
  while (b.path.length > 1 && distXZ(self.pos, b.path[0]!) < 1.0) b.path.shift();
  const next = b.path[0];
  if (!next) return;
  const dx = next.x - self.pos.x, dz = next.z - self.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.25) return;
  const wx = dx / d, wz = dz / d;
  // World dir → local input relative to body yaw.
  const fx = -Math.sin(self.yaw), fz = -Math.cos(self.yaw);
  const rx = Math.cos(self.yaw), rz = -Math.sin(self.yaw);
  const slow = d < 1.5 && b.path.length === 1 ? 0.5 : 1;
  self.input.moveY = (wx * fx + wz * fz) * slow;
  self.input.moveX = (wx * rx + wz * rz) * slow;
  self.input.sprint = sprint && self.input.moveY > 0.7;

  // Stuck handling: hop / jitter / repath.
  b.stuckTimer += dt;
  if (b.stuckTimer > 1.2) {
    if (distXZ(self.pos, b.stuckRef) < 0.3) {
      self.input.jump = true;
      b.repathTimer = 0;
      b.path.shift();
    }
    b.stuckTimer = 0;
    b.stuckRef = { ...self.pos };
  }
}

function pickCover(m: Match, self: Combatant, b: BotBrain, threat: Combatant): boolean {
  const te = eyePos(threat);
  let best: Vec3 | null = null, bestScore = Infinity;
  for (const p of m.cover) {
    const d = distXZ(self.pos, p);
    if (d > 14 || d < 0.5) continue;
    const hidden = !lineOfSight(m.map, te, v3(p.x, 0.95, p.z));
    if (!hidden) continue;
    const score = d + (distXZ(p, threat.pos) < 6 ? 20 : 0);
    if (score < bestScore) { bestScore = score; best = p; }
  }
  if (!best) return false;
  b.coverSpot = best;
  b.coverTimer = m.rng.range(2.5, 4.5);
  b.path = [];
  b.pathGoal = null;
  return true;
}
