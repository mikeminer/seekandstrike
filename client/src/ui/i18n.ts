/** Minimal i18n (it default, en fallback). Locales are listed in shared PENDING_DEFAULTS. */
const IT = {
  'menu.subtitle': 'Offline contro bot · Banchina Est',
  'menu.play': 'Gioca (offline vs bot)',
  'menu.passRequired': 'Daily Pass richiesto',
  'menu.passInfo': 'Tutto il gioco, incluso l\'offline contro i bot, richiede un Daily Pass attivo.',
  'menu.controlsDesktop': 'WASD muovi · Mouse mira · Clic sinistro fuoco · Clic destro mira di precisione · R ricarica · Shift scatto · Spazio salto · C accovacciato · Z a terra · E (tieni) piazza/disinnesca · F arrenditi da ferito · Invio ricomincia',
  'menu.controlsTouch': 'Stick sinistro muovi · trascina a destra per guardare · pulsanti FUOCO, MIRA, RICARICA, SALTO, ACCOV., A TERRA, AZIONE',
  'menu.loading': 'Caricamento',
  'menu.sponsor': 'Sponsor',
  'sponsor.paid': 'Spazio sponsorizzato',
  'sponsor.empty': 'YOUR AD HERE',
  'sponsor.disclaimer': 'Pubblicità a pagamento, non è un consiglio di investimento.',
  'btn.fire': 'FUOCO', 'btn.ads': 'MIRA', 'btn.reload': 'RICAR.', 'btn.jump': 'SALTO', 'btn.crouch': 'ACCOV.', 'btn.prone': 'A TERRA',
  'btn.interact': 'AZIONE', 'btn.tapout': 'ARRENDITI', 'btn.grenade': 'GRANATA',
  'hud.grenades': 'Granate', 'hud.reviving': 'Rianimazione…', 'hud.revived': '{a} rianima {b}',
  'menu.online': 'Gioca online', 'menu.connecting': 'Connessione…', 'online.err.pass': 'Online: serve un Daily Pass attivo sul wallet collegato.', 'online.signing': 'Conferma la firma nel wallet…', 'online.err.wallet': 'Firma del wallet non completata.', 'online.err.proof': 'Prova del wallet non valida o scaduta: riprova.', 'online.err.unavail': 'Verifica del Daily Pass non disponibile: riprova tra poco.', 'online.err.expired': 'Il Daily Pass è scaduto: sei uscito dalla stanza.', 'online.err.busy': 'Troppi tentativi: attendi un minuto.', 'online.err.full': 'Stanza piena o non disponibile.', 'online.err.socket': 'Server non raggiungibile.', 'online.err.version': 'Versione del server non compatibile.', 'online.reconnecting': 'Connessione persa: riconnessione…', 'online.lost': 'Connessione al server persa.',
  'menu.class': 'Classe', 'class.0': 'Soldato', 'class.1': 'Medico', 'class.2': 'Geniere', 'class.3': 'Operatore', 'class.4': 'Incursore',
  'class.0.d': '3 granate', 'class.1.d': 'rianima i compagni · rigenera fino a 100 · 1 granata', 'class.2.d': 'pianta e disinnesca più in fretta · 2 granate', 'class.3.d': '4 granate', 'class.4.d': 'più fiato nello scatto · 1 granata',
  'hud.attack': 'ATTACCO', 'hud.defend': 'DIFESA',
  'hud.objPlant': 'Piazza la carica nel bunker', 'hud.objArmed': 'Carica innescata — difendila!',
  'hud.planting': 'Piazzamento…', 'hud.defusing': 'Il nemico sta disinnescando!',
  'hud.holdInteract': 'Tieni E / AZIONE per piazzare la carica',
  'hud.downed': 'FERITO', 'hud.downedHint': 'Attendi un compagno o arrenditi (F) per l\'ondata successiva',
  'hud.dead': 'In attesa di rinforzi', 'hud.wave': 'Rinforzi tra',
  'hud.reloading': 'Ricarica…',
  'end.win': 'VITTORIA', 'end.loss': 'SCONFITTA',
  'end.detonated': 'La carica ha distrutto l\'obiettivo.', 'end.defused': 'La carica è stata disinnescata.',
  'end.time': 'Tempo scaduto: la difesa ha tenuto.', 'end.restart': 'Ricomincia (Invio)', 'end.next': 'Prossimo round tra {s} s',
  'end.stats': 'Abbattimenti {k} · Morti {d}',
  'blockout': 'BLOCKOUT: mappa provvisoria (geometria a blocchi)',
} as const;

