/** UI strings of the meta layer (profile, challenges, settings, summary, tutorial). Italian default, English fallback. */
import { locale } from '../ui/i18n';
import { PACKS } from '../i18n/packs';

const IT = {
  'tab.play': 'Gioca', 'tab.profile': 'Profilo', 'tab.settings': 'Impostazioni',
  'free.available': 'Partita gratuita di oggi disponibile: gioca senza Daily Pass.',
  'free.used': 'Hai già usato la partita gratuita di oggi. Con il Daily Pass giochi senza limiti.',
  'free.play': 'Gioca la partita gratuita',
  'lvl': 'Livello', 'xp': 'XP',
  'ch.daily': 'Sfide di oggi', 'ch.weekly': 'Sfide della settimana', 'ch.done': 'completata',
  'ch.kills': 'Abbatti {n} nemici', 'ch.headshots': '{n} abbattimenti alla testa', 'ch.adsKills': '{n} abbattimenti mirando nel red dot',
  'ch.grenadeKills': '{n} abbattimenti con le granate', 'ch.plants': 'Piazza la carica {n} volte', 'ch.defuses': 'Disinnesca {n} volte',
  'ch.revives': 'Rianima {n} compagni', 'ch.plants.1': 'Piazza la carica', 'ch.defuses.1': 'Disinnesca la carica', 'ch.wins.1': 'Vinci una partita', 'ch.revives.note': '(classe Medico)', 'ch.wins': 'Vinci {n} partite', 'ch.matches': 'Completa {n} partite',
  'st.title': 'Statistiche', 'st.matches': 'Partite', 'st.wins': 'Vittorie', 'st.kd': 'Abbattimenti / morti', 'st.acc': 'Precisione',
  'st.head': 'Colpi alla testa', 'st.streak': 'Serie migliore', 'st.time': 'Tempo di gioco',
  'un.title': 'Sblocchi', 'un.next': 'Prossimo sblocco al livello {n}: {name}', 'un.all': 'Tutto sbloccato',
  'set.look': 'Sensibilità visuale', 'set.aim': 'Sensibilità in mira', 'set.assist': 'Aiuto alla mira (touch)', 'set.volume': 'Volume',
  'set.diff': 'Difficoltà dei bot', 'set.diff.recruit': 'Recluta', 'set.diff.regular': 'Regolare', 'set.diff.veteran': 'Veterano',
  'set.finish': 'Finitura del fucile', 'set.dot': 'Colore del punto', 'set.tutorial': 'Rifai il tutorial', 'set.locked': 'liv. {n}',
  'sum.xp': 'XP guadagnati', 'sum.levelUp': 'NUOVO LIVELLO {n} — {rank}', 'sum.unlocked': 'Sbloccato: {name}', 'sum.challenge': 'Sfida completata: {name}',
  'sum.again': 'Gioca ancora', 'sum.menu': 'Menu',
  'xl.kills': 'Abbattimenti ×{n}', 'xl.headshots': 'Colpi alla testa ×{n}', 'xl.grenadeKills': 'Abbattimenti con granata ×{n}', 'xl.plants': 'Carica piazzata ×{n}',
  'xl.defuses': 'Carica disinnescata ×{n}', 'xl.revives': 'Rianimazioni ×{n}', 'xl.win': 'Vittoria', 'xl.completed': 'Partita completata', 'xl.time': 'Minuti in campo ×{n}', 'xl.challenges': 'Sfide completate ×{n}',
  'pop.kill': 'ABBATTUTO', 'pop.headshot': 'COLPO ALLA TESTA', 'pop.grenade': 'GRANATA', 'pop.plant': 'CARICA PIAZZATA', 'pop.defuse': 'DISINNESCATA', 'pop.revive': 'RIANIMATO',
  'tut.move': 'Muoviti: trascina lo stick a sinistra (WASD su PC)', 'tut.look': 'Guardati intorno: trascina il dito a destra (mouse su PC)',
  'tut.aim': 'Premi MIRA per guardare nel red dot (tasto destro su PC)', 'tut.fire': 'Spara: premi FUOCO (clic sinistro su PC)',
  'tut.obj': 'Obiettivo: raggiungi il rombo giallo e tieni AZIONE per piazzare la carica', 'tut.done': 'Pronto! Vinci piazzando la carica o resistendo fino alla fine.',
  'tut.skip': 'Salta', 'set.lang': 'Lingua',
  'set.voice': 'Voce di squadra (online, tieni premuto PARLA o V)', 'set.voiceVol': 'Volume voce', 'voice.denied': 'Microfono non autorizzato: consentilo nelle impostazioni del telefono per parlare con la squadra.',
  'lb.title': 'Classifica settimanale (online)',
  'lb.empty': 'Ancora nessun round online questa settimana. Gioca online con il Daily Pass per entrare in classifica.',
  'lb.error': 'Classifica non disponibile al momento.',
  'lb.pts': 'pt',
  'set.callsign': 'Nome in partita (online)',
  'rank.0': 'Recluta', 'rank.1': 'Soldato', 'rank.2': 'Caporale', 'rank.3': 'Caporalmaggiore', 'rank.4': 'Sergente', 'rank.5': 'Sergente maggiore',
  'rank.6': 'Maresciallo', 'rank.7': 'Sottotenente', 'rank.8': 'Tenente', 'rank.9': 'Capitano', 'rank.10': 'Maggiore',
  'unlock.finish.std': 'Standard', 'unlock.dot.red': 'Punto rosso', 'unlock.finish.sand': 'Sabbia', 'unlock.dot.green': 'Punto verde',
  'unlock.finish.olive': 'Oliva', 'unlock.finish.slate': 'Ardesia', 'unlock.dot.amber': 'Punto ambra', 'unlock.finish.night': 'Notte',
  'unlock.dot.cyan': 'Punto ciano', 'unlock.finish.bronze': 'Bronzo', 'unlock.finish.gold': 'Oro opaco',
} as const;
type K = keyof typeof IT;
const EN: Record<K, string> = {
  'tab.play': 'Play', 'tab.profile': 'Profile', 'tab.settings': 'Settings',
  'free.available': "Today's free match is available: play without a Daily Pass.",
  'free.used': "You already used today's free match. With a Daily Pass you play without limits.",
  'free.play': 'Play the free match',
  'lvl': 'Level', 'xp': 'XP',
  'ch.daily': "Today's challenges", 'ch.weekly': "This week's challenges", 'ch.done': 'done',
  'ch.kills': 'Take down {n} enemies', 'ch.headshots': '{n} headshot takedowns', 'ch.adsKills': '{n} takedowns aiming through the red dot',
  'ch.grenadeKills': '{n} grenade takedowns', 'ch.plants': 'Plant the charge {n} times', 'ch.defuses': 'Defuse {n} times',
  'ch.revives': 'Revive {n} teammates', 'ch.plants.1': 'Plant the charge', 'ch.defuses.1': 'Defuse the charge', 'ch.wins.1': 'Win a match', 'ch.revives.note': '(Medic class)', 'ch.wins': 'Win {n} matches', 'ch.matches': 'Complete {n} matches',
  'st.title': 'Stats', 'st.matches': 'Matches', 'st.wins': 'Wins', 'st.kd': 'Takedowns / deaths', 'st.acc': 'Accuracy',
  'st.head': 'Headshots', 'st.streak': 'Best streak', 'st.time': 'Time played',
  'un.title': 'Unlocks', 'un.next': 'Next unlock at level {n}: {name}', 'un.all': 'Everything unlocked',
  'set.look': 'Look sensitivity', 'set.aim': 'Aim sensitivity', 'set.assist': 'Aim assist (touch)', 'set.volume': 'Volume',
  'set.diff': 'Bot difficulty', 'set.diff.recruit': 'Recruit', 'set.diff.regular': 'Regular', 'set.diff.veteran': 'Veteran',
  'set.finish': 'Rifle finish', 'set.dot': 'Dot colour', 'set.tutorial': 'Replay the tutorial', 'set.locked': 'lvl {n}',
  'sum.xp': 'XP earned', 'sum.levelUp': 'NEW LEVEL {n} — {rank}', 'sum.unlocked': 'Unlocked: {name}', 'sum.challenge': 'Challenge complete: {name}',
  'sum.again': 'Play again', 'sum.menu': 'Menu',
  'xl.kills': 'Takedowns ×{n}', 'xl.headshots': 'Headshots ×{n}', 'xl.grenadeKills': 'Grenade takedowns ×{n}', 'xl.plants': 'Charge planted ×{n}',
  'xl.defuses': 'Charge defused ×{n}', 'xl.revives': 'Revives ×{n}', 'xl.win': 'Victory', 'xl.completed': 'Match completed', 'xl.time': 'Minutes in the field ×{n}', 'xl.challenges': 'Challenges completed ×{n}',
  'pop.kill': 'TAKEDOWN', 'pop.headshot': 'HEADSHOT', 'pop.grenade': 'GRENADE', 'pop.plant': 'CHARGE PLANTED', 'pop.defuse': 'DEFUSED', 'pop.revive': 'REVIVED',
  'tut.move': 'Move: drag the left stick (WASD on PC)', 'tut.look': 'Look around: drag on the right (mouse on PC)',
  'tut.aim': 'Press AIM to look through the red dot (right click on PC)', 'tut.fire': 'Fire: press FIRE (left click on PC)',
  'tut.obj': 'Objective: reach the yellow diamond and hold ACTION to plant the charge', 'tut.done': 'Ready! Win by planting the charge or holding out to the end.',
  'tut.skip': 'Skip', 'set.lang': 'Language',
  'set.voice': 'Team voice (online, hold TALK or V)', 'set.voiceVol': 'Voice volume', 'voice.denied': 'Microphone not allowed: enable it in the phone settings to talk to your team.',
  'lb.title': 'Weekly leaderboard (online)',
  'lb.empty': 'No online rounds yet this week. Play online with your Daily Pass to get on the board.',
  'lb.error': 'Leaderboard unavailable right now.',
  'lb.pts': 'pts',
  'set.callsign': 'Callsign (online)',
  'rank.0': 'Recruit', 'rank.1': 'Private', 'rank.2': 'Corporal', 'rank.3': 'Lance Corporal', 'rank.4': 'Sergeant', 'rank.5': 'Staff Sergeant',
  'rank.6': 'Warrant Officer', 'rank.7': 'Second Lieutenant', 'rank.8': 'Lieutenant', 'rank.9': 'Captain', 'rank.10': 'Major',
  'unlock.finish.std': 'Standard', 'unlock.dot.red': 'Red dot', 'unlock.finish.sand': 'Sand', 'unlock.dot.green': 'Green dot',
  'unlock.finish.olive': 'Olive', 'unlock.finish.slate': 'Slate', 'unlock.dot.amber': 'Amber dot', 'unlock.finish.night': 'Night',
  'unlock.dot.cyan': 'Cyan dot', 'unlock.finish.bronze': 'Bronze', 'unlock.finish.gold': 'Matte gold',
};
export const META_COPY = { it: IT, en: EN };

export function m(key: K, vars?: Record<string, string | number>): string {
  const l = locale();
  let s: string = l === 'it' ? IT[key] : l === 'en' ? EN[key] : (PACKS[l]?.meta[key] ?? EN[key]);
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v));
  return s;
}
export type MetaKey = K;

/** Challenge text with the singular form when the goal is 1. */
export function challengeText(stat: string, goal: number): string {
  const one = `ch.${stat}.1`;
  const base = goal === 1 && one in IT ? m(one as K) : m(`ch.${stat}` as K, { n: goal });
  return stat === 'revives' ? `${base} ${m('ch.revives.note')}` : base;
}
