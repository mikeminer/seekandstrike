import * as THREE from 'three';
import { FixedStepper } from '@shared/fixedStep';
import { CLIENT_SIM_HZ } from '@shared/constants';
import { Match, type SimEvent } from '@shared/sim/match';
import { PORTO_ARDESIA } from '@shared/map/portoArdesia';
import { OBJECTIVE } from '@shared/sim/objective';
import { classStats, REVIVE_RADIUS } from '@shared/sim/classStats';
import { eyeHeight } from '@shared/sim/combatant';
import { clamp, distXZ, type Vec3 } from '@shared/sim/vec';
import { createPhysicsWorld, type PhysicsWorld } from '../physics/world';
import { setRendererPixelRatio } from '../render/renderer';
import { AssetStore } from '../render/assets';
import { buildArchitectureMapView, buildMapView, buildMapViewFromGlb, buildObjectiveProp } from '../render/mapView';
import { DEFAULT_MAP, MAPS, loadGroundAo, loadPipelineMap, type MapId } from './mapLoader';
import { OcclusionField, aabbsFromSimBoxes } from '@shared/light/skyOcclusion';
import { createSkyDome, environmentFromSky, hazeColor, lateAfternoonSky, sunDirection } from '../render/environment/sky';
import { createSea } from '../render/environment/sea';
import { createHills } from '../render/environment/hills';
import { buildVegetation } from '../render/vegetation/vegetation';
import type { MapDef } from '@shared/map/types';
import type { PlayerClass } from '@shared/sim/etClasses';
import { OnlineSession, type SessionOptions } from '../online/session';
import RAPIER from '@dimforge/rapier3d-compat';
import { type CharacterModels, disposeGltf, loadCharacterModels } from '../render/models';
import { RagdollSystem } from '../render/ragdoll';
import { SoldierFactory, type SoldierView } from '../render/soldier';
import { Viewmodel } from '../render/viewmodel';
import { Effects } from '../render/effects';
import { InputManager, LOOK } from '../input/input';
import { TouchControls } from '../input/touch';
import { Hud } from '../ui/hud';
import { t } from '../ui/i18n';
import { Sfx } from '../audio/sfx';
import { DEFAULT_QUALITY_TIERS, createQualityGovernor, observeFrame, type GovernorState } from '../perf/quality-governor.mjs';

/** Sun direction measured from the bundled HDRI's brightest texel (elevation ~48°). */
const SUN_DIR = new THREE.Vector3(0.555, 0.743, 0.374).normalize();

