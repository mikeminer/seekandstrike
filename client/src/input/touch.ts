import { type InputManager, LOOK } from './input';
import { t } from '../ui/i18n';

/**
 * Touch layout (landscape, inside CSS safe areas):
 *  - left half: floating move stick (pushing past the rim forward = sprint)
 *  - right half: drag anywhere to look; FIRE also looks while held (drag-to-fire)
 *  - buttons: FIRE (two, left and right thumb), MIRA (ADS toggle), RICARICA, SALTO,
 *    GRANATA, ACCOVACCIATO, A TERRA, AZIONE (hold, shown near the objective), ARRENDITI (when downed).
 */
export class TouchControls {
  readonly root: HTMLDivElement;
  private stick: HTMLDivElement;
  private knob: HTMLDivElement;
  private moveId: number | null = null;
  private moveOrigin = { x: 0, y: 0 };
  private looks = new Map<number, { x: number; y: number }>();
  private off: (() => void)[] = [];
  readonly buttons: Record<string, HTMLButtonElement> = {};
  getAdsScale: () => number = () => 1;
  /** Push-to-talk (online team voice). */
  onTalk: (down: boolean) => void = () => {};
  setTalkVisible(v: boolean): void { if (this.buttons.talk) this.buttons.talk.style.display = v ? '' : 'none'; }
  setTalkActive(on: boolean): void { this.buttons.talk?.classList.toggle('active', on); }

  constructor(parent: HTMLElement, private input: InputManager) {
    this.root = document.createElement('div');
    this.root.className = 'touch';
    this.stick = document.createElement('div'); this.stick.className = 'stick';
    this.knob = document.createElement('div'); this.knob.className = 'knob';
    this.stick.appendChild(this.knob);
    this.root.appendChild(this.stick);
    const zoneL = document.createElement('div'); zoneL.className = 'zone zone-l';
    const zoneR = document.createElement('div'); zoneR.className = 'zone zone-r';
    this.root.prepend(zoneL, zoneR);
    parent.appendChild(this.root);

    const on = (el: EventTarget, type: string, fn: (e: PointerEvent) => void): void => {
      el.addEventListener(type, fn as EventListener, { passive: false });
      this.off.push(() => el.removeEventListener(type, fn as EventListener));
    };
    // Move stick.
    on(zoneL, 'pointerdown', (e) => {
      if (e.pointerType === 'mouse' || this.moveId !== null) return;
      e.preventDefault();
      this.moveId = e.pointerId;
      zoneL.setPointerCapture(e.pointerId);
      this.moveOrigin = { x: e.clientX, y: e.clientY };
      this.stick.style.left = `${e.clientX}px`; this.stick.style.top = `${e.clientY}px`;
      this.stick.classList.add('on');
    });
    on(zoneL, 'pointermove', (e) => {
      if (e.pointerId !== this.moveId) return;
      const R = 56;
      let dx = (e.clientX - this.moveOrigin.x) / R, dy = (e.clientY - this.moveOrigin.y) / R;
      const m = Math.hypot(dx, dy);
      this.input.touch.sprint = -dy > 1.35 && Math.abs(dx) < 0.6;
      if (m > 1) { dx /= m; dy /= m; }
      this.input.touch.moveX = Math.abs(dx) < 0.12 ? 0 : dx;
      this.input.touch.moveY = Math.abs(dy) < 0.12 ? 0 : -dy;
      this.knob.style.transform = `translate(${dx * R}px, ${dy * R}px)`;
    });
    const endMove = (e: PointerEvent): void => {
      if (e.pointerId !== this.moveId) return;
      this.moveId = null;
      this.input.touch.moveX = 0; this.input.touch.moveY = 0; this.input.touch.sprint = false;
      this.knob.style.transform = '';
      this.stick.classList.remove('on');
    };
    on(zoneL, 'pointerup', endMove); on(zoneL, 'pointercancel', endMove);
    // Look zone.
    const lookStart = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse') return;
      this.looks.set(e.pointerId, { x: e.clientX, y: e.clientY });
    };
    const lookMove = (e: PointerEvent): void => {
      const p = this.looks.get(e.pointerId);
      if (!p) return;
      const s = LOOK.touchRadPerPx * this.getAdsScale();
      this.input.addLook((e.clientX - p.x) * s, (e.clientY - p.y) * s);
      p.x = e.clientX; p.y = e.clientY;
    };
    const lookEnd = (e: PointerEvent): void => { this.looks.delete(e.pointerId); };
    on(zoneR, 'pointerdown', (e) => { e.preventDefault(); zoneR.setPointerCapture(e.pointerId); lookStart(e); });
    on(zoneR, 'pointermove', lookMove);
    on(zoneR, 'pointerup', lookEnd); on(zoneR, 'pointercancel', lookEnd);

