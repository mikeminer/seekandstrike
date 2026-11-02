import type { CombatInput } from '@shared/sim/combatant';
import type { Stance } from '@shared/sim/movement';

/**
 * Unified input (keyboard/mouse + touch). Holds are sampled each sim step; presses are
 * latched until the next step consumes them; look deltas accumulate per frame and are split
 * across the steps of that frame by the game loop.
 */
export interface InputSnapshot {
  moveX: number; moveY: number;
  sprint: boolean; aim: boolean; fire: boolean; interact: boolean;
  jump: boolean; reload: boolean; tapOut: boolean; restart: boolean; grenade: boolean; weapon: boolean;
  stance: Stance;
}

/**
 * adsScale: aiming zooms the world from 75° to 58° (~1.38×), so the same finger movement crosses more of the
 * magnified picture. 0.6 left the sight at ~83 % of the hip screen speed (felt unstable on the Seeker); 0.45 gives
 * ~62 %, steadier on a small red dot. See input.test.ts.
 */
export const LOOK = { mouseRadPerPx: 0.0022, touchRadPerPx: 0.0058, adsScale: 0.45 };
export const WORLD_FOV = { hip: 75, ads: 58 } as const;

export class InputManager {
  private keys = new Set<string>();
  private mouseFire = false;
  private mouseAim = false;
  private latched = { jump: false, reload: false, tapOut: false, restart: false, grenade: false, weapon: false };
  private lookX = 0;
  private lookY = 0;
  stance: Stance = 'stand';
  touch = { moveX: 0, moveY: 0, fire: false, aim: false, sprint: false, interact: false };
  aimToggle = false;
  private off: (() => void)[] = [];
  pointerLocked = false;

  constructor(private canvas: HTMLCanvasElement) {
    const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions): void => {
      t.addEventListener(type, fn as EventListener, opts);
      this.off.push(() => t.removeEventListener(type, fn as EventListener, opts));
    };
    on(window, 'keydown', (e: KeyboardEvent) => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'Space') this.latched.jump = true;
      if (e.code === 'KeyR') this.latched.reload = true;
      if (e.code === 'KeyF') this.latched.tapOut = true;
      if (e.code === 'KeyG') this.latched.grenade = true;
      if (e.code === 'Enter') this.latched.restart = true;
      if (e.code === 'KeyC') this.stance = this.stance === 'crouch' ? 'stand' : 'crouch';
      if (e.code === 'KeyZ') this.stance = this.stance === 'prone' ? 'stand' : 'prone';
    });
    on(window, 'keyup', (e: KeyboardEvent) => { this.keys.delete(e.code); });
    on(window, 'blur', () => { this.keys.clear(); this.mouseFire = false; this.mouseAim = false; });
    on(canvas, 'mousedown', (e: MouseEvent) => {
      if (!this.pointerLocked) { void canvas.requestPointerLock?.(); return; }
      if (e.button === 0) this.mouseFire = true;
      if (e.button === 2) this.mouseAim = true;
    });
    on(window, 'mouseup', (e: MouseEvent) => {
      if (e.button === 0) this.mouseFire = false;
      if (e.button === 2) this.mouseAim = false;
    });
    on(canvas, 'contextmenu', (e: Event) => e.preventDefault());
    on(document, 'pointerlockchange', () => { this.pointerLocked = document.pointerLockElement === canvas; });
    on(window, 'mousemove', (e: MouseEvent) => {
      if (!this.pointerLocked) return;
      this.addLook(e.movementX * LOOK.mouseRadPerPx, e.movementY * LOOK.mouseRadPerPx);
    });
  }

  /** Look in radians (positive x = turn right, positive y = look down). */
  addLook(dx: number, dy: number): void { this.lookX += dx; this.lookY += dy; }

  takeLook(): { dx: number; dy: number } {
    const r = { dx: this.lookX, dy: this.lookY };
    this.lookX = 0; this.lookY = 0;
    return r;
  }

  press(k: keyof InputManager['latched']): void { this.latched[k] = true; }

  sample(): InputSnapshot {
    const k = (c: string): boolean => this.keys.has(c);
    let mx = (k('KeyD') ? 1 : 0) - (k('KeyA') ? 1 : 0) + this.touch.moveX;
    let my = (k('KeyW') ? 1 : 0) - (k('KeyS') ? 1 : 0) + this.touch.moveY;
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    const s: InputSnapshot = {
      moveX: mx, moveY: my,
      sprint: k('ShiftLeft') || k('ShiftRight') || this.touch.sprint,
      aim: this.mouseAim || this.touch.aim || this.aimToggle,
      fire: this.mouseFire || this.touch.fire,
      interact: k('KeyE') || this.touch.interact,
      jump: this.latched.jump, reload: this.latched.reload, tapOut: this.latched.tapOut, restart: this.latched.restart, grenade: this.latched.grenade, weapon: this.latched.weapon,
      stance: this.stance,
    };
    return s;
  }

  /** Clear one-shot presses after a sim step consumed them. */
  consumePresses(): void { this.latched.jump = false; this.latched.reload = false; this.latched.tapOut = false; this.latched.grenade = false; this.latched.weapon = false; }
  consumeRestart(): boolean { const r = this.latched.restart; this.latched.restart = false; return r; }

  toCombatInput(s: InputSnapshot, out: CombatInput, lookYaw: number, lookPitch: number): void {
    out.moveX = s.moveX; out.moveY = s.moveY; out.sprint = s.sprint && s.moveY > 0.5; out.jump = s.jump;
    out.aim = s.aim; out.fire = s.fire; out.reload = s.reload; out.interact = s.interact; out.tapOut = s.tapOut; out.throwGrenade = s.grenade; out.switchWeapon = s.weapon;
    out.wantStance = s.stance; out.lookYaw = lookYaw; out.lookPitch = lookPitch;
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off = [];
    if (document.pointerLockElement === this.canvas) document.exitPointerLock();
  }
}
