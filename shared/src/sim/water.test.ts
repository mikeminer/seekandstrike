import { describe, expect, it } from 'vitest';
import { AabbHost, Match } from './match';
import { PORTO_ARDESIA } from '../map/portoArdesia';

describe('falling into the sea', () => {
  it('kills outright (no downed state, no revive) and reports a water death', () => {
    const m = new Match(PORTO_ARDESIA, { seed: 3, attackers: 2, defenders: 2, withPlayer: true }, new AabbHost(PORTO_ARDESIA));
    const p = m.player!;
    p.pos.y = PORTO_ARDESIA.waterLevel - 2;
    (m as unknown as { stepWater(): void }).stepWater();
    expect(p.health.state).toBe('dead');
    const ev = m.drainEvents().find((e) => e.type === 'damage');
    expect(ev).toMatchObject({ type: 'damage', victim: p.id, zone: 'water', outcome: 'killed' });
  });

  it('standing on the quay is safe', () => {
    const m = new Match(PORTO_ARDESIA, { seed: 3, attackers: 2, defenders: 2, withPlayer: true }, new AabbHost(PORTO_ARDESIA));
    (m as unknown as { stepWater(): void }).stepWater();
    expect(m.player!.health.state).toBe('alive');
  });
});