    const btn = (id: string, label: string, cls: string, down: (el: HTMLButtonElement) => void, up?: () => void, look = false): void => {
      const b = document.createElement('button');
      b.className = `tbtn ${cls}`; b.textContent = label; b.dataset.id = id;
      this.root.appendChild(b);
      this.buttons[id] = b;
      on(b, 'pointerdown', (e) => {
        e.preventDefault(); e.stopPropagation();
        b.setPointerCapture(e.pointerId); b.classList.add('down'); down(b);
        if (look) lookStart(e);
      });
      const end = (e: PointerEvent): void => { b.classList.remove('down'); up?.(); if (look) lookEnd(e); };
      on(b, 'pointerup', end); on(b, 'pointercancel', end);
      if (look) on(b, 'pointermove', lookMove);
    };
    btn('fire', t('btn.fire'), 'b-fire', () => { this.input.touch.fire = true; }, () => { this.input.touch.fire = false; }, true);
    btn('fire2', t('btn.fire'), 'b-fire2', () => { this.input.touch.fire = true; }, () => { this.input.touch.fire = false; });
    btn('ads', t('btn.ads'), 'b-ads', (b) => { this.input.aimToggle = !this.input.aimToggle; b.classList.toggle('active', this.input.aimToggle); });
    btn('reload', t('btn.reload'), 'b-reload', () => this.input.press('reload'));
    btn('grenade', t('btn.grenade'), 'b-grenade', () => this.input.press('grenade'));
    btn('talk', t('btn.talk'), 'b-talk', () => this.onTalk(true), () => this.onTalk(false));
    this.buttons.talk!.style.display = 'none';
    btn('jump', t('btn.jump'), 'b-jump', () => this.input.press('jump'));
    btn('crouch', t('btn.crouch'), 'b-crouch', () => { this.input.stance = this.input.stance === 'crouch' ? 'stand' : 'crouch'; });
    btn('prone', t('btn.prone'), 'b-prone', () => { this.input.stance = this.input.stance === 'prone' ? 'stand' : 'prone'; });
    btn('interact', t('btn.interact'), 'b-interact', () => { this.input.touch.interact = true; }, () => { this.input.touch.interact = false; });
    btn('tapout', t('btn.tapout'), 'b-tapout', () => this.input.press('tapOut'));
  }

  /** Context visibility + stance highlight. */
  sync(state: { nearObjective: boolean; downed: boolean; alive: boolean; ended?: boolean }): void {
    // Round over: the summary owns the screen, no combat controls on top of it (owner report 2026-11-02).
    this.root.style.display = state.ended ? 'none' : '';
    if (state.ended) return;
    this.buttons.interact!.style.display = state.nearObjective && state.alive ? '' : 'none';
    this.buttons.tapout!.style.display = state.downed ? '' : 'none';
    this.buttons.crouch!.classList.toggle('active', this.input.stance === 'crouch');
    this.buttons.prone!.classList.toggle('active', this.input.stance === 'prone');
    this.buttons.ads!.classList.toggle('active', this.input.aimToggle);
  }

  dispose(): void { for (const f of this.off) f(); this.root.remove(); }
}
