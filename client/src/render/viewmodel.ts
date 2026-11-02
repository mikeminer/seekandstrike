import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Combatant } from '@shared/sim/combatant';
import { Spring } from '@shared/spring';
import { type CharacterModels, findMesh, splitByCentroid } from './models';
import { clothMaterial } from './soldier';

/**
 * First-person rifle viewmodel (Stage 2): the bundled CC0 rifle mesh (see ASSETS_LICENSES.md;
 * AI-generated source — rights-review caveat applies). At load the mesh is split by triangle
 * region into body / magazine / optic: the magazine animates on reload, and the solid optic
 * is replaced by an open red-dot tube so ADS looks THROUGH it (dot on the screen centre).
 * Rendered in its own scene/camera pass after clearing depth so it never clips into walls.
 * Animates: sway, bob, ADS, recoil kick (+ muzzle climb), reload (tilt, mag out, new mag in,
 * charging-handle pull when empty), sprint low-ready. Gloves/sleeves are procedural.
 */
const S = 0.42; // R space → metres
/** Wider hip FOV keeps the firing hand and forearm in frame; ADS keeps the old 42° magnification. */
const HIP_FOV = 64;
const ADS_FOV = 42;
/** Muzzle-down tilt at the hip (rad): raises the rear of the rifle into view. */
const HIP_PITCH = -0.1;
/** Optic centre in R space (measured on the mesh); placed at gun-space (0, 0.07, -0.04). */
const OPTIC_R = new THREE.Vector3(0.15, 0.295, 0);
const OPTIC_GUN = new THREE.Vector3(0, 0.07, -0.04);
const MAG_PIVOT_R = new THREE.Vector3(0.02, 0.0, 0);
/** R-space triangle centroids ahead of the optic and above the rail: they block the view through the red dot. */
export const SIGHT_LINE_BLOCKER = (c: { x: number; y: number; z: number }): boolean => c.x < -0.05 && c.y > 0.245 && Math.abs(c.z) < 0.08;

const v3 = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Capsule between two points. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r: number): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(0.001, dir.length() - 2 * r * 0.6);
  const g = new THREE.CapsuleGeometry(r, len, 3, 8);
  g.deleteAttribute('uv');
  const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(Y_AXIS, dir.normalize()), new THREE.Vector3(1, 1, 1));
  return g.applyMatrix4(m);
}
/** A finger/thumb: capsules along a polyline of joints, thinning towards the tip. */
function finger(pts: THREE.Vector3[], r: number): THREE.BufferGeometry {
  return mergeGeometries(pts.slice(1).map((p, i) => limb(pts[i]!, p, r * (1 - i * 0.12))))!;
}
/** Points on an arc: angles in degrees, `to3` maps the 2D arc point to 3D. */
function arc(cx: number, cy: number, radius: number, a0: number, a1: number, segs: number, to3: (x: number, y: number) => THREE.Vector3): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  for (let i = 0; i <= segs; i++) {
    const a = THREE.MathUtils.degToRad(a0 + ((a1 - a0) * i) / segs);
    out.push(to3(cx + radius * Math.cos(a), cy + radius * Math.sin(a)));
  }
  return out;
}
/** Flattened rounded palm (a scaled sphere), optional tilt about X. */
function palm(x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(0.5, 14, 10);
  g.deleteAttribute('uv');
  return g.applyMatrix4(new THREE.Matrix4().compose(v3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, 0, 0)), v3(sx, sy, sz)));
}
function glovedHand(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const g = mergeGeometries(parts)!;
  g.computeVertexNormals();
  return g;
}

