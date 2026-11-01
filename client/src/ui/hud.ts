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

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="vignette" data-k="vig"></div>
      <div class="tl"><div class="small" data-k="stance"></div><div class="hp" data-k="hpbar"><i data-k="hp"></i></div>
        <div class="small" data-k="wave"></div></div>
      <div class="tc"><div class="team" data-k="team"></div><div class="clock" data-k="clock"></div>
        <div class="obj" data-k="obj"></div><div class="bar" data-k="barw" hidden><i data-k="bar"></i></div></div>
      <div class="tr"><div class="ammo" data-k="ammo"></div><div class="small" data-k="weapon"></div><div class="small" data-k="gren"></div></div>
      <div class="feed" data-k="feed"></div>
      <div class="cross" data-k="cross"><i class="h" data-k="cl"></i><i class="h" data-k="cr"></i><i class="v" data-k="cu"></i><i class="v" data-k="cd"></i><i class="dot"></i></div>
      <div class="hitm" data-k="hitm"></div>
      <div class="marker" data-k="marker"><b></b><span data-k="mdist"></span></div>
      <div class="prompt" data-k="prompt" hidden></div>
      <div class="overlay" data-k="down" hidden><h2>${t('hud.downed')}</h2><div data-k="downT"></div><div class="small">${t('hud.downedHint')}</div></div>
      <div class="overlay" data-k="dead" hidden><h2>${t('hud.dead')}</h2><div data-k="deadT"></div></div>
      <div class="overlay end" data-k="end" hidden><h2 data-k="endTitle"></h2><div data-k="endWhy"></div><div class="small" data-k="endStats"></div>
        <div class="countdown" data-k="endNext" hidden></div>
        <button data-k="restart">${t('end.restart')}</button></div>
      <div class="blockout">${t('blockout')}</div>
      <div class="debug" data-k="debug" hidden></div>`;
    for (const n of this.root.querySelectorAll<HTMLElement>('[data-k]')) this.el[n.dataset.k!] = n;
    this.el.restart!.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.onRestart(); });
    parent.appendChild(this.root);
  }

  hitMarker(kill: boolean): void { this.hitT = 0.18; this.el.hitm!.classList.toggle('kill', kill); }
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
