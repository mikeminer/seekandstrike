import './ui/style.css';
import { GAME_LOGO_PATH, GAME_TAGLINE, GAME_TITLE, ONLINE } from '@shared/config';
import { createRenderer } from './render/renderer';
import { Game } from './game/game';
import { DEFAULT_MAP, MAPS, isMapId, type MapId } from './game/mapLoader';
import { t } from './ui/i18n';
import { installAutomation } from './dev/automation';

import { createPass } from './pass/ui/setup';
import { mountSponsorCard } from './sponsor/card';
import type { PlayerClass } from '@shared/sim/etClasses';
import { loadProfile, saveProfile, freeMatchAvailable, useFreeMatch } from './meta/profileStore';
import { applyMatch } from './meta/progression';
import { mountMetaMenu } from './meta/menuPanels';
import { summaryHtml } from './meta/summary';
import { Tutorial } from './meta/tutorial';
import { m as mt } from './meta/strings';

/**
 * Entry: main menu → Daily Pass gate → offline match.
 * The Daily Pass unlocks unlimited play and online. Without it, one free offline match per day
 * (owner decision 2026-11-02, replacing brief §9 "the entire game behind the pass"). Unlimited play
 * is enabled only while the on-chain pass read says it is active. Development builds (`vite` /
 * `--mode devbypass`) compile a clearly labelled bypass, disabled when `?mockpass=` is used so the
 * real gate is exercised against the mock wallet.
 */
const app = document.getElementById('app');
if (!app) throw new Error('Missing #app');
document.title = GAME_TITLE;
const esc = (x: string): string => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const params = new URLSearchParams(location.search);
const isTouch = params.has('touch') || matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;

const mockPass = __DEV_PASS_BYPASS__ && params.has('mockpass');
let passOpen = false;
/** Daily Pass gate: the verified on-chain pass (or the DEV bypass, never in release builds). */
function passActive(): boolean {
  if (__DEV_PASS_BYPASS__ && !mockPass) return true;
  return passOpen;
}

/** Online server origin: from config, or (development builds only) from ?online=ws://host:port. */
const onlineCandidate: string | null = ONLINE.wsUrl ?? (__DEV_PASS_BYPASS__ ? params.get('online') : null);
const onlineBase = onlineCandidate && /^wss?:\/\/[\w.-]+(:\d+)?$/.test(onlineCandidate) ? onlineCandidate : null;
const roomParam = params.get('room') ?? '';
const onlineRoom = /^[a-z0-9-]{4,32}$/.test(roomParam) ? roomParam : ONLINE.defaultRoom;
const onlineName = (params.get('name') ?? '').replace(/[^\p{L}\p{N} _.-]/gu, '').slice(0, 16) || `Player${Math.floor(Math.random() * 900 + 100)}`;

/** Chosen class (remembered between visits; a failure to read it falls back to Soldier). */
const CLASS_KEY = 'seekstrike.class';
const readClass = (): PlayerClass => { try { const v = Number(localStorage.getItem(CLASS_KEY)); return (v >= 0 && v < 5 ? v : 0) as PlayerClass; } catch { return 0; } };
let chosenClass = readClass();
let classDirty = false;

/** Chosen map (remembered; changing it reloads the page because the map is built at start-up). */
const MAP_KEY = 'seekstrike.map';
const readMap = (): MapId => {
  const fromUrl = params.get('map');
  if (isMapId(fromUrl)) return fromUrl;
  try { const v = localStorage.getItem(MAP_KEY); return isMapId(v) ? v : DEFAULT_MAP; } catch { return DEFAULT_MAP; }
};
const chosenMap = readMap();
const mapInfo = MAPS[chosenMap];