export class Viewmodel {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private rig = new THREE.Group();
  private gun = new THREE.Group();
  private rifleR = new THREE.Group();
  private mag = new THREE.Group();
  private newMag = new THREE.Group();
  private leftHand = new THREE.Group();
  private flash: THREE.Sprite;
  private owned: { dispose(): void }[] = [];
  private bob = 0;
  // Spring-damper recoil (back-kick, muzzle pitch, yaw jitter) and look lag; see shared/src/spring.ts.
  private recZ = new Spring(9, 0.42);
  private recPitch = new Spring(9, 0.42);
  private recYaw = new Spring(7, 0.5);
  private lagX = new Spring(5.4, 0.46);
  private lagY = new Spring(5.4, 0.46);
  private climb = 0;
  private lastShots = 0;
  private lookX = 0;
  private lookY = 0;
  private swayX = 0;
  private swayY = 0;
  private wasEmpty = false;
  private leftHome = new THREE.Vector3();
  /** Diagnostics (debug overlay): largest per-frame rig motion over the last ~0.5 s. */
  readonly diag = { posMm: 0, rotMrad: 0, ads: 0 };
  private prevPos = new THREE.Vector3();
  private prevRot = new THREE.Euler();
  private diagAge = 0;

  constructor(aspect: number, env: THREE.Texture, models: CharacterModels, flashTex: THREE.Texture) {
    this.camera = new THREE.PerspectiveCamera(HIP_FOV, aspect, 0.03, 5);
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.9;
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.2);
    sun.position.set(0.55, 0.74, 0.37);
    this.scene.add(sun, new THREE.HemisphereLight(0xbcd0e0, 0x4a4438, 0.5));
    this.scene.add(this.camera);
    this.camera.add(this.rig);
    this.rig.add(this.gun);
    const t = <T extends { dispose(): void }>(x: T): T => { this.owned.push(x); return x; };

    // R space → gun space: barrel (R -X) to -Z, scale to ~0.8 m, optic centre to OPTIC_GUN.
    this.rifleR.rotation.y = -Math.PI / 2;
    this.rifleR.scale.setScalar(S);
    const rOptic = OPTIC_R.clone().multiplyScalar(S).applyAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
    this.rifleR.position.copy(OPTIC_GUN).sub(rOptic);
    this.gun.add(this.rifleR);

    const src = findMesh(models.rifle, 'Rifle');
    const [optic, mag, irons, body] = splitByCentroid(src, [
      (c) => c.x > 0.02 && c.x < 0.29 && c.y > 0.205 && Math.abs(c.z) < 0.12,
      (c) => c.x > -0.11 && c.x < 0.14 && c.y < -0.005,
      // Iron sights ahead of the optic (front post at x≈-0.6, sight block at x≈-0.3) stood in the red-dot sight line
      // (y 0.25-0.34, seen on the Seeker as a grey drum filling the sight). Removed: "folded" backup irons.
      SIGHT_LINE_BLOCKER,
    ]);
    optic!.dispose();
    irons!.dispose();
    const part = (g: THREE.BufferGeometry, parent: THREE.Object3D, pre?: THREE.Matrix4): THREE.Mesh => {
      const m = new THREE.Mesh(t(g), src.material);
      m.matrixAutoUpdate = false;
      m.matrix.copy(src.matrixWorld);
      if (pre) m.matrix.premultiply(pre);
      parent.add(m);
      return m;
    };
    part(body!, this.rifleR);
    const unpivot = new THREE.Matrix4().makeTranslation(-MAG_PIVOT_R.x, -MAG_PIVOT_R.y, -MAG_PIVOT_R.z);
    this.mag.position.copy(MAG_PIVOT_R); this.rifleR.add(this.mag);
    part(mag!, this.mag, unpivot);
    this.newMag.position.copy(MAG_PIVOT_R); this.rifleR.add(this.newMag);
    part(mag!.clone(), this.newMag, unpivot);
    this.newMag.visible = false;

