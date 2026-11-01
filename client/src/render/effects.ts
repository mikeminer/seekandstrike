import * as THREE from 'three';
import type { Projectile, SurfaceMaterial } from '@shared/sim/ballistics';
import type { Vec3 } from '@shared/sim/vec';

/** Procedural radial flash/spark texture (generated at runtime; no external asset). */
export function makeFlashTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,240,1)');
  grad.addColorStop(0.25, 'rgba(255,200,120,0.85)');
  grad.addColorStop(1, 'rgba(255,120,40,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  g.globalCompositeOperation = 'lighter';
  g.strokeStyle = 'rgba(255,220,160,0.7)';
  g.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.3;
    g.beginPath(); g.moveTo(32, 32); g.lineTo(32 + Math.cos(a) * 31, 32 + Math.sin(a) * 31); g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeSmokeTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const DUST: Record<SurfaceMaterial, number> = {
  concrete: 0xb9b4aa, asphalt: 0x6d6a66, metal: 0xffc27a, sheetMetal: 0xffc27a, wood: 0x9a7b55, flesh: 0x7a6a60, glass: 0xdde8f0,
};

interface Puff { s: THREE.Sprite; v: THREE.Vector3; life: number; max: number; grow: number; }

/**
 * Pooled visual effects: tracer streaks (one per live projectile, every round shows a faint
 * streak, tracer rounds glow), impact dust/sparks and bullet-hole decals.
 * Low gore: flesh hits show a small grey dust puff only.
 */
export class Effects {
  readonly group = new THREE.Group();
  private tracerGeo = new THREE.BufferGeometry();
  private tracerPos: Float32Array;
  private tracerCol: Float32Array;
  private tracerLines: THREE.LineSegments;
  private puffs: Puff[] = [];
  private puffIdx = 0;
  private decals: THREE.Mesh[] = [];
  private decalIdx = 0;
  private owned: { dispose(): void }[] = [];
  readonly flashTexture: THREE.CanvasTexture;
  private blast: THREE.Sprite;
  private blastLife = 1;
  private static readonly MAX_TRACERS = 128;

  constructor() {
    const t = <T extends { dispose(): void }>(x: T): T => { this.owned.push(x); return x; };
    this.flashTexture = t(makeFlashTexture());
    this.tracerPos = new Float32Array(Effects.MAX_TRACERS * 6);
    this.tracerCol = new Float32Array(Effects.MAX_TRACERS * 6);
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.tracerGeo.setAttribute('color', new THREE.BufferAttribute(this.tracerCol, 3).setUsage(THREE.DynamicDrawUsage));
    t(this.tracerGeo);
    this.tracerLines = new THREE.LineSegments(this.tracerGeo, t(new THREE.LineBasicMaterial({
      vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
    })));
    this.tracerLines.frustumCulled = false;
    this.group.add(this.tracerLines);

    this.blast = new THREE.Sprite(t(new THREE.SpriteMaterial({ map: this.flashTexture, color: 0xffc070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
    this.blast.visible = false;
    this.group.add(this.blast);

    const smoke = t(makeSmokeTexture());
    for (let i = 0; i < 48; i++) {
      const s = new THREE.Sprite(t(new THREE.SpriteMaterial({ map: smoke, transparent: true, depthWrite: false, color: 0xffffff })));
      s.visible = false;
      this.group.add(s);
      this.puffs.push({ s, v: new THREE.Vector3(), life: 0, max: 1, grow: 1 });
    }
    const holeGeo = t(new THREE.CircleGeometry(0.022, 8));
    const holeMat = t(new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 1, polygonOffset: true, polygonOffsetFactor: -4, transparent: true, opacity: 0.85 }));
    for (let i = 0; i < 64; i++) {
      const m = new THREE.Mesh(holeGeo, holeMat);
      m.visible = false;
      this.group.add(m);
      this.decals.push(m);
    }
  }

  /** Streak from (pos - vel*len) to pos per live projectile. */
  updateTracers(projectiles: readonly Projectile[], alpha: number, dt: number): void {
    let n = 0;
    for (const p of projectiles) {
      if (n >= Effects.MAX_TRACERS || !p.alive) continue;
      const tracer = p.id % 4 === 0; // every 4th round is a tracer
      const len = tracer ? 0.05 : 0.025; // seconds of travel shown
      const ex = p.pos.x + p.vel.x * dt * alpha, ey = p.pos.y + p.vel.y * dt * alpha, ez = p.pos.z + p.vel.z * dt * alpha;
      const o = n * 6;
      this.tracerPos[o] = ex - p.vel.x * len; this.tracerPos[o + 1] = ey - p.vel.y * len; this.tracerPos[o + 2] = ez - p.vel.z * len;
      this.tracerPos[o + 3] = ex; this.tracerPos[o + 4] = ey; this.tracerPos[o + 5] = ez;
      const [r, g, b] = tracer ? [1.0, 0.55, 0.2] : [0.18, 0.16, 0.13];
      this.tracerCol[o] = r * 0.2; this.tracerCol[o + 1] = g * 0.2; this.tracerCol[o + 2] = b * 0.2;
      this.tracerCol[o + 3] = r; this.tracerCol[o + 4] = g; this.tracerCol[o + 5] = b;
      n++;
    }
    this.tracerGeo.setDrawRange(0, n * 2);
    (this.tracerGeo.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.tracerGeo.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  impact(point: Vec3, normal: Vec3, material: SurfaceMaterial, decal: boolean): void {
    const metal = material === 'metal' || material === 'sheetMetal';
    const count = metal ? 2 : 3;
    for (let i = 0; i < count; i++) {
      const p = this.puffs[this.puffIdx++ % this.puffs.length]!;
      p.s.visible = true;
      p.s.position.set(point.x + normal.x * 0.05, point.y + normal.y * 0.05, point.z + normal.z * 0.05);
      p.v.set(normal.x + (Math.random() - 0.5) * 0.8, normal.y + Math.random() * 0.6, normal.z + (Math.random() - 0.5) * 0.8).multiplyScalar(metal && i === 0 ? 4 : 0.9);
      p.life = 0;
      p.max = metal && i === 0 ? 0.12 : 0.6 + Math.random() * 0.4;
      p.grow = metal && i === 0 ? 0.05 : 0.5;
      const m = p.s.material;
      m.color.setHex(metal && i === 0 ? 0xffd08a : DUST[material]);
      m.blending = metal && i === 0 ? THREE.AdditiveBlending : THREE.NormalBlending;
      p.s.scale.setScalar(metal && i === 0 ? 0.12 : 0.12);
    }
    if (decal && material !== 'flesh') {
      const d = this.decals[this.decalIdx++ % this.decals.length]!;
      d.visible = true;
      d.position.set(point.x + normal.x * 0.004, point.y + normal.y * 0.004, point.z + normal.z * 0.004);
      d.lookAt(point.x + normal.x, point.y + normal.y, point.z + normal.z);
    }
  }

  /** Grenade blast: a short bright flash plus a ring of heavy smoke and dust. */
  explosion(point: Vec3): void {
    this.blast.visible = true;
    this.blast.position.set(point.x, point.y + 0.4, point.z);
    this.blastLife = 0;
    for (let i = 0; i < 12; i++) {
      const p = this.puffs[this.puffIdx++ % this.puffs.length]!;
      const a = (i / 12) * Math.PI * 2 + Math.random();
      p.s.visible = true;
      p.s.position.set(point.x + Math.cos(a) * 0.3, point.y + 0.3 + Math.random() * 0.4, point.z + Math.sin(a) * 0.3);
      p.v.set(Math.cos(a) * (1.5 + Math.random() * 2.5), 0.6 + Math.random() * 2, Math.sin(a) * (1.5 + Math.random() * 2.5));
      p.life = 0; p.max = 1.1 + Math.random() * 0.8; p.grow = 1.8 + Math.random() * 1.4;
      p.s.material.color.setHex(i % 3 === 0 ? 0x2c2a26 : 0x6b665c);
      p.s.material.blending = THREE.NormalBlending;
      p.s.scale.setScalar(0.4);
    }
  }

  update(dt: number): void {
    if (this.blast.visible) {
      this.blastLife += dt;
      const k = this.blastLife / 0.16;
      if (k >= 1) this.blast.visible = false;
      else { this.blast.scale.setScalar(2.5 + k * 5); this.blast.material.opacity = 1 - k; }
    }
    for (const p of this.puffs) {
      if (!p.s.visible) continue;
      p.life += dt;
      if (p.life >= p.max) { p.s.visible = false; continue; }
      const k = p.life / p.max;
      p.s.position.addScaledVector(p.v, dt);
      p.v.multiplyScalar(Math.max(0, 1 - dt * 3));
      p.v.y -= dt * 0.3;
      p.s.scale.setScalar(0.12 + k * p.grow);
      p.s.material.opacity = (1 - k) * 0.75;
    }
  }

  dispose(): void { for (const o of this.owned) o.dispose(); }
}
