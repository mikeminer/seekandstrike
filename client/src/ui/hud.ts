import type { Match } from '@shared/sim/match';
import { OBJECTIVE } from '@shared/sim/objective';
import { roundsLoaded, currentSpread } from '@shared/sim/weapons';
import { distXZ } from '@shared/sim/vec';
import { t } from './i18n';

const fmt = (s: number): string => {
  const v = Math.max(0, Math.ceil(s));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};

/** DOM HUD kept to screen edges/top band so the play area and thumb zones stay clear. */
export class Hud {
  readonly root: HTMLDivElement;
  private el: Record<string, HTMLElement> = {};
  private hitT = 0;
  private hurtT = 0;
  private feed: { text: string; cls: string; t: number }[] = [];
  onRestart: () => void = () => {};
  onMenu: () => void = () => {};
  onTutorialSkip: () => void = () => {};
  private dmgT = 0;
  private pops: { el: HTMLElement; t: number }[] = [];

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="vignette" data-k="vig"></div>
      <div class="scope" data-k="scope" hidden><i class="sh"></i><i class="sv"></i></div>
      <div class="tl"><div class="small" data-k="stance"></div><div class="hp" data-k="hpbar"><i data-k="hp"></i></div>
        <div class="small" data-k="wave"></div></div>
      <div class="tc"><div class="team" data-k="team"></div><div class="clock" data-k="clock"></div>
        <div class="obj" data-k="obj"></div><div class="bar" data-k="barw" hidden><i data-k="bar"></i></div></div>
      <div class="tr"><div class="ammo" data-k="ammo"></div><div class="small" data-k="weapon"></div><div class="small" data-k="gren"></div></div>
      <div class="feed" data-k="feed"></div>
      <div class="voice" data-k="voice"></div>
      <div class="cross" data-k="cross"><i class="h" data-k="cl"></i><i class="h" data-k="cr"></i><i class="v" data-k="cu"></i><i class="v" data-k="cd"></i><i class="dot"></i></div>
      <div class="hitm" data-k="hitm"></div>
      <div class="dmgdir" data-k="dmgdir"><i></i></div>
      <div class="pops" data-k="pops"></div>
      <div class="tut" data-k="tut" hidden><span data-k="tutT"></span><button data-k="tutSkip"></button></div>
      <div class="marker" data-k="marker"><b></b><span data-k="mdist"></span></div>
      <div class="prompt" data-k="prompt" hidden></div>
      <div class="overlay" data-k="down" hidden><h2>${t('hud.downed')}</h2><div data-k="downT"></div><div class="small">${t('hud.downedHint')}</div></div>
      <div class="overlay" data-k="dead" hidden><h2>${t('hud.dead')}</h2><div data-k="deadT"></div></div>
      <div class="overlay end" data-k="end" hidden><h2 data-k="endTitle"></h2><div data-k="endWhy"></div><div class="small" data-k="endStats"></div>
        <div data-k="endSum"></div>
        <div class="countdown" data-k="endNext" hidden></div>
        <div class="endbtns"><button data-k="restart">${t('end.restart')}</button><button class="ghost" data-k="toMenu" hidden></button></div></div>
      <div class="blockout">${t('blockout')}</div>
      <div class="debug" data-k="debug" hidden></div>`;
    for (const n of this.root.querySelectorAll<HTMLElement>('[data-k]')) this.el[n.dataset.k!] = n;
    this.el.restart!.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.onRestart(); });
    this.el.toMenu!.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.onMenu(); });
    this.el.tutSkip!.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.onTutorialSkip(); });
    parent.appendChild(this.root);
  }

  hitMarker(kill: boolean, head = false): void {
    this.hitT = kill ? 0.32 : 0.18;
    this.el.hitm!.classList.toggle('kill', kill);
    this.el.hitm!.classList.toggle('head', head);
    // Restart the pop animation.
    this.el.hitm!.classList.remove('pop'); void this.el.hitm!.offsetWidth; this.el.hitm!.classList.add('pop');
  }
  /** Damage direction: angle of the attacker relative to where the player looks (rad, 0 = ahead, + = right). */
  hurtFrom(angle: number): void { this.dmgT = 1; (this.el.dmgdir!.firstElementChild as HTMLElement).style.transform = `rotate(${angle}rad)`; }
  /** Score popup under the crosshair ("+100 ABBATTUTO"). */
  popup(text: string, xp: number, kind: string): void {
    const el = document.createElement('div');
    el.className = `pop ${kind}`;
    el.innerHTML = `${xp > 0 ? `<b>+${xp}</b> ` : ''}${text}`;
    this.el.pops!.prepend(el);
    this.pops.push({ el, t: 1.6 });
    while (this.pops.length > 4) this.pops.shift()!.el.remove();
  }
  set tutorial(text: string | null) {
    this.el.tut!.hidden = text === null;
    if (text !== null && this.el.tutT!.textContent !== text) this.el.tutT!.textContent = text;
  }
  /** Sniper scope overlay (the 3D weapon hides meanwhile). */
  set scope(on: boolean) { if (this.el.scope!.hidden === on) this.el.scope!.hidden = !on; }
  set tutorialSkipLabel(v: string) { this.el.tutSkip!.textContent = v; }
  private lastSpeakers = '';
  /** Teammates speaking on team voice right now. */
  set speakers(names: string[]) {
    const key = names.join('|');
    if (key === this.lastSpeakers) return;
    this.lastSpeakers = key;
    this.el.voice!.replaceChildren(...names.map((n) => { const d = document.createElement('div'); d.textContent = `🎙 ${n}`; return d; }));
  }
  /** End-of-match summary HTML (empty to clear) and the label of the back-to-menu button (null hides it). */
  setSummary(html: string, menuLabel: string | null, againLabel?: string): void {
    this.el.endSum!.innerHTML = html;
    this.el.toMenu!.hidden = menuLabel === null;
    if (menuLabel !== null) this.el.toMenu!.textContent = menuLabel;
    this.el.restart!.textContent = againLabel ?? t('end.restart');
  }
  hurt(): void { this.hurtT = 0.6; }
  pushFeed(text: string, good: boolean): void { this.feed.unshift({ text, cls: good ? 'a' : 'd', t: 5 }); this.feed.length = Math.min(this.feed.length, 5); }

  set debug(text: string | null) {
    this.el.debug!.hidden = text === null;
    if (text !== null) this.el.debug!.textContent = text;
  }

  update(m: Match, dt: number, project: (x: number, y: number, z: number) => { x: number; y: number; visible: boolean }, endWhy: string, restartIn: number | null = null): void {
    const p = m.player;
    if (!p) return;
    const e = this.el;
    const o = m.objective;
    e.team!.textContent = t('hud.attack');
    e.clock!.textContent = o.charge === 'armed' || o.charge === 'defusing' ? `${fmt(o.clock)}  ·  ⏱ ${o.fuse.toFixed(1)}s` : fmt(o.clock);
    const near = p.health.state === 'alive' && distXZ(p.pos, m.map.objective) <= OBJECTIVE.interactRadius;
    let objText = t('hud.objPlant'), alert = false, bar = -1;
    if (o.charge === 'planting') { objText = t('hud.planting'); bar = o.progress / OBJECTIVE.plantSeconds; }
    else if (o.charge === 'armed') { objText = t('hud.objArmed'); bar = o.fuse / OBJECTIVE.fuseSeconds; }
    else if (o.charge === 'defusing') { objText = t('hud.defusing'); alert = true; bar = (o.defuseBanked + o.progress) / OBJECTIVE.defuseSeconds; }
    e.obj!.textContent = objText;
    e.obj!.classList.toggle('alert', alert);
    e.barw!.hidden = bar < 0;
    if (bar >= 0) e.bar!.style.width = `${Math.min(100, bar * 100)}%`;

    const hp = Math.max(0, p.health.hp);
    e.hp!.style.width = `${hp}%`;
    e.hpbar!.classList.toggle('low', hp < 35);
    e.stance!.textContent = `${Math.round(hp)} HP · ${p.move.stance.toUpperCase()}${p.move.sprinting ? ' · SPRINT' : ''}`;
    e.wave!.textContent = `${t('hud.wave')} ${fmt(m.waves[0].secondsToWave)}`;
    const w = p.weapon;
    e.ammo!.innerHTML = w.phase === 'reloading' ? `<small>${t('hud.reloading')}</small>` : `${roundsLoaded(w)} <small>/ ${w.reserve}</small>`;
    e.weapon!.textContent = `${w.spec.name} · ${w.spec.calibre}`;
    e.gren!.textContent = `${t('class.' + p.cls as never)} · ${t('hud.grenades')} ${p.grenades}`;

    // Crosshair gap follows the real spread cone; hidden when aiming down sights (optic dot).
    const spread = currentSpread(w, { stance: p.move.stance, moving: Math.min(1, p.speed / 4.2), airborne: !p.move.grounded });
    const gap = 4 + spread * 520;
    e.cl!.style.left = `${-gap - 7}px`; e.cr!.style.left = `${gap}px`; e.cu!.style.top = `${-gap - 7}px`; e.cd!.style.top = `${gap}px`;
    e.cross!.style.opacity = String(p.health.state === 'alive' ? Math.max(0, 1 - w.ads * 2) : 0);

    this.hitT = Math.max(0, this.hitT - dt);
    e.hitm!.style.opacity = this.hitT > 0 ? '1' : '0';
    this.hurtT = Math.max(0, this.hurtT - dt);
    this.dmgT = Math.max(0, this.dmgT - dt * 1.2);
    e.dmgdir!.style.opacity = String(this.dmgT);
    for (const pp of this.pops) { pp.t -= dt; if (pp.t < 0.4) pp.el.style.opacity = String(Math.max(0, pp.t / 0.4)); }
    this.pops = this.pops.filter((pp) => { if (pp.t <= 0) { pp.el.remove(); return false; } return true; });
    e.vig!.style.opacity = String(Math.max(this.hurtT * 1.4, p.health.state === 'downed' ? 0.9 : (100 - hp) / 140));

    const obj = m.map.objective;
    const sp = project(obj.x, obj.y + 0.4, obj.z);
    e.marker!.style.display = sp.visible ? '' : 'none';
    if (sp.visible) { e.marker!.style.left = `${sp.x}px`; e.marker!.style.top = `${sp.y}px`; e.mdist!.textContent = `${Math.round(distXZ(p.pos, obj))} m`; }
    const reviving = m.reviveProgress.has(p.id);
    e.prompt!.hidden = !(reviving || (near && (o.charge === 'idle' || o.charge === 'planting')));
    e.prompt!.textContent = reviving ? t('hud.reviving') : t('hud.holdInteract');

    e.down!.hidden = p.health.state !== 'downed';
    if (p.health.state === 'downed') e.downT!.textContent = `${Math.ceil(p.health.downedTimer)} s · ${t('hud.wave')} ${fmt(m.waves[0].secondsToWave)}`;
    e.dead!.hidden = p.health.state !== 'dead' || m.phase !== 'playing';
    if (p.health.state === 'dead') e.deadT!.textContent = fmt(m.waves[0].secondsToWave);

    const ended = m.phase !== 'playing';
    e.end!.hidden = !ended;
    if (ended) {
      e.endTitle!.textContent = m.phase === 'attackersWin' ? t('end.win') : t('end.loss');
      e.endWhy!.textContent = endWhy;
      e.endStats!.textContent = t('end.stats', { k: p.kills, d: p.deaths });
      // Online the server starts the next round: show its countdown instead of the manual restart button.
      const online = restartIn !== null;
      e.endNext!.hidden = !online;
      e.restart!.hidden = online;
      if (online) e.endNext!.textContent = t('end.next', { s: restartIn });
    }

    for (const f of this.feed) f.t -= dt;
    this.feed = this.feed.filter((f) => f.t > 0);
    e.feed!.innerHTML = this.feed.map((f) => `<div class="${f.cls}">${f.text}</div>`).join('');
  }

  dispose(): void { this.root.remove(); }
}
