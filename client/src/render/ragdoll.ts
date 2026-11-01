import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import type { MapDef } from '@shared/map/types';

/**
 * Cosmetic death ragdolls in a SEPARATE Rapier world (static map boxes + ground only), so they
 * never affect gameplay collision or the deterministic sim. 11 capsule bodies per soldier joined
 * by spherical joints (damped), no self-collision. At most MAX_ACTIVE simulate at once; the
 * oldest is frozen (bodies removed, pose kept) when a new one spawns or after ACTIVE_SECONDS.
 */
const MAX_ACTIVE = 4;
const ACTIVE_SECONDS = 4;
const STEP = 1 / 60;

interface Seg { bone: string; to: string | null; len?: number; r: number; parent: string | null }
const SEGS: readonly Seg[] = [
  { bone: 'pelvis', to: 'spine_02', r: 0.14, parent: null },
  { bone: 'spine_02', to: 'neck_01', r: 0.15, parent: 'pelvis' },
  { bone: 'Head', to: null, len: 0.2, r: 0.1, parent: 'spine_02' },
  { bone: 'upperarm_l', to: 'lowerarm_l', r: 0.055, parent: 'spine_02' },
  { bone: 'upperarm_r', to: 'lowerarm_r', r: 0.055, parent: 'spine_02' },
  { bone: 'lowerarm_l', to: 'hand_l', r: 0.045, parent: 'upperarm_l' },
  { bone: 'lowerarm_r', to: 'hand_r', r: 0.045, parent: 'upperarm_r' },
  { bone: 'thigh_l', to: 'calf_l', r: 0.08, parent: 'pelvis' },
  { bone: 'thigh_r', to: 'calf_r', r: 0.08, parent: 'pelvis' },
  { bone: 'calf_l', to: 'foot_l', r: 0.06, parent: 'thigh_l' },
  { bone: 'calf_r', to: 'foot_r', r: 0.06, parent: 'thigh_r' },
];

export interface Ragdollable { root: THREE.Object3D; boneMap(): Map<string, THREE.Bone> }

interface Doll { owner: Ragdollable; bodies: { bone: THREE.Bone; rb: RAPIER.RigidBody }[]; joints: RAPIER.ImpulseJoint[]; age: number }

const GROUP_STATIC = (0x0001 << 16) | 0x0002;
const GROUP_PART = (0x0002 << 16) | 0x0001;
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _w = new THREE.Vector3();

export class RagdollSystem {
  private world: RAPIER.World;
  private dolls: Doll[] = [];
  private acc = 0;

  /** RAPIER.init() must have resolved (createPhysicsWorld does it). */
  constructor(map: MapDef) {
    this.world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = STEP;
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(80, 0.5, 80).setTranslation(0, -0.5, 0).setCollisionGroups(GROUP_STATIC).setFriction(0.9));
    for (const b of map.boxes) {
      this.world.createCollider(RAPIER.ColliderDesc.cuboid(b.s.x / 2, b.s.y / 2, b.s.z / 2).setTranslation(b.c.x, b.c.y, b.c.z).setCollisionGroups(GROUP_STATIC).setFriction(0.8));
    }
  }

  get active(): number { return this.dolls.length; }

  /** Builds a ragdoll from the owner's current pose. `push` = initial velocity (m/s) for the torso. */
  spawn(owner: Ragdollable, push: THREE.Vector3): boolean {
    this.release(owner);
    while (this.dolls.length >= MAX_ACTIVE) this.freeze(this.dolls[0]!);
    owner.root.updateMatrixWorld(true);
    const bones = owner.boneMap();
    const made = new Map<string, RAPIER.RigidBody>();
    const doll: Doll = { owner, bodies: [], joints: [], age: 0 };
    for (const s of SEGS) {
      const bone = bones.get(s.bone);
      if (!bone) return false;
      bone.matrixWorld.decompose(_p, _q, _s);
      const rb = this.world.createRigidBody(RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(_p.x, _p.y, _p.z).setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w })
        .setLinearDamping(0.4).setAngularDamping(2.5));
      // Segment vector in the bone's local (unscaled) frame.
      const inv = new THREE.Matrix4().compose(_p, _q, new THREE.Vector3(1, 1, 1)).invert();
      const seg = s.to ? bones.get(s.to)!.getWorldPosition(_w).applyMatrix4(inv) : new THREE.Vector3(0, s.len ?? 0.2, 0);
      const len = Math.max(seg.length(), 0.05);
      const half = Math.max(0.01, len / 2 - s.r);
      const rot = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), seg.clone().normalize());
      const mid = seg.clone().multiplyScalar(0.5);
      this.world.createCollider(RAPIER.ColliderDesc.capsule(half, s.r).setTranslation(mid.x, mid.y, mid.z)
        .setRotation({ x: rot.x, y: rot.y, z: rot.z, w: rot.w }).setCollisionGroups(GROUP_PART).setDensity(s.bone === 'pelvis' || s.bone === 'spine_02' ? 1.6 : 1).setFriction(0.9), rb);
      const k = s.bone === 'spine_02' || s.bone === 'Head' ? 1 : s.bone === 'pelvis' ? 0.7 : 0.45;
      rb.setLinvel({ x: push.x * k, y: push.y * k + 0.4 * k, z: push.z * k }, true);
      if (s.parent) {
        const pb = made.get(s.parent)!;
        const pt = pb.translation(), pq = pb.rotation();
        const a1 = _p.clone().sub(new THREE.Vector3(pt.x, pt.y, pt.z)).applyQuaternion(new THREE.Quaternion(pq.x, pq.y, pq.z, pq.w).invert());
        const j = this.world.createImpulseJoint(RAPIER.JointData.spherical({ x: a1.x, y: a1.y, z: a1.z }, { x: 0, y: 0, z: 0 }), pb, rb, true);
        doll.joints.push(j);
      }
      made.set(s.bone, rb);
      doll.bodies.push({ bone, rb });
    }
    this.dolls.push(doll);
    return true;
  }

  /** Removes the owner's ragdoll bodies (pose stays as last synced). */
  release(owner: Ragdollable): void {
    const d = this.dolls.find((x) => x.owner === owner);
    if (d) this.freeze(d);
  }

  private freeze(d: Doll): void {
    for (const b of d.bodies) this.world.removeRigidBody(b.rb);
    d.bodies = []; d.joints = [];
    this.dolls = this.dolls.filter((x) => x !== d);
  }

  update(dt: number): void {
    if (this.dolls.length === 0) { this.acc = 0; return; }
    this.acc = Math.min(this.acc + dt, STEP * 3);
    while (this.acc >= STEP) { this.world.step(); this.acc -= STEP; }
    for (const d of [...this.dolls]) {
      d.age += dt;
      // Sync bones parent-first (SEGS order): local = parentWorld⁻¹ · bodyWorld (keeping scale).
      for (const { bone, rb } of d.bodies) {
        const t = rb.translation(), r = rb.rotation();
        bone.matrixWorld.decompose(_p, _q, _s);
        _m.compose(_p.set(t.x, t.y, t.z), _q.set(r.x, r.y, r.z, r.w), _s);
        _m.premultiply(new THREE.Matrix4().copy(bone.parent!.matrixWorld).invert());
        _m.decompose(bone.position, bone.quaternion, bone.scale);
        bone.updateMatrixWorld(true);
      }
      if (d.age > ACTIVE_SECONDS) this.freeze(d);
    }
  }

  dispose(): void { this.dolls = []; this.world.free(); }
}