    // Open red-dot optic (R-space units) replacing the solid one.
    const metal = t(new THREE.MeshStandardMaterial({ color: 0x1f2124, roughness: 0.42, metalness: 0.75, side: THREE.DoubleSide }));
    const glass = t(new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.3 }));
    const dot = t(new THREE.MeshBasicMaterial({ color: 0xff3020 }));
    const tubeR = 0.019 / S, tubeL = 0.05 / S;
    const tube = new THREE.Mesh(t(new THREE.CylinderGeometry(tubeR, tubeR, tubeL, 24, 1, true).rotateZ(Math.PI / 2)), metal);
    tube.position.copy(OPTIC_R); this.rifleR.add(tube);
    const hood = new THREE.Mesh(t(new THREE.CylinderGeometry(tubeR * 1.12, tubeR * 1.12, tubeL * 0.25, 24, 1, true).rotateZ(Math.PI / 2)), metal);
    hood.position.copy(OPTIC_R).add(new THREE.Vector3(-tubeL * 0.55, 0, 0)); this.rifleR.add(hood);
    const mount = new THREE.Mesh(t(new THREE.BoxGeometry(0.1, OPTIC_R.y - 0.2 - tubeR + 0.01, 0.05)), metal);
    mount.position.set(OPTIC_R.x, (0.2 + OPTIC_R.y - tubeR) / 2, 0); this.rifleR.add(mount);
    const knob = new THREE.Mesh(t(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 12)), metal);
    knob.position.set(OPTIC_R.x, OPTIC_R.y + tubeR + 0.012, 0); this.rifleR.add(knob);
    const lens = new THREE.Mesh(t(new THREE.CircleGeometry(tubeR * 0.97, 24).rotateY(Math.PI / 2)), glass);
    lens.position.copy(OPTIC_R).add(new THREE.Vector3(-tubeL * 0.48, 0, 0)); this.rifleR.add(lens);
    const d = new THREE.Mesh(t(new THREE.CircleGeometry(0.0011 / S, 10).rotateY(Math.PI / 2)), dot);
    d.position.copy(OPTIC_R).add(new THREE.Vector3(-tubeL * 0.46, 0, 0)); this.rifleR.add(d);

    // Gloves + camo sleeves (gun space, metres).
    // Dark tactical gloves (a skin-tone glove read as bare hands next to the camo sleeves).
    const glove = t(new THREE.MeshStandardMaterial({ color: 0x33342b, roughness: 0.82, metalness: 0.05 }));
    const sleeve = t(clothMaterial(0, 3));
    const cap = (r: number, l: number): THREE.BufferGeometry => { const g = new THREE.CapsuleGeometry(r, l, 4, 10); g.deleteAttribute('uv'); return g; };
    const place = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0): THREE.BufferGeometry =>
      g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
    const H = Math.PI / 2;
    // Left hand cupping the handguard from below: palm underneath, four fingers (3 segments each)
    // wrapping round the right side, thumb along the left/top side. Origin = hand home position.
    const lhGeo = glovedHand([
      palm(0.0, -0.012, 0.0, 0.074, 0.03, 0.09),
      ...[0, 1, 2, 3].map((f) => finger(arc(0.004, 0.02, 0.034 - f * 0.0015, -105, 25 - f * 4, 3, (x, y) => v3(x, y, -0.036 + f * 0.024)), 0.0098 - f * 0.0007)),
      finger([v3(-0.036, 0.0, -0.01), v3(-0.04, 0.022, -0.035), v3(-0.03, 0.044, -0.06)], 0.0108),
    ]);
    this.leftHand.add(new THREE.Mesh(t(lhGeo), glove));
    const la = new THREE.Mesh(t(place(new THREE.CylinderGeometry(0.036, 0.045, 0.36, 14).translate(0, -0.18, 0), 0, -0.04, 0.03, -1.15, 0, -0.5)), sleeve);
    this.leftHand.add(la);
    this.leftHome.set(-0.005, -0.03, -0.28);
    this.leftHand.position.copy(this.leftHome);
    this.gun.add(this.leftHand);
    // Right hand on the pistol grip: palm behind it, middle/ring/pinky wrapped round the front,
    // index finger straight along the trigger guard, thumb across the left side.
    const gc = { x: 0.0, z: 0.05 }; // grip axis in gun space (x, z)
    const rhGeo = glovedHand([
      palm(0.012, -0.09, 0.085, 0.034, 0.075, 0.05, 0.35),
      ...[0, 1, 2].map((f) => finger(arc(gc.x, gc.z, 0.026, 25, -150, 3, (x, z) => v3(x, -0.082 - f * 0.021, z)), 0.0098 - f * 0.0006)),
      finger([v3(0.012, -0.06, 0.06), v3(0.0, -0.06, 0.02), v3(-0.012, -0.058, -0.012)], 0.0095),
      finger([v3(0.022, -0.062, 0.085), v3(0.0, -0.058, 0.07), v3(-0.026, -0.06, 0.05)], 0.0108),
    ]);
    this.gun.add(new THREE.Mesh(t(rhGeo), glove));
    const ra = new THREE.Mesh(t(place(new THREE.CylinderGeometry(0.04, 0.05, 0.36, 14).translate(0, -0.18, 0), 0.02, -0.13, 0.1, -1.0, 0, 0.45)), sleeve);
    this.gun.add(ra);

    this.flash = new THREE.Sprite(t(new THREE.SpriteMaterial({ map: flashTex, color: 0xffd29a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
    this.flash.position.set(0, 0, 0);
    const muzzle = new THREE.Vector3(-0.99, 0.124, 0);
    this.rifleR.add(this.flash);
    this.flash.position.copy(muzzle);
    this.flash.scale.setScalar(0.12 / S);
  }

  /** Diagnostics: current rig pose (camera space). */
  rigPose(): { x: number; y: number; rx: number; ry: number } { return { x: this.rig.position.x, y: this.rig.position.y, rx: this.rig.rotation.x, ry: this.rig.rotation.y }; }

  setAspect(a: number): void { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  update(c: Combatant, dt: number, lookDX: number, lookDY: number): void {
    const w = c.weapon;
    const ads = w.ads;
    // Look lag: the gun trails camera rotation on a spring, overshoots and settles.
    // Touch look arrives in bursts (zero on most frames, a spike on others): smooth it, and while aiming keep the gun
    // steady so it does not shimmer around the sight picture.
    const smooth = 1 - Math.exp(-dt * 25);
    this.lookX += (lookDX - this.lookX) * smooth;
    this.lookY += (lookDY - this.lookY) * smooth;
    // Fully aimed: no look sway at all, so the red dot stays on the screen centre where the shots go.
    const steady = 1 - ads;
    this.swayX = this.lagX.step(dt, Math.max(-1.5, Math.min(1.5, -this.lookX * 0.6))) * steady;
    this.swayY = this.lagY.step(dt, Math.max(-1.5, Math.min(1.5, this.lookY * 0.6))) * steady;
    this.bob += dt * c.speed * 2.1;
    const bobAmp = (c.move.grounded ? 1 : 0) * Math.min(1, c.speed / 4) * (1 - ads);
    if (w.shotsFired !== this.lastShots) {
      const k = 1 - ads * 0.5;
      this.recZ.kick(1.1 * k);
      this.recPitch.kick(1.6 * k);
      this.recYaw.kick((Math.random() - 0.5) * 0.8 * k);
      this.climb = Math.min(1, this.climb + 0.35);
      this.lastShots = w.shotsFired;
    }
    const kickZ = this.recZ.step(dt, 0);
    const kickPitch = this.recPitch.step(dt, 0);
    const kickYaw = this.recYaw.step(dt, 0);
    this.climb = Math.max(0, this.climb - dt * 3);
    // Hip pose: raised a little so the firing hand on the grip stays in frame.
    const hip = new THREE.Vector3(0.1, -0.115, -0.27);
    const aim = new THREE.Vector3(0, -0.07, -0.27);
    const p = hip.lerp(aim, ads);

    // Reload timeline (t: 0..1).
    let tilt = 0, dip = 0, magOut = 0, magIn = 1, handT = 0, charge = 0;
    const reloading = w.phase === 'reloading';
    if (reloading) {
      const t = 1 - w.reloadTimer / w.reloadTotal;
      if (t < 0.03) this.wasEmpty = !w.chambered;
      const ss = (a: number, b: number): number => THREE.MathUtils.smoothstep(t, a, b);
      tilt = ss(0, 0.15) * (1 - ss(0.8, 1));
      dip = tilt;
      magOut = ss(0.12, 0.3);
      magIn = ss(0.42, 0.62);
      handT = ss(0.1, 0.22) * (1 - ss(0.64, 0.78));
      charge = this.wasEmpty ? Math.sin(Math.PI * ss(0.72, 0.86)) : 0;
    }
    this.mag.visible = !reloading || magOut < 0.98;
    this.mag.position.set(MAG_PIVOT_R.x - magOut * 0.15, MAG_PIVOT_R.y - magOut * 0.75, MAG_PIVOT_R.z);
    this.mag.rotation.z = magOut * 0.5;
    this.newMag.visible = reloading && magOut >= 0.98;
    this.newMag.position.set(MAG_PIVOT_R.x - (1 - magIn) * 0.1, MAG_PIVOT_R.y - (1 - magIn) * 0.6 + Math.sin(magIn * Math.PI) * 0.0, MAG_PIVOT_R.z + (1 - magIn) * 0.15);
    this.newMag.rotation.z = (1 - magIn) * 0.35;
    // Left hand travels to the magazine well and back.
    const magWell = new THREE.Vector3(0.005, -0.12 - (reloading && magIn < 1 && magOut >= 0.98 ? (1 - magIn) * 0.2 : 0), -0.095);
    this.leftHand.position.lerpVectors(this.leftHome, magWell, handT);
    this.leftHand.rotation.x = handT * 0.4;

    const sprint = c.move.sprinting ? 1 : 0;
    this.rig.position.set(
      p.x + Math.sin(this.bob) * 0.012 * bobAmp + this.swayX * 0.02 - tilt * 0.08,
      p.y + Math.abs(Math.cos(this.bob)) * 0.01 * bobAmp + dip * 0.05 - sprint * 0.03 + this.swayY * 0.02,
      p.z + kickZ * 0.035 + charge * 0.025 - tilt * 0.08,
    );
    this.rig.rotation.set(
      kickPitch * 0.05 + this.climb * 0.03 + tilt * 0.1 + sprint * -0.35,
      sprint * 0.6 + this.swayX * 0.05 + kickYaw * 0.03 * (1 - ads * 0.9) + tilt * 0.55,
      tilt * 0.5 + sprint * 0.3,
    );
    this.rig.rotation.x += HIP_PITCH * (1 - ads);
    const dPos = this.rig.position.distanceTo(this.prevPos) * 1000;
    const dRot = Math.max(Math.abs(this.rig.rotation.x - this.prevRot.x), Math.abs(this.rig.rotation.y - this.prevRot.y), Math.abs(this.rig.rotation.z - this.prevRot.z)) * 1000;
    this.diagAge += dt;
    if (this.diagAge > 0.5) { this.diagAge = 0; this.diag.posMm = 0; this.diag.rotMrad = 0; }
    this.diag.posMm = Math.max(this.diag.posMm, dPos);
    this.diag.rotMrad = Math.max(this.diag.rotMrad, dRot);
    this.diag.ads = ads;
    this.prevPos.copy(this.rig.position); this.prevRot.copy(this.rig.rotation);
    this.camera.fov = THREE.MathUtils.lerp(HIP_FOV, ADS_FOV, ads);
    this.camera.updateProjectionMatrix();
    const flashing = c.sinceShot < 0.04;
    this.flash.visible = flashing;
    if (flashing) { this.flash.material.rotation = Math.random() * Math.PI * 2; this.flash.scale.setScalar((0.09 + Math.random() * 0.06) / S); }
    this.rig.visible = c.health.state === 'alive';
  }

  dispose(): void { for (const o of this.owned) o.dispose(); }
}
