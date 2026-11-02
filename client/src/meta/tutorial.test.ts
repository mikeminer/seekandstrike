import { describe, expect, it } from 'vitest';
import { Tutorial, type TutorialSample } from './tutorial';

const s0: TutorialSample = { moved: 0, looked: 0, ads: 0, shots: 0, nearObjective: false, planting: false };

describe('first-match tutorial', () => {
  it('walks move → look → aim → fire → objective → done, each cleared by doing it', () => {
    const t = new Tutorial();
    let s = { ...s0 };
    expect(t.step(s, 0.1)).toBe('tut.move');
    expect(t.step(s, 0.1)).toBe('tut.move'); // nothing done yet
    s = { ...s, moved: 5 }; expect(t.step(s, 0.1)).toBe('tut.look');
    s = { ...s, looked: 2 }; expect(t.step(s, 0.1)).toBe('tut.aim');
    s = { ...s, ads: 1 }; expect(t.step(s, 0.1)).toBe('tut.fire');
    s = { ...s, shots: 3 }; expect(t.step(s, 0.1)).toBe('tut.obj');
    s = { ...s, nearObjective: true }; expect(t.step(s, 0.1)).toBe('tut.done');
    for (let i = 0; i < 50; i++) t.step(s, 0.1);
    expect(t.finished).toBe(true);
    expect(t.step(s, 0.1)).toBeNull();
  });
  it('progress counts from when a step starts (moving before does not skip looking)', () => {
    const t = new Tutorial();
    t.step({ ...s0 }, 0.1);
    expect(t.step({ ...s0, moved: 10, looked: 0.5 }, 0.1)).toBe('tut.look');
    expect(t.step({ ...s0, moved: 10, looked: 1.0 }, 0.1)).toBe('tut.look');
  });
  it('can be skipped', () => { const t = new Tutorial(); t.skip(); expect(t.step(s0, 0.1)).toBeNull(); });
});