const menu = document.createElement('div');
menu.className = 'menu';
menu.innerHTML = `<div class="card">
  <div class="logo" aria-label="${esc(GAME_TITLE)}">${GAME_LOGO_PATH
    ? `<img src="${import.meta.env.BASE_URL}${GAME_LOGO_PATH}" alt="${esc(GAME_TITLE)}">`
    : `<h1>${esc(GAME_TITLE).replace('&amp;', '<span class="amp">&amp;</span>')}</h1>`}</div>
  ${GAME_LOGO_PATH ? '' : `<div class="tagline">${esc(GAME_TAGLINE)}</div>`}
  <p>${t('menu.subtitle')}</p>
  <div class="gate"><b>${t('menu.passRequired')}</b><br>${t('menu.passInfo')}</div>
  <div data-pass></div>
  <div class="free" data-free hidden></div>
  <div data-dev></div>
  <label class="classpick">${t('menu.map')} <select data-map>${(Object.keys(MAPS) as MapId[]).map((id) => `<option value="${id}"${id === chosenMap ? ' selected' : ''}>${t(MAPS[id].nameKey as never)}</option>`).join('')}</select></label>
  <div class="small classdesc">${mapInfo.online ? '' : t('map.offlineOnly')}${mapInfo.attribution ? ` ${esc(mapInfo.attribution)}` : ''}</div>
  <label class="classpick">${t('menu.class')} <select data-class>${[0, 1, 2, 3, 4].map((i) => `<option value="${i}"${i === chosenClass ? ' selected' : ''}>${t(`class.${i}` as never)}</option>`).join('')}</select></label>
  <div class="small classdesc" data-classdesc></div>
  <button data-play disabled>${t('menu.play')}</button>
  ${onlineBase && mapInfo.online ? `<button data-online disabled>${t('menu.online')}</button>` : ''}
  <div class="load" data-load></div>
  <p>${isTouch ? t('menu.controlsTouch') : t('menu.controlsDesktop')}</p>
  <div data-sponsor></div>
</div>`;
document.body.appendChild(menu);
const playBtn = menu.querySelector<HTMLButtonElement>('[data-play]')!;
const classSel = menu.querySelector<HTMLSelectElement>('[data-class]')!;
menu.querySelector<HTMLSelectElement>('[data-map]')!.addEventListener('change', (e) => {
  const v = (e.target as HTMLSelectElement).value;
  if (!isMapId(v) || v === chosenMap) return;
  try { localStorage.setItem(MAP_KEY, v); } catch { /* storage unavailable */ }
  const url = new URL(location.href);
  url.searchParams.set('map', v);
  location.replace(url.toString());
});
const classDesc = menu.querySelector<HTMLElement>('[data-classdesc]')!;
const showClassDesc = (): void => { classDesc.textContent = t(`class.${classSel.value}.d` as never); };
showClassDesc();
classSel.addEventListener('change', () => {
  chosenClass = Number(classSel.value) as PlayerClass;
  classDirty = true;
  showClassDesc();
  try { localStorage.setItem(CLASS_KEY, String(chosenClass)); } catch { /* storage unavailable: choice lasts for this visit */ }
  game.setPlayerClass(chosenClass);
});
// Sponsor card: main menu only (never gameplay, pass or checkout); fetched lazily on the first menu view.
mountSponsorCard(menu.querySelector<HTMLElement>('[data-sponsor]')!);
const loadEl = menu.querySelector<HTMLElement>('[data-load]')!;
if (__DEV_PASS_BYPASS__) {
  menu.querySelector<HTMLElement>('[data-dev]')!.innerHTML = mockPass
    ? '<span class="dev">DEV BUILD · Mock wallet: nessuna firma, nessun invio / no signing, no sending</span>'
    : '<span class="dev">DEV BUILD · Daily Pass bypass attivo / active — non per release</span>';
}
// Profile: progression, challenges, settings (device storage).
const profile = loadProfile();
const freeEl = menu.querySelector<HTMLElement>('[data-free]')!;
/** True while the current match is the free one of the day (no pass). */
let freeRun = false;
const canPlay = (): boolean => passActive() || freeMatchAvailable(profile);
const metaMenu = mountMetaMenu(menu.querySelector<HTMLElement>('.card')!, profile, {
  onSettings: (st) => game.applySettings(st),
  onReplayTutorial: () => { /* profile.tutorialDone is now false: the next match shows it */ },
});

let loaded = false;
const gateEl = menu.querySelector<HTMLElement>('.gate');
const onlineBtn = menu.querySelector<HTMLButtonElement>('[data-online]');
const syncPlay = (): void => {
  const pass = passActive();
  const free = !pass && freeMatchAvailable(profile);
  playBtn.disabled = !(loaded && canPlay());
  playBtn.textContent = free ? mt('free.play') : t('menu.play');
  if (onlineBtn) onlineBtn.disabled = !(loaded && pass);
  if (gateEl) gateEl.hidden = pass;
  freeEl.hidden = pass;
  freeEl.textContent = free ? mt('free.available') : mt('free.used');
};
const passApp = createPass(params, (open) => { passOpen = open; syncPlay(); });

void passApp.then((p) => { menu.querySelector('[data-pass]')!.replaceWith(p.panel.el); });

const renderer = createRenderer(app);
const game = new Game(renderer, app, {
  seed: Number(params.get('seed') ?? 0) || (Date.now() >>> 0),
  attackers: 5, defenders: 6, touch: isTouch, debug: params.has('debug') || __DEV_PASS_BYPASS__, playerClass: chosenClass, mapId: chosenMap,
});
game.applySettings(profile.settings);
game.onMatchEnd = (report) => {
  const res = applyMatch(profile, report, new Date());
  saveProfile(profile);
  metaMenu.refresh();
  game.showSummary(summaryHtml(res), mt('sum.menu'), mt('sum.again'));
  if (res.after.level > res.before.level) game.sfx.levelUp(); else if (res.completedChallenges.length) game.sfx.challenge();
};
game.onTutorialDone = () => { profile.tutorialDone = true; saveProfile(profile); };
game.onMenu = () => showMenu();
const resize = (): void => game.resize(app.clientWidth, app.clientHeight);
window.addEventListener('resize', resize);
resize();

