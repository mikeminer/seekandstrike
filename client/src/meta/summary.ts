/** End-of-match summary (HTML for the HUD end overlay): XP lines, level bar, level-up, unlocks, completed challenges. */
import { challengeText, m } from './strings';
import { type MatchResult, rankIndex } from './progression';

const esc = (x: string): string => x.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function summaryHtml(r: MatchResult): string {
  const lines = r.lines.map((l) => `<div class="sl"><span>${esc(m(`xl.${l.key}`, { n: l.count ?? 1 }))}</span><b>+${l.xp}</b></div>`).join('');
  const a = r.after;
  const pct = a.need ? Math.round((a.into / a.need) * 100) : 100;
  const up = a.level > r.before.level ? `<div class="lvlup">${esc(m('sum.levelUp', { n: a.level, rank: m(`rank.${rankIndex(a.level)}` as never) }))}</div>` : '';
  const un = r.unlocked.map((u) => `<div class="unl">${esc(m('sum.unlocked', { name: m(`unlock.${u.id}` as never) }))}</div>`).join('');
  const ch = r.completedChallenges.map((c) => `<div class="chd">${esc(m('sum.challenge', { name: challengeText(c.stat, c.goal) }))}</div>`).join('');
  return `<div class="summary"><div class="sl tot"><span>${m('sum.xp')}</span><b>+${r.xpGained}</b></div>${lines}
    ${up}<div class="sum-lvl"><b>${a.level}</b><div class="mh-bar"><i style="width:${pct}%"></i></div><span>${a.need ? `${a.into}/${a.need}` : 'MAX'}</span></div>${ch}${un}</div>`;
}
