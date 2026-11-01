import RAPIER from '@dimforge/rapier3d-compat';
import type { MapDef } from '@shared/map/types';
import type { Combatant } from '@shared/sim/combatant';
import type { SimHost } from '@shared/sim/match';
import { MOVE, type Stance } from '@shared/sim/movement';
import { type Vec3, v3 } from '@shared/sim/vec';

/**
 * Rapier-backed character collision for the offline mode. The static map is mirrored as
 * cuboid colliders; each combatant owns a parentless capsule moved by a
 * KinematicCharacterController (autostep, snap-to-ground, slope limit). Bullet hits are NOT
 * resolved here — the shared sim does that deterministically against the same AABBs.
 */
export interface PhysicsWorld extends SimHost {
  readonly version: string;
  /** Call once per fixed step after all characters moved (updates the broad phase). */
  step(): void;
  dispose(): void;
}

interface Body { collider: RAPIER.Collider; stance: Stance | 'downed'; }

const shapeFor = (stance: Stance | 'downed'): { half: number; r: number } => {
  const h = stance === 'downed' ? MOVE.height.prone : MOVE.height[stance];
  const r = stance === 'prone' || stance === 'downed' ? 0.28 : MOVE.capsuleRadius;
  return { half: Math.max(0.01, h / 2 - r), r };
};

export async function createPhysicsWorld(map: MapDef, stepSeconds: number): Promise<PhysicsWorld> {
  await RAPIER.init();
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.timestep = stepSeconds;
  // Ground + map + invisible boundary walls (quay edge, perimeter), sized from the map bounds:
  // a fixed 160 m slab let players fall off larger maps (Porto Vecchio is 280 × 300 m).
  const { minX, maxX, minZ, maxZ } = map.bounds;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const hx = Math.max(80, (maxX - minX) / 2 + 10), hz = Math.max(80, (maxZ - minZ) / 2 + 10);
  world.createCollider(RAPIER.ColliderDesc.cuboid(hx, 0.5, hz).setTranslation(cx, -0.5, cz));
  for (const b of map.boxes) {
    world.createCollider(RAPIER.ColliderDesc.cuboid(b.s.x / 2, b.s.y / 2, b.s.z / 2).setTranslation(b.c.x, b.c.y, b.c.z));
  }
  const wall = (x: number, z: number, wx: number, wz: number): void => {
    world.createCollider(RAPIER.ColliderDesc.cuboid(wx, 10, wz).setTranslation(x, 10, z));
  };
  wall(minX - 0.5, cz, 0.5, hz); wall(maxX + 0.5, cz, 0.5, hz);
  wall(cx, minZ - 0.5, hx, 0.5); wall(cx, maxZ + 0.5, hx, 0.5);

  const kcc = world.createCharacterController(0.02);
  kcc.setUp({ x: 0, y: 1, z: 0 });
  kcc.enableAutostep(MOVE.stepHeight, 0.2, false);
  kcc.enableSnapToGround(0.3);
  kcc.setMaxSlopeClimbAngle((45 * Math.PI) / 180);
  kcc.setMinSlopeSlideAngle((50 * Math.PI) / 180);
  kcc.setApplyImpulsesToDynamicBodies(false);

  const bodies = new Map<number, Body>();
  /** Handles of disabled (dead) character colliders. Checked in the KCC filter WITHOUT calling into
   *  wasm: touching a collider inside the predicate re-borrows the world and panics. */
  const disabled = new Set<number>();

  const ensure = (c: Combatant): Body => {
    let b = bodies.get(c.id);
    if (!b) {
      const s = shapeFor('stand');
      const collider = world.createCollider(RAPIER.ColliderDesc.capsule(s.half, s.r).setTranslation(c.pos.x, c.pos.y + MOVE.height.stand / 2, c.pos.z));
      b = { collider, stance: 'stand' };
      bodies.set(c.id, b);
    }
    return b;
  };
  const centreY = (stance: Stance | 'downed'): number => (stance === 'downed' ? MOVE.height.prone : MOVE.height[stance]) / 2;

  const setStance = (b: Body, stance: Stance | 'downed', feet: Vec3): void => {
    if (b.stance === stance) return;
    const s = shapeFor(stance);
    b.collider.setShape(new RAPIER.Capsule(s.half, s.r));
    b.stance = stance;
    b.collider.setTranslation({ x: feet.x, y: feet.y + centreY(stance), z: feet.z });
  };

  const tmpRot = { x: 0, y: 0, z: 0, w: 1 };

  return {
    version: RAPIER.version(),
    placeCharacter(c) {
      const b = ensure(c);
      b.collider.setEnabled(true);
      disabled.delete(b.collider.handle);
      setStance(b, 'stand', c.pos);
      b.collider.setTranslation({ x: c.pos.x, y: c.pos.y + centreY('stand'), z: c.pos.z });
    },
    canTakeStance(c, stance) {
      const b = ensure(c);
      if (stance === b.stance) return true;
      const s = shapeFor(stance);
      const p = { x: c.pos.x, y: c.pos.y + centreY(stance) + 0.03, z: c.pos.z };
      const hit = world.intersectionWithShape(p, tmpRot, new RAPIER.Capsule(s.half, s.r * 0.95), undefined, undefined, b.collider);
      return hit === null;
    },
    moveCharacter(c, disp) {
      const b = ensure(c);
      if (c.health.state === 'dead') {
        b.collider.setEnabled(false);
        disabled.add(b.collider.handle);
        return { pos: c.pos, grounded: true };
      }
      setStance(b, c.health.state === 'downed' ? 'downed' : c.move.stance, c.pos);
      // Small downward probe keeps ground contact detection stable when standing still.
      const d = { x: disp.x, y: c.move.grounded && disp.y <= 0 ? disp.y - 0.02 : disp.y, z: disp.z };
      kcc.computeColliderMovement(b.collider, d, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined,
        (other) => !disabled.has(other.handle));
      const m = kcc.computedMovement();
      const t = b.collider.translation();
      const nt = { x: t.x + m.x, y: t.y + m.y, z: t.z + m.z };
      b.collider.setTranslation(nt);
      return { pos: v3(nt.x, nt.y - centreY(b.stance), nt.z), grounded: kcc.computedGrounded() };
    },
    step() { world.step(); },
    dispose() { kcc.free(); world.free(); bodies.clear(); disabled.clear(); },
  };
}