game.load((f) => { loadEl.textContent = `${t('menu.loading')} ${Math.round(f * 100)}%`; })
  .then(() => {
    loaded = true;
    loadEl.textContent = '';
    syncPlay();
    if (__DEV_PASS_BYPASS__) {
      installAutomation(game, () => playBtn.click());
    }
  })
  .catch((e: unknown) => { loadEl.textContent = 'Errore di caricamento / load error'; console.error(e); });

playBtn.addEventListener('click', () => {
  if (!loaded || !canPlay()) return;
  freeRun = !passActive();
  if (freeRun) { useFreeMatch(profile); needsNewMatch = true; }
  if (!profile.tutorialDone) game.tutorial = new Tutorial();
  game.sfx.unlock();
  menu.remove();
  resize();
  if (classDirty) { classDirty = false; needsNewMatch = true; }
  if (needsNewMatch) { needsNewMatch = false; restartRound(); }
  game.start();
  if (!isTouch) void renderer.domElement.requestPointerLock?.();
});

/** Online: join the authoritative room; the server decides (it refuses everyone until it can verify the Daily Pass). */
onlineBtn?.addEventListener('click', async () => {
  if (!loaded || !passActive() || !onlineBase) return;
  onlineBtn.disabled = true;
  playBtn.disabled = true;
  loadEl.textContent = t('menu.connecting');
  try {
    game.setPlayerClass(chosenClass);
    // The server asks the wallet to prove the Daily Pass (a signed text, never a transaction) and reads the chain itself.
    const pass = await passApp;
    const sign = async (text: string): Promise<string | null> => {
      loadEl.textContent = t('online.signing');
      const r = await pass.session.signMessage(new TextEncoder().encode(text));
      loadEl.textContent = t('menu.connecting');
      return r.ok ? btoa(String.fromCharCode(...r.signature)) : null;
    };
    await game.connectOnline({ baseUrl: onlineBase, room: onlineRoom, name: onlineName, ...(pass.flow.wallet ? { wallet: pass.flow.wallet, sign } : {}) });
  } catch (e) {
    const code = e instanceof Error ? e.message : 'socket';
    const key: Record<string, string> = {
      pass_required: 'online.err.pass', bad_version: 'online.err.version', socket: 'online.err.socket', wallet: 'online.err.wallet',
      proof_invalid: 'online.err.proof', proof_expired: 'online.err.proof', pass_unavailable: 'online.err.unavail',
      pass_expired: 'online.err.expired', rate_limited: 'online.err.busy',
    };
    loadEl.textContent = t((key[code] ?? 'online.err.full') as Parameters<typeof t>[0]);
    syncPlay();
    return;
  }
  loadEl.textContent = '';
  classDirty = false;
  game.sfx.unlock();
  menu.remove();
  resize();
  game.start();
  if (!isTouch) void renderer.domElement.requestPointerLock?.();
});

/** Back to the menu (pass ended between rounds): stop the match and re-read the pass. */
let needsNewMatch = false;
function showMenu(): void {
  needsNewMatch = true;
  game.stop();
  document.exitPointerLock?.();
  if (!menu.isConnected) document.body.appendChild(menu);
  metaMenu.refresh();
  syncPlay();
  void passApp.then((p) => p.flow.refresh());
}
// A new round needs a live pass; the current round is never interrupted.
const restartRound = game.restart.bind(game);
game.restart = (): void => { if (passActive()) restartRound(); else { freeRun = false; showMenu(); } };

// Re-read the pass when the app comes back to the front (expiry, a pass bought elsewhere).
document.addEventListener('visibilitychange', () => {
  if (document.hidden || !menu.isConnected) return;
  void passApp.then((p) => { if (p.flow.wallet && (p.flow.view.step === 'active' || p.flow.view.step === 'offer')) void p.flow.refresh(); });
});

// Pause while hidden; never replay hidden time on resume.
document.addEventListener('visibilitychange', () => {
  if (!loaded || menu.isConnected) return;
  if (document.hidden) game.stop(); else game.start();
});
renderer.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); game.stop(); });
renderer.domElement.addEventListener('webglcontextrestored', () => location.reload());
window.addEventListener('pagehide', () => { game.dispose(); renderer.dispose(); });