export interface GameOptions { seed: number; attackers: number; defenders: number; touch: boolean; debug: boolean; playerClass?: PlayerClass; mapId?: MapId; }

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(75, 1, 0.05, 600);
  private assets: AssetStore;
  private physics!: PhysicsWorld;
  match!: Match;
  private map: MapDef = PORTO_ARDESIA;
  private stepper = new FixedStepper({ stepSeconds: 1 / CLIENT_SIM_HZ, maxStepsPerFrame: 5, maxFrameSeconds: 0.25 });
  private factory!: SoldierFactory;
  private models: CharacterModels | null = null;
  private ragdolls: RagdollSystem | null = null;
  private soldiers = new Map<number, SoldierView>();
  private prevPos = new Map<number, Vec3>();
  private viewmodel!: Viewmodel;
  private effects = new Effects();
  private input: InputManager;
  private touch: TouchControls | null = null;
  private hud: Hud;
  readonly sfx = new Sfx();
  private sun = new THREE.DirectionalLight(0xfff0d8, 3.2);
  /** Towards the sun; the map's authored environment may override the default. */
  private sunDir = SUN_DIR.clone();
  /** Per-frame hooks of the map environment (sky dome follows the camera, sea waves advance). */
  private envFrame: ((seconds: number) => void) | null = null;
  private objective!: ReturnType<typeof buildObjectiveProp>;
  private governor: GovernorState = createQualityGovernor({ nowMs: performance.now() });
  private tier = 0;
  private fps = 0;
  private lastMs = performance.now();
  private running = false;
  private eyeY = 1.63;
  private flashUntil = new Map<number, number>();
  private endWhy = '';
  private beepT = 0;
  private camShake = 0;
  /** Set while playing on a server: the match is then a mirror of server snapshots, not simulated here. */
  private online: OnlineSession | null = null;
  private grenadeMeshes = new Map<number, THREE.Mesh>();
  private grenadeGeo = new THREE.SphereGeometry(0.05, 10, 8);
  private grenadeMat = new THREE.MeshStandardMaterial({ color: 0x2f3a28, roughness: 0.6, metalness: 0.35 });
  private lastLook = { dx: 0, dy: 0 };
  private hostEl: HTMLElement;

  constructor(private renderer: THREE.WebGLRenderer, parent: HTMLElement, private opts: GameOptions) {
    this.hostEl = parent;
    this.assets = new AssetStore(import.meta.env.BASE_URL, Math.min(4, renderer.capabilities.getMaxAnisotropy()));
    this.input = new InputManager(renderer.domElement);
    this.hud = new Hud(parent);
    this.hud.onRestart = () => this.restart();
    if (opts.touch) {
      this.touch = new TouchControls(parent, this.input);
      this.touch.getAdsScale = () => (this.match?.player?.weapon.ads ?? 0) > 0.5 ? LOOK.adsScale : 1;
    }
    const unlock = (): void => this.sfx.unlock();
    parent.addEventListener('pointerdown', unlock, { once: false, passive: true });
    window.addEventListener('keydown', unlock, { passive: true });
  }

  async load(onProgress: (f: number) => void): Promise<void> {
    await this.assets.loadSets((d, n) => onProgress((d / n) * 0.8));
    const { env, background } = await this.assets.loadEnvironment(this.renderer);
    onProgress(0.9);
    this.scene.environment = env;
    this.scene.environmentIntensity = 0.85;
    this.scene.background = background;
    this.scene.backgroundIntensity = 1;
    this.scene.fog = new THREE.Fog(0xb9c4cc, 70, 420);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -32; sc.right = 32; sc.top = 32; sc.bottom = -32; sc.near = 1; sc.far = 140;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    this.scene.add(this.sun, this.sun.target);

    const loaded = await loadPipelineMap(import.meta.env.BASE_URL, this.opts.mapId ?? DEFAULT_MAP);
    this.map = loaded.map;
    if (loaded.glb && MAPS[loaded.id].architecture) {
      // Sky, sea, haze, hills and baked light (DevFridge Game Builder v1.10.0, landscapes-and-architecture).
      const sun = loaded.environment?.sun;
      if (sun) this.sunDir.copy(sunDirection(sun.azimuthDeg, sun.elevationDeg));
      const sky = lateAfternoonSky(this.sunDir);
      this.scene.background = null;
      this.scene.environment = environmentFromSky(this.renderer, sky);
      this.scene.environmentIntensity = 1.35; // shade is lit by the sky only: keep it readable
      this.scene.fog = new THREE.FogExp2(hazeColor(sky), sky.hazeDensity);
      this.sun.color.copy(sky.sunColor);
      this.camera.far = 1500;
      this.camera.updateProjectionMatrix();
      const dome = createSkyDome(sky, 1400);
      const sea = createSea(sky, this.map.waterLevel, 1400);
      this.scene.add(dome, sea.mesh, createHills());
      let vegFrame: ((sec: number, cam: THREE.Vector3) => void) | null = null;
      this.envFrame = (sec) => { dome.position.copy(this.camera.position); sea.update(sec); vegFrame?.(sec, this.camera.position); };
      const t0 = performance.now();
      const field = new OcclusionField(aabbsFromSimBoxes(loaded.simBoxes), { samples: 12, maxDistance: 24 });
      const groundAo = await loadGroundAo(import.meta.env.BASE_URL, loaded.id);
      const view = buildArchitectureMapView(loaded.glb, this.map, loaded.simBoxes, this.assets, {
        occlusion: (x, y, z, nx, ny, nz) => field.visibility(x, y, z, nx, ny, nz), groundAo,
      });
      if (this.opts.debug) console.info('architecture + occlusion ms', Math.round(performance.now() - t0));
      const rect = (b: { c: { x: number; z: number }; s: { x: number; z: number } }) => ({ minX: b.c.x - b.s.x / 2, maxX: b.c.x + b.s.x / 2, minZ: b.c.z - b.s.z / 2, maxZ: b.c.z + b.s.z / 2 });
      const veg = buildVegetation({
        plans: view.plans, bounds: this.map.bounds, seed: 20261101,
        land: (this.map.groundSlabs ?? []).map(rect), solids: this.map.boxes.map(rect),
        markers: [...this.map.spawns[0], ...this.map.spawns[1], this.map.objective],
      });
      this.scene.add(veg.group);
      vegFrame = veg.update;
      if (this.opts.debug) console.info('vegetation', JSON.stringify(veg.stats));
      if (import.meta.env.DEV) (globalThis as { __scene?: THREE.Scene }).__scene = this.scene; // dev inspection only
      this.scene.add(view.group);
      this.hostEl.querySelector<HTMLElement>('.blockout')?.remove(); // finished buildings, not box geometry
      if (this.opts.debug) console.info('architecture triangles', view.triangles);
    } else {
      this.scene.add(loaded.glb ? buildMapViewFromGlb(loaded.glb, this.map, this.assets) : buildMapView(this.map, this.assets));
    }
    this.objective = buildObjectiveProp(this.assets);
    const o = this.map.objective;
    this.objective.root.position.set(o.x, o.y + 0.06 /* console top + half charge height */, o.z);
    this.scene.add(this.objective.root);
    this.scene.add(this.effects.group);
    this.models = await loadCharacterModels(import.meta.env.BASE_URL);
    await RAPIER.init();
    try { this.ragdolls = new RagdollSystem(this.map); } catch { this.ragdolls = null; }
    this.factory = new SoldierFactory(this.models, this.ragdolls);
    this.viewmodel = new Viewmodel(1, env, this.models, this.effects.flashTexture);
    this.scene.add(this.camera);
    await this.newMatch();
    onProgress(1);
    // Compile shaders up-front to avoid first-shot hitches.
    this.renderer.compile(this.scene, this.camera);
    this.renderer.compile(this.viewmodel.scene, this.viewmodel.camera);
  }

  private async newMatch(): Promise<void> {
    this.physics?.dispose();
    this.physics = await createPhysicsWorld(this.map, this.stepper.stepSeconds);
    for (const g of this.grenadeMeshes.values()) g.removeFromParent();
    this.grenadeMeshes.clear();
    this.match = new Match(this.map, { seed: this.opts.seed, attackers: this.opts.attackers, defenders: this.opts.defenders, withPlayer: true, ...(this.opts.playerClass !== undefined ? { playerClass: this.opts.playerClass } : {}) }, this.physics);
    this.ensureSoldierViews();
    const p = this.match.player!;
    this.prevPos.set(p.id, { ...p.pos });
    this.input.stance = 'stand';
    this.input.aimToggle = false;
    this.objective.charge.visible = false;
    this.endWhy = '';
    this.stepper.reset();
  }

  private makeSoldier(team: 0 | 1, id: number, cls: number): SoldierView {
    const v = this.factory.create(team, id, cls);
    v.setFlash(new THREE.Sprite(this.assets.track(new THREE.SpriteMaterial({
      map: this.effects.flashTexture, color: 0xffd29a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }))));
    this.soldiers.set(id, v);
    this.scene.add(v.root);
    return v;
  }

  /** One soldier view per combatant except the local player (views are reused between matches). */
  private ensureSoldierViews(): void {
    for (const c of this.match.combatants) {
      if (c.id === this.match.playerId) {
        const own = this.soldiers.get(c.id);
        if (own) { own.root.removeFromParent(); own.dispose(); this.soldiers.delete(c.id); }
        continue;
      }
      let v = this.soldiers.get(c.id);
      if (!v) {
        v = this.makeSoldier(c.team, c.id, c.cls);
      }
      this.prevPos.set(c.id, { ...c.pos });
    }
  }

  /**
   * Joins an authoritative room: waits for the seat, then swaps the offline match for a snapshot mirror.
   * Rejects with the server code (for example pass_required, room_full) or 'socket'.
   */
  async connectOnline(o: Pick<SessionOptions, 'baseUrl' | 'room' | 'name' | 'wallet' | 'sign'>): Promise<void> {
    const session = await OnlineSession.connect({
      ...o, cls: this.opts.playerClass ?? 0, map: this.map,
      onState: (st) => { if (st === 'reconnecting') this.hud.pushFeed(t('online.reconnecting'), false); },
      onError: (code) => { if (code !== 'socket' || this.online) this.hud.pushFeed(code === 'pass_expired' ? t('online.err.expired') : t('online.lost'), false); },
    });
    this.online?.close();
    this.online = session;
    this.match = session.mirror.match;
    for (const g of this.grenadeMeshes.values()) g.removeFromParent();
    this.grenadeMeshes.clear();
    this.ensureSoldierViews();
    for (const c of this.match.combatants) this.prevPos.set(c.id, { ...c.pos });
    this.objective.charge.visible = false;
    this.endWhy = '';
    this.input.stance = 'stand';
    this.input.aimToggle = false;
  }

  get isOnline(): boolean { return this.online !== null; }
  /** Dev tooling: the live online session (prediction stats, buffers). */
  get onlineSession(): OnlineSession | null { return this.online; }

  /** Class of the local player; takes effect when the next match starts. */
  setPlayerClass(c: PlayerClass): void { this.opts.playerClass = c; }
  get playerClass(): PlayerClass | undefined { return this.opts.playerClass; }

  restart(): void {
    if (this.online) return; // the server starts the next round
    this.opts.seed = (this.opts.seed * 1103515245 + 12345) >>> 0;
    void this.newMatch();
  }

  resize(w: number, h: number): void {
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.viewmodel?.setAspect(w / h);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastMs = performance.now();
    this.stepper.reset();
    this.sfx.resume();
    this.renderer.setAnimationLoop((now) => this.frame(now));
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.sfx.suspend();
  }

  private applyTier(i: number): void {
    const tier = DEFAULT_QUALITY_TIERS[i];
    if (!tier) return;
    this.tier = i;
    setRendererPixelRatio(this.renderer, tier.dpr);
    if (this.sun.shadow.mapSize.x !== tier.shadowMap) {
      this.sun.shadow.mapSize.set(tier.shadowMap, tier.shadowMap);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    const el = this.hostEl;
    this.resize(el.clientWidth, el.clientHeight);
  }

  private frame(now: number): void {
    // rAF timestamps can precede the performance.now() taken in start(): clamp to a monotonic clock.
    const t = Math.max(now, this.lastMs);
    const frameMs = t - this.lastMs;
    this.lastMs = t;
    const m = this.match;
    const p = m.player!;
    if (this.input.consumeRestart() && m.phase !== 'playing') this.restart();

    // Look is applied per frame (responsive), recoil kick is applied by the sim on top.
    const look = this.input.takeLook();
    const adsScale = p.weapon.ads > 0.5 ? LOOK.adsScale : 1;
    if (p.health.state === 'alive' && m.phase === 'playing') {
      const s = this.touch ? 1 : adsScale; // touch applies ADS scale at the source
      p.yaw -= look.dx * s;
      p.pitch = clamp(p.pitch - look.dy * s, -1.45, 1.45);
    }
    this.lastLook = look;

    let alpha = 1;
    if (this.online) {
      const evs = this.online.update(frameMs, () => this.input.sample(), () => this.input.consumePresses(), { yaw: p.yaw, pitch: p.pitch });
      for (const c of m.combatants) this.prevPos.set(c.id, { ...c.pos });
      this.handleEvents(evs);
    } else {
      const stepped = this.stepper.advance(frameMs / 1000);
      alpha = stepped.alpha;
      for (let i = 0; i < stepped.steps; i++) {
        for (const c of m.combatants) this.prevPos.set(c.id, { ...c.pos });
        const snap = this.input.sample();
        this.input.toCombatInput(snap, p.input, 0, 0);
        this.input.consumePresses();
        m.step(this.stepper.stepSeconds);
        this.physics.step();
        this.handleEvents(m.drainEvents());
      }
    }
    const dt = Math.min(0.1, frameMs / 1000);
    this.updateView(alpha, dt);

    this.renderer.autoClear = true;
    this.envFrame?.(t / 1000);
    this.renderer.render(this.scene, this.camera);
    this.renderer.autoClear = false;
    this.renderer.clearDepth();
    this.renderer.render(this.viewmodel.scene, this.viewmodel.camera);

    const obs = observeFrame(this.governor, frameMs, t);
    this.governor = obs.state;
    if (obs.sample) this.fps = obs.sample.fps;
    if (obs.event) this.applyTier(obs.state.tier);
    this.hud.debug = this.opts.debug
      ? `fps(3s) ${this.fps.toFixed(1)} tier ${this.tier} dpr ${this.renderer.getPixelRatio()}\ncalls ${this.renderer.info.render.calls} tris ${this.renderer.info.render.triangles}\nrapier ${this.physics.version} proj ${m.projectiles.length}${this.online ? `
online rtt ${Math.round(this.online.rtt)} ms corr ${this.online.predictor.stats.corrections} err ${(this.online.predictor.stats.lastError * 100).toFixed(1)} cm` : ''}`
      : null;
  }

  private handleEvents(events: SimEvent[]): void {
    const m = this.match;
    const p = m.player!;
    const listener = p.pos;
    const panOf = (pt: Vec3): number => {
      const dx = pt.x - listener.x, dz = pt.z - listener.z;
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw); // right vector
      const d = Math.hypot(dx, dz) || 1;
      return clamp((dx * rx + dz * rz) / d, -1, 1) * 0.8;
    };
    for (const e of events) {
      switch (e.type) {
        case 'shot': {
          const own = e.shooter === p.id;
          this.sfx.shot(own ? 0 : distXZ(e.origin, listener), own ? 0 : panOf(e.origin), own);
          if (!own) this.flashUntil.set(e.shooter, m.time + 0.035);
          break;
        }
        case 'impact': {
          const d = distXZ(e.point, listener);
          this.effects.impact(e.point, e.normal, e.material, e.targetId === undefined);
          this.sfx.impact(d, e.material === 'metal' || e.material === 'sheetMetal');
          break;
        }
        case 'damage': {
          const victim = m.combatants[e.victim]!, attacker = m.combatants[e.attacker]!;
          if (e.attacker === p.id) {
            this.hud.hitMarker(e.outcome === 'downed' || e.outcome === 'killed');
            this.sfx.hit(e.zone === 'head');
          }
          const sv = this.soldiers.get(e.victim);
          if (sv) {
            const dx = victim.pos.x - attacker.pos.x, dz = victim.pos.z - attacker.pos.z, dl = Math.hypot(dx, dz) || 1;
            sv.hit({ x: dx / dl, y: 0, z: dz / dl });
          }
          if (e.victim === p.id) { this.hud.hurt(); this.sfx.hurt(); this.camShake = 0.25; }
          if (e.outcome === 'downed') this.hud.pushFeed(`${attacker.callsign} ▸ ${victim.callsign}${e.zone === 'head' ? ' ◎' : ''}`, attacker.team === 0);
          break;
        }
        case 'reload':
          if (e.who === p.id) this.sfx.reload(!p.weapon.chambered);
          else if (this.online) { const o = m.combatants[e.who]; if (o) this.sfx.reload(!o.weapon.chambered, distXZ(o.pos, listener)); }
          break;
        case 'objective':
          if (e.event === 'planted') { this.objective.charge.visible = true; this.hud.pushFeed(t('hud.objArmed'), true); }
          if (e.event === 'defused') { this.objective.charge.visible = false; this.endWhy = t('end.defused'); }
          if (e.event === 'detonated') { this.sfx.explosion(); this.camShake = 1; this.endWhy = t('end.detonated'); }
          if (e.event === 'timeExpired') this.endWhy = t('end.time');
          break;
        case 'matchEnd':
          if (!this.endWhy) this.endWhy = e.winner === 0 ? t('end.detonated') : t('end.time');
          if (document.pointerLockElement) document.exitPointerLock();
          break;
        case 'grenade':
          if (e.thrower === p.id) this.sfx.throwGrenade();
          else this.sfx.throwGrenade(distXZ(e.pos, listener), panOf(e.pos));
          break;
        case 'grenadeBounce':
          this.sfx.bounce(distXZ(e.pos, listener), panOf(e.pos));
          break;
        case 'explosion': {
          const d = distXZ(e.pos, listener);
          this.effects.explosion(e.pos);
          this.sfx.explosion(d, panOf(e.pos));
          this.camShake = Math.max(this.camShake, clamp(1 - d / 25, 0, 1));
          break;
        }
        case 'revive':
          this.hud.pushFeed(t('hud.revived', { a: m.combatants[e.medic]!.callsign, b: m.combatants[e.patient]!.callsign }), m.combatants[e.medic]!.team === 0);
          break;
        case 'wave':
          break;
      }
    }
    // Charge beeps.
    const o = m.objective;
    if (o.charge === 'armed' || o.charge === 'defusing') {
      this.beepT -= this.stepper.stepSeconds; // handleEvents runs once per sim step
      if (this.beepT <= 0) { this.sfx.beep(o.fuse < 10); this.beepT = o.fuse < 10 ? 0.5 : 1; }
    }
  }

  /** One small mesh per live grenade, created and removed as the sim spawns/explodes them. */
  private syncGrenades(): void {
    const live = new Set<number>();
    for (const g of this.match.grenades) {
      live.add(g.id);
      let mesh = this.grenadeMeshes.get(g.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.grenadeGeo, this.grenadeMat);
        mesh.castShadow = true;
        this.grenadeMeshes.set(g.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(g.pos.x, g.pos.y, g.pos.z);
    }
    for (const [id, mesh] of this.grenadeMeshes) if (!live.has(id)) { mesh.removeFromParent(); this.grenadeMeshes.delete(id); }
  }

  private updateView(alpha: number, dt: number): void {
    const m = this.match;
    const p = m.player!;
    const lerp = (id: number, cur: Vec3): Vec3 => {
      const a = this.prevPos.get(id) ?? cur;
      return { x: a.x + (cur.x - a.x) * alpha, y: a.y + (cur.y - a.y) * alpha, z: a.z + (cur.z - a.z) * alpha };
    };
    // Camera: interpolated eye with smoothed stance height and a little shake.
    const pp = lerp(p.id, p.pos);
    this.eyeY += (eyeHeight(p) - this.eyeY) * Math.min(1, dt * 10);
    this.camShake = Math.max(0, this.camShake - dt * 2);
    const sh = this.camShake * 0.02;
    this.camera.position.set(pp.x + (Math.random() - 0.5) * sh, pp.y + this.eyeY + (Math.random() - 0.5) * sh, pp.z);
    this.camera.rotation.set(p.pitch + p.kickPitch, p.yaw + p.kickYaw, p.health.state === 'downed' ? 0.25 : 0, 'YXZ');
    this.camera.fov = 75 - p.weapon.ads * 17;
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();

    // Sun shadow follows the player, snapped to texels to avoid shimmering.
    const texel = 64 / this.sun.shadow.mapSize.x;
    const fx = Math.round((pp.x - Math.sin(p.yaw) * 12) / texel) * texel;
    const fz = Math.round((pp.z - Math.cos(p.yaw) * 12) / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 60, this.sunDir.y * 60, fz + this.sunDir.z * 60);

    // Soldiers: detailed parts only for the N nearest (quality tier).
    const tier = DEFAULT_QUALITY_TIERS[this.tier]!;
    const others = m.combatants.filter((c) => c.id !== p.id);
    const order = others.map((c) => ({ c, d: distXZ(c.pos, p.pos) })).sort((a, b) => a.d - b.d);
    order.forEach(({ c }, i) => {
      let v = this.soldiers.get(c.id)!;
      if (v.cls !== c.cls) { v.root.removeFromParent(); v.dispose(); v = this.makeSoldier(c.team, c.id, c.cls); } // class known after the first snapshot / respawn
      const ip = lerp(c.id, c.pos);
      v.update({ ...c, pos: ip }, dt, i < tier.detailedCharacters, (this.flashUntil.get(c.id) ?? -1) > m.time);
    });

    // Objective charge light.
    const o = m.objective;
    const lit = (o.charge === 'armed' || o.charge === 'defusing') && Math.sin(m.time * (o.fuse < 10 ? 20 : 8)) > 0;
    (this.objective.light.material as THREE.MeshStandardMaterial).emissiveIntensity = lit ? 4 : 0;
    this.objective.charge.visible = o.charge === 'armed' || o.charge === 'defusing' || o.charge === 'detonated';

    this.syncGrenades();
    this.ragdolls?.update(dt);
    this.effects.updateTracers(m.projectiles, alpha, this.stepper.stepSeconds);
    this.effects.update(dt);
    this.viewmodel.update(p, dt, this.lastLook.dx, this.lastLook.dy);

    const w = this.renderer.domElement.clientWidth, h = this.renderer.domElement.clientHeight;
    const v = new THREE.Vector3();
    this.hud.update(m, dt, (x, y, z) => {
      v.set(x, y, z).project(this.camera);
      return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, visible: v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 };
    }, this.endWhy, this.online ? (this.online.restartIn() ?? 0) : null);
    if (this.online && m.phase === 'playing') this.endWhy = '';
    this.touch?.sync({
      nearObjective: distXZ(p.pos, m.map.objective) <= OBJECTIVE.interactRadius + 0.6 || (classStats(p.cls).canRevive && m.combatants.some((o) => o.team === p.team && o.health.state === 'downed' && distXZ(o.pos, p.pos) <= REVIVE_RADIUS + 0.6)),
      downed: p.health.state === 'downed',
      alive: p.health.state === 'alive',
    });
  }

  /** Place the player (used by restart tooling and dev automation). */
  teleportPlayer(x: number, z: number, yaw: number, pitch = 0): void {
    const p = this.match.player!;
    p.pos = { x, y: 0.02, z }; p.yaw = yaw; p.pitch = pitch;
    this.physics.placeCharacter?.(p);
    this.prevPos.set(p.id, { ...p.pos });
  }
  /** Fast-forward the simulation (no rendering); used by dev automation on slow software GPUs. */
  simulate(seconds: number): void {
    const n = Math.round(seconds / this.stepper.stepSeconds);
    const p = this.match.player!;
    for (let i = 0; i < n && this.match.phase === 'playing'; i++) {
      for (const c of this.match.combatants) this.prevPos.set(c.id, { ...c.pos });
      this.input.toCombatInput(this.input.sample(), p.input, 0, 0);
      this.match.step(this.stepper.stepSeconds);
      this.physics.step();
      this.handleEvents(this.match.drainEvents());
    }
  }
  get inputManager(): InputManager { return this.input; }
  get stats(): { fps: number; tier: number } { return { fps: this.fps, tier: this.tier }; }

  dispose(): void {
    this.stop();
    this.online?.close();
    this.input.dispose();
    this.touch?.dispose();
    this.hud.dispose();
    this.sfx.dispose();
    this.physics?.dispose();
    this.factory?.dispose();
    this.ragdolls?.dispose();
    if (this.models) { disposeGltf(this.models.soldier); disposeGltf(this.models.rifle); }
    this.viewmodel?.dispose();
    this.effects.dispose();
    this.assets.dispose();
  }
}
