/**
 * Main-menu meta panels: player header (rank, level, XP bar), tabs Play / Profile / Settings,
 * challenges with progress, lifetime stats, unlocks and settings. Pure DOM, no game imports.
 */
import { locale } from '../ui/i18n';
import { LANGS, NATIVE_NAMES, chooseLang, isLang } from '../i18n/lang';
import { challengeText, m } from './strings';
import {
  type Profile, type Settings, UNLOCKS, challengeDef, levelFromXp, rankIndex, refreshPeriods, unlockedAt,
} from './progression';
import { saveProfile } from './profileStore';

const esc = (x: string): string => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

export interface MetaMenu { refresh(): void; showTab(t: 'play' | 'profile' | 'settings'): void }

/** Server answer of GET /leaderboard (names and short wallets only). */
export interface LeaderboardData {
  week: string; players: number;
  top: { rank: number; name: string; wallet: string; score: number; kills: number; deaths: number; wins: number; rounds: number }[];
  me: LeaderboardData['top'][number] | null;
}

export function mountMetaMenu(card: HTMLElement, profile: Profile, hooks: { onSettings(s: Settings): void; onReplayTutorial(): void; leaderboard?: () => Promise<LeaderboardData | null> }): MetaMenu {
  const logo = card.querySelector('.logo');
  const header = document.createElement('div');
  header.className = 'meta-head';
  const tabs = document.createElement('div');
  tabs.className = 'meta-tabs';
  tabs.innerHTML = (['play', 'profile', 'settings'] as const).map((k) => `<button type="button" data-tab="${k}">${m(`tab.${k}`)}</button>`).join('');
  const play = document.createElement('div');
  play.className = 'meta-pane';
  play.dataset.pane = 'play';
  // Everything after the logo/tagline becomes the Play pane.
  const keep = new Set([logo, card.querySelector('.tagline')]);
  for (const ch of [...card.children]) if (!keep.has(ch)) play.appendChild(ch);
  const prof = document.createElement('div');
  prof.className = 'meta-pane'; prof.dataset.pane = 'profile';
  const sett = document.createElement('div');
  sett.className = 'meta-pane'; sett.dataset.pane = 'settings';
  card.append(header, tabs, play, prof, sett);

  const showTab = (t: 'play' | 'profile' | 'settings'): void => {
    for (const p of card.querySelectorAll<HTMLElement>('.meta-pane')) p.hidden = p.dataset.pane !== t;
    for (const b of tabs.querySelectorAll<HTMLButtonElement>('button')) b.classList.toggle('on', b.dataset.tab === t);
  };
  tabs.addEventListener('click', (e) => {
    const t = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.tab;
    if (t === 'play' || t === 'profile' || t === 'settings') showTab(t);
    if (t === 'profile') void loadBoard();
  });

  const lang = locale();
  const challengeRows = (items: Profile['daily']['items']): string => items.map((it) => {
    const d = challengeDef(it.id)!;
    const pct = Math.round((it.progress / d.goal) * 100);
    return `<div class="ch${it.done ? ' done' : ''}"><div class="ch-t">${esc(challengeText(d.stat, d.goal))}<span>${it.done ? m('ch.done') : `${it.progress}/${d.goal}`} · +${d.xp} XP</span></div><div class="ch-b"><i style="width:${pct}%"></i></div></div>`;
  }).join('');

  const renderHeader = (): void => {
    const l = levelFromXp(profile.xp);
    const pct = l.need ? Math.round((l.into / l.need) * 100) : 100;
    header.innerHTML = `<div class="mh-row"><b class="mh-lvl">${l.level}</b><div class="mh-mid"><div class="mh-rank">${esc(m(`rank.${rankIndex(l.level)}` as never))}</div>
      <div class="mh-bar"><i style="width:${pct}%"></i></div></div><div class="mh-xp">${l.need ? `${l.into}/${l.need} ${m('xp')}` : 'MAX'}</div></div>`;
  };

  const renderProfile = (): void => {
    refreshPeriods(profile, new Date());
    const s = profile.stats, l = levelFromXp(profile.xp);
    const kd = s.deaths ? (s.kills / s.deaths).toFixed(2) : String(s.kills);
    const acc = s.shots ? `${Math.round((s.hits / s.shots) * 100)}%` : '—';
    const mins = Math.round(s.seconds / 60);
    const next = UNLOCKS.find((u) => u.level > l.level);
    prof.innerHTML = `<h3>${m('ch.daily')}</h3>${challengeRows(profile.daily.items)}
      <h3>${m('ch.weekly')}</h3>${challengeRows(profile.weekly.items)}
      <h3>${m('st.title')}</h3><div class="stats">
        <div><b>${s.matches}</b>${m('st.matches')}</div><div><b>${s.wins}</b>${m('st.wins')}</div><div><b>${kd}</b>${m('st.kd')}</div>
        <div><b>${acc}</b>${m('st.acc')}</div><div><b>${s.headshots}</b>${m('st.head')}</div><div><b>${s.bestStreak}</b>${m('st.streak')}</div>
        <div><b>${mins} min</b>${m('st.time')}</div></div>
      <h3>${m('un.title')}</h3><p>${next ? esc(m('un.next', { n: next.level, name: m(`unlock.${next.id}` as never) })) : m('un.all')}</p>
      <h3>${m('lb.title')}</h3><div class="lb" data-lb>…</div>`;
    if (lastBoard !== undefined) paintBoard(lastBoard);
  };

  // Weekly online leaderboard (server data; names are escaped, wallets are short forms).
  let lastBoard: LeaderboardData | null | 'error' | undefined;
  const paintBoard = (b: LeaderboardData | null | 'error'): void => {
    const el = prof.querySelector<HTMLElement>('[data-lb]');
    if (!el) return;
    if (b === 'error' || b === null) { el.innerHTML = `<p>${m('lb.error')}</p>`; return; }
    if (!b.top.length) { el.innerHTML = `<p>${m('lb.empty')}</p>`; return; }
    const row = (r: LeaderboardData['top'][number], me = false): string =>
      `<div class="lb-r${me ? ' me' : ''}"><b>${r.rank}</b><span>${esc(r.name)}<small>${esc(r.wallet)}</small></span><em>${r.score} ${m('lb.pts')}</em></div>`;
    const mine = b.me && !b.top.some((r) => r.wallet === b.me!.wallet) ? `<div class="lb-gap">…</div>${row(b.me, true)}` : '';
    el.innerHTML = b.top.slice(0, 20).map((r) => row(r, !!b.me && r.wallet === b.me.wallet)).join('') + mine;
  };
  const loadBoard = async (): Promise<void> => {
    if (!hooks.leaderboard) return;
    try { lastBoard = await hooks.leaderboard(); } catch { lastBoard = 'error'; }
    paintBoard(lastBoard ?? null);
  };

  const renderSettings = (): void => {
    const st = profile.settings, lvl = levelFromXp(profile.xp).level;
    const opts = (kind: 'finish' | 'dot', cur: string): string => UNLOCKS.filter((u) => u.kind === kind).map((u) => {
      const ok = u.level <= lvl;
      const sw = kind === 'finish' ? hex(u.tint!) : hex(u.dot!);
      return `<button type="button" class="sw${u.id === cur ? ' on' : ''}" data-${kind}="${u.id}" ${ok ? '' : 'disabled'} title="${esc(m(`unlock.${u.id}` as never))}"><i style="background:${sw}"></i>${esc(m(`unlock.${u.id}` as never))}${ok ? '' : ` · ${m('set.locked', { n: u.level })}`}</button>`;
    }).join('');
    sett.innerHTML = `
      <label class="row">${m('set.look')} <input type="range" min="0.5" max="2" step="0.05" value="${st.lookSens}" data-set="lookSens"><output>${st.lookSens.toFixed(2)}</output></label>
      <label class="row">${m('set.aim')} <input type="range" min="0.5" max="2" step="0.05" value="${st.aimSens}" data-set="aimSens"><output>${st.aimSens.toFixed(2)}</output></label>
      <label class="row">${m('set.volume')} <input type="range" min="0" max="1" step="0.05" value="${st.volume}" data-set="volume"><output>${Math.round(st.volume * 100)}%</output></label>
      <label class="row chk"><input type="checkbox" data-set="aimAssist" ${st.aimAssist ? 'checked' : ''}> ${m('set.assist')}</label>
      <label class="row chk"><input type="checkbox" data-set="voiceOn" ${st.voiceOn ? 'checked' : ''}> ${m('set.voice')}</label>
      <label class="row">${m('set.voiceVol')} <input type="range" min="0" max="1" step="0.05" value="${st.voiceVolume}" data-set="voiceVolume"><output>${Math.round(st.voiceVolume * 100)}%</output></label>
      <label class="row">${m('set.diff')} <select data-set="difficulty">${(['recruit', 'regular', 'veteran'] as const).map((d) => `<option value="${d}"${d === st.difficulty ? ' selected' : ''}>${m(`set.diff.${d}`)}</option>`).join('')}</select></label>
      <div class="row col">${m('set.finish')}<div class="sws">${opts('finish', st.finish)}</div></div>
      <div class="row col">${m('set.dot')}<div class="sws">${opts('dot', st.dot)}</div></div>
      <label class="row">${m('set.callsign')} <input type="text" maxlength="16" data-callsign value="${esc(st.callsign)}" autocomplete="off" spellcheck="false"></label>
      <label class="row">${m('set.lang')} <select data-lang>${LANGS.map((l) => `<option value="${l}"${l === lang ? ' selected' : ''}>${NATIVE_NAMES[l]}</option>`).join('')}</select></label>
      <button type="button" class="ghost" data-tut>${m('set.tutorial')}</button>`;
  };

  const commit = (): void => { saveProfile(profile); hooks.onSettings(profile.settings); };
  sett.addEventListener('change', (e) => {
    const el = e.target as HTMLSelectElement;
    if (el.dataset.lang !== undefined && isLang(el.value) && el.value !== lang) chooseLang(el.value);
    if (el.dataset.callsign !== undefined) {
      const v = el.value.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16);
      if (v) { profile.settings.callsign = v; commit(); }
      el.value = profile.settings.callsign;
    }
  });
  sett.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    const k = el.dataset.set as keyof Settings | undefined;
    if (!k) return;
    const st = profile.settings as unknown as Record<string, unknown>;
    if (el.type === 'checkbox') st[k] = el.checked;
    else if (el.tagName === 'SELECT') st[k] = el.value;
    else { st[k] = Number(el.value); const out = el.nextElementSibling; if (out) out.textContent = k === 'volume' || k === 'voiceVolume' ? `${Math.round(Number(el.value) * 100)}%` : Number(el.value).toFixed(2); }
    commit();
  });
  sett.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.disabled) return;
    if (b.dataset.finish && unlockedAt(levelFromXp(profile.xp).level).some((u) => u.id === b.dataset.finish)) { profile.settings.finish = b.dataset.finish; commit(); renderSettings(); }
    if (b.dataset.dot && unlockedAt(levelFromXp(profile.xp).level).some((u) => u.id === b.dataset.dot)) { profile.settings.dot = b.dataset.dot; commit(); renderSettings(); }
    if (b.dataset.tut !== undefined) { profile.tutorialDone = false; saveProfile(profile); hooks.onReplayTutorial(); showTab('play'); }
  });

  const refresh = (): void => { renderHeader(); renderProfile(); renderSettings(); };
  refresh();
  showTab('play');
  return { refresh, showTab };
}
