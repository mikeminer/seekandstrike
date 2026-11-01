// DEV-ONLY character lab: renders SoldierViews / the viewmodel with fake combatants for
// calibration and screenshots. Served only by the dev server (client/lab.html); not in builds.
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { PORTO_ARDESIA } from '@shared/map/portoArdesia';
import { createCombatant, type Combatant } from '@shared/sim/combatant';
import { createRenderer } from '../render/renderer';
import { loadCharacterModels } from '../render/models';
import { RagdollSystem } from '../render/ragdoll';
import { SoldierFactory, type SoldierView } from '../render/soldier';
import { Viewmodel } from '../render/viewmodel';
import { makeFlashTexture } from '../render/effects';

document.body.style.margin = '0';
const host = document.createElement('div');
host.style.cssText = 'width:100vw;height:100vh';
document.body.appendChild(host);
const renderer = createRenderer(host);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9aa6ae);
const pm = new THREE.PMREMGenerator(renderer);
const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environment = env;
scene.environmentIntensity = 0.6;
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
sun.position.set(4, 7, 3); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6 });
scene.add(sun, new THREE.HemisphereLight(0xbcd0e0, 0x4a4438, 0.6));
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x6f6a62, roughness: 0.95 }));
ground.receiveShadow = true; scene.add(ground);
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.05, 200);
const models = await loadCharacterModels('/');
await RAPIER.init();
const ragdolls = new RagdollSystem({ ...PORTO_ARDESIA, boxes: [] });
const factory = new SoldierFactory(models, ragdolls);
const flashTex = makeFlashTexture();
const vm = new Viewmodel(innerWidth / innerHeight, env, models, flashTex);
const units: { c: Combatant; v: SoldierView }[] = [];

(window as any).__lab = {
  /** Spawn a soldier. Returns its index. */
  add(team: 0 | 1, id: number, x: number, z: number, yaw: number, opts: Partial<{ cls: number; stance: 'stand' | 'crouch' | 'prone'; speed: number; aim: boolean; pitch: number; sprint: boolean }> = {}) {
    const c = createCombatant(id, team, true, 'X' + id);
    c.pos = { x, y: 0, z }; c.yaw = yaw; c.pitch = opts.pitch ?? 0;
    c.move.stance = opts.stance ?? 'stand'; c.speed = opts.speed ?? 0; c.move.sprinting = !!opts.sprint; c.input.aim = !!opts.aim;
    const v = factory.create(team, id, opts.cls ?? 0);
    v.setFlash(new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, color: 0xffd29a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
    v.root.traverse((o) => { o.castShadow = true; });
    scene.add(v.root);
    units.push({ c, v });
    return units.length - 1;
  },
  unit(i: number) { return units[i]!.c; },
  kill(i: number, dx = 0, dz = 1) { const u = units[i]!; u.v.hit({ x: dx, y: 0, z: dz }); u.c.health.state = 'dead'; },
  down(i: number) { units[i]!.c.health.state = 'downed'; },
  fire(i: number) { const c = units[i]!.c; c.sinceShot = 0; c.weapon.shotsFired++; },
  reload(i: number, total = 2.4) { const w = units[i]!.c.weapon; w.phase = 'reloading'; w.reloadTotal = total; w.reloadTimer = total; },
  advance(sec: number, detailed = true) {
    const dt = 1 / 60;
    for (let t = 0; t < sec; t += dt) {
      for (const { c, v } of units) {
        c.sinceShot += dt;
        if (c.weapon.phase === 'reloading') { c.weapon.reloadTimer -= dt; if (c.weapon.reloadTimer <= 0) c.weapon.phase = 'ready'; }
        v.update(c, dt, detailed, c.sinceShot < 0.04);
      }
      ragdolls.update(dt);
    }
  },
  view(px: number, py: number, pz: number, tx: number, ty: number, tz: number) {
    camera.position.set(px, py, pz); camera.lookAt(tx, ty, tz); camera.updateMatrixWorld();
    renderer.autoClear = true; renderer.render(scene, camera);
    return renderer.info.render.calls;
  },
  /** First-person: viewmodel only over a plain background. */
  fp(state: Partial<{ ads: number; reloadT: number; fireT: number; sprint: boolean }>) {
    const c = createCombatant(99, 0, false, 'P');
    c.weapon.ads = state.ads ?? 0;
    if (state.reloadT !== undefined) { c.weapon.phase = 'reloading'; c.weapon.reloadTotal = 2.4; c.weapon.reloadTimer = 2.4 * (1 - state.reloadT); c.weapon.chambered = false; }
    c.move.sprinting = !!state.sprint;
    c.sinceShot = state.fireT ?? 9;
    for (let i = 0; i < 40; i++) vm.update(c, 1 / 60, 0, 0);
    if (state.fireT !== undefined) { c.weapon.shotsFired++; c.sinceShot = 0.01; vm.update(c, 1 / 60, 0, 0); }
    camera.position.set(0, 1.62, 6); camera.lookAt(0, 1.5, -20); camera.updateMatrixWorld();
    renderer.autoClear = true; renderer.render(scene, camera);
    renderer.autoClear = false; renderer.clearDepth(); renderer.render(vm.scene, vm.camera);
  },
  /** First-person debugging: the viewmodel scene seen from a free camera (gun is near (0.13,-0.15,-0.24)). */
  vmView(px: number, py: number, pz: number, tx: number, ty: number, tz: number, state: Partial<{ ads: number; reloadT: number; sprint: boolean }> = {}) {
    const c = createCombatant(99, 0, false, 'P');
    c.weapon.ads = state.ads ?? 0;
    if (state.reloadT !== undefined) { c.weapon.phase = 'reloading'; c.weapon.reloadTotal = 2.4; c.weapon.reloadTimer = 2.4 * (1 - state.reloadT); c.weapon.chambered = false; }
    c.move.sprinting = !!state.sprint;
    for (let i = 0; i < 40; i++) vm.update(c, 1 / 60, 0, 0);
    const cam = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 5);
    cam.position.set(px, py, pz); cam.lookAt(tx, ty, tz); cam.updateMatrixWorld();
    renderer.autoClear = true; renderer.setClearColor(0x9aa6ae); renderer.render(vm.scene, cam);
  },
  clear() { for (const u of units) { ragdolls.release(u.v); scene.remove(u.v.root); u.v.dispose(); } units.length = 0; },
  renderer, scene, camera, ragdolls,
};
(window as any).__labReady = true;