type Key = keyof typeof IT;
const EN: Record<Key, string> = {
  'menu.subtitle': 'Offline vs bots · East Quay',
  'menu.play': 'Play (offline vs bots)',
  'menu.passRequired': 'Daily Pass required',
  'menu.passInfo': 'The whole game, including offline vs bots, requires an active Daily Pass.',
  'menu.controlsDesktop': 'WASD move · Mouse look · LMB fire · RMB aim · R reload · Shift sprint · Space jump · C crouch · Z prone · Hold E plant/defuse · F tap out when downed · Enter restart',
  'menu.controlsTouch': 'Left stick move · drag right side to look · FIRE, AIM, RELOAD, JUMP, CROUCH, PRONE, ACTION buttons',
  'menu.loading': 'Loading', 'menu.sponsor': 'Sponsor',
  'sponsor.paid': 'Paid placement',
  'sponsor.empty': 'YOUR AD HERE',
  'sponsor.disclaimer': 'Paid advertising, not investment advice.',
  'btn.fire': 'FIRE', 'btn.ads': 'AIM', 'btn.reload': 'RELOAD', 'btn.jump': 'JUMP', 'btn.crouch': 'CROUCH', 'btn.prone': 'PRONE',
  'btn.interact': 'ACTION', 'btn.tapout': 'TAP OUT', 'btn.grenade': 'GRENADE',
  'hud.grenades': 'Grenades', 'hud.reviving': 'Reviving…', 'hud.revived': '{a} revives {b}',
  'menu.online': 'Play online', 'menu.connecting': 'Connecting…', 'online.err.pass': 'Online needs an active Daily Pass on the connected wallet.', 'online.signing': 'Confirm the signature in your wallet…', 'online.err.wallet': 'Wallet signature not completed.', 'online.err.proof': 'Wallet proof invalid or expired: try again.', 'online.err.unavail': 'Daily Pass check unavailable: try again shortly.', 'online.err.expired': 'Your Daily Pass expired: you left the room.', 'online.err.busy': 'Too many attempts: wait a minute.', 'online.err.full': 'Room full or unavailable.', 'online.err.socket': 'Server unreachable.', 'online.err.version': 'Incompatible server version.', 'online.reconnecting': 'Connection lost: reconnecting…', 'online.lost': 'Lost connection to the server.',
  'menu.class': 'Class', 'class.0': 'Soldier', 'class.1': 'Medic', 'class.2': 'Engineer', 'class.3': 'Field Ops', 'class.4': 'Covert Ops',
  'class.0.d': '3 grenades', 'class.1.d': 'revives teammates · regenerates to 100 · 1 grenade', 'class.2.d': 'plants and defuses faster · 2 grenades', 'class.3.d': '4 grenades', 'class.4.d': 'more sprint stamina · 1 grenade',
  'hud.attack': 'ATTACK', 'hud.defend': 'DEFENCE',
  'hud.objPlant': 'Plant the charge in the bunker', 'hud.objArmed': 'Charge armed — defend it!',
  'hud.planting': 'Planting…', 'hud.defusing': 'Enemy is defusing!',
  'hud.holdInteract': 'Hold E / ACTION to plant the charge',
  'hud.downed': 'DOWNED', 'hud.downedHint': 'Wait for a teammate or tap out (F) for the next wave',
  'hud.dead': 'Waiting for reinforcements', 'hud.wave': 'Reinforcements in',
  'hud.reloading': 'Reloading…',
  'end.win': 'VICTORY', 'end.loss': 'DEFEAT',
  'end.detonated': 'The charge destroyed the objective.', 'end.defused': 'The charge was defused.',
  'end.time': 'Time expired: the defence held.', 'end.restart': 'Restart (Enter)', 'end.next': 'Next round in {s} s',
  'end.stats': 'Kills {k} · Deaths {d}',
  'blockout': 'BLOCKOUT: provisional map (box geometry)',
};

let lang: 'it' | 'en' = (typeof navigator !== 'undefined' && navigator.language?.startsWith('it')) || typeof navigator === 'undefined' ? 'it' : 'en';
const q = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('lang') : null;
if (q === 'it' || q === 'en') lang = q;

export const locale = (): 'it' | 'en' => lang;
export function t(key: Key, vars?: Record<string, string | number>): string {
  let s: string = lang === 'it' ? IT[key] : EN[key];
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
