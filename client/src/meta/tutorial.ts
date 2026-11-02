/**
 * First-match tutorial (about 60 s): one prompt at a time, each cleared by doing it.
 * Pure state machine (tested); the HUD only shows `text`.
 */
import type { MetaKey } from './strings';

export interface TutorialSample { moved: number; looked: number; ads: number; shots: number; nearObjective: boolean; planting: boolean }

const STEPS: { key: MetaKey; done: (s: TutorialSample, base: TutorialSample) => boolean }[] = [
  { key: 'tut.move', done: (s, b) => s.moved - b.moved > 4 },
  { key: 'tut.look', done: (s, b) => s.looked - b.looked > 1.2 },
  { key: 'tut.aim', done: (s) => s.ads > 0.95 },
  { key: 'tut.fire', done: (s, b) => s.shots - b.shots >= 3 },
  { key: 'tut.obj', done: (s) => s.planting || s.nearObjective },
];

export class Tutorial {
  private i = 0;
  private base: TutorialSample | null = null;
  private outro = 0;
  finished = false;

  /** Advances on the sample; returns the prompt to show (null when finished). */
  step(s: TutorialSample, dt: number): MetaKey | null {
    if (this.finished) return null;
    if (this.i >= STEPS.length) {
      this.outro += dt;
      if (this.outro > 4) this.finished = true;
      return this.finished ? null : 'tut.done';
    }
    if (!this.base) this.base = { ...s };
    if (STEPS[this.i]!.done(s, this.base)) { this.i++; this.base = { ...s }; }
    return this.i >= STEPS.length ? 'tut.done' : STEPS[this.i]!.key;
  }

  skip(): void { this.finished = true; }
  get index(): number { return this.i; }
}
