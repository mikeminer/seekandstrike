/**
 * Builds the local player's MatchReport from sim events (pure; tested). Also produces the in-match score
 * popups ("+100 ABBATTUTO") so the HUD and the summary agree on every point.
 */
import type { SimEvent } from '@shared/sim/match';
import { type MatchReport, XP, emptyReport } from './progression';

export type { MatchReport };

export interface ScorePopup { xp: number; label: 'kill' | 'headshot' | 'grenade' | 'plant' | 'defuse' | 'revive' | 'resupply' | 'hit' }

export class MatchTracker {
  report: MatchReport = emptyReport();
  private streak = 0;
  private wasDead = false;

  constructor(private playerId: number, private playerTeam: 0 | 1) {}

  /** `aimed` = the player's ads value when the events happened. */
  onEvents(events: readonly SimEvent[], aimed: number): ScorePopup[] {
    const r = this.report, out: ScorePopup[] = [];
    for (const e of events) {
      switch (e.type) {
        case 'shot':
          if (e.shooter === this.playerId) r.shots++;
          break;
        case 'damage':
          if (e.attacker === this.playerId && e.victim !== this.playerId) {
            r.hits++;
            if (e.outcome === 'downed') {
              r.kills++;
              this.streak++;
              r.bestStreak = Math.max(r.bestStreak, this.streak);
              if (e.zone === 'head') { r.headshots++; out.push({ xp: XP.kill + XP.headshot, label: 'headshot' }); }
              else if (e.zone === 'blast') { r.grenadeKills++; out.push({ xp: XP.kill + XP.grenadeKill, label: 'grenade' }); }
              else out.push({ xp: XP.kill, label: 'kill' });
              if (aimed > 0.8 && e.zone !== 'blast') r.adsKills++;
            } else if (e.outcome === 'hurt') out.push({ xp: 0, label: 'hit' });
          }
          if (e.victim === this.playerId && e.outcome === 'downed') { r.deaths++; this.streak = 0; }
          break;
        case 'objective':
          if (e.event === 'planted' && e.by === this.playerId) { r.plants++; out.push({ xp: XP.plant, label: 'plant' }); }
          if (e.event === 'defused' && e.by === this.playerId) { r.defuses++; out.push({ xp: XP.defuse, label: 'defuse' }); }
          break;
        case 'resupply':
          if (e.giver === this.playerId && e.recipient !== this.playerId) { r.resupplies++; out.push({ xp: XP.resupply, label: 'resupply' }); }
          break;
        case 'revive':
          if (e.medic === this.playerId) { r.revives++; out.push({ xp: XP.revive, label: 'revive' }); }
          break;
        case 'matchEnd':
          r.completed = true;
          r.won = e.winner === this.playerTeam;
          break;
      }
    }
    return out;
  }

  /** Called per frame: play time while the round runs, and the streak resets on death by other causes (sea). */
  tick(dt: number, playing: boolean, dead: boolean): void {
    if (playing) this.report.seconds += dt;
    if (dead && !this.wasDead) this.streak = 0;
    this.wasDead = dead;
  }
}
