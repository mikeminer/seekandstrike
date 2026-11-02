import type { Game } from '../game/game';
import { lineOfSight } from '@shared/map/query';
import { chestPos, eyePos } from '@shared/sim/combatant';
/** DEV-ONLY automation handle for screenshots/tests. Imported only inside __DEV_PASS_BYPASS__ branches. */
export function installAutomation(game: Game, play: () => void): void {
  (window as unknown as Record<string, unknown>).__lz = {
    play,
    match: () => game.match,
    teleport: (x: number, z: number, yaw: number, pitch = 0) => game.teleportPlayer(x, z, yaw, pitch),
    input: game.inputManager,
    simulate: (s: number) => game.simulate(s),
    stats: () => game.stats,
    online: () => game.onlineSession,
    /** Whether combatant `a` sees combatant `b` (static map only). */
    sees: (a: number, b: number) => { const m = game.match; return lineOfSight(m.map, eyePos(m.combatants[a]!), chestPos(m.combatants[b]!)); },
  };
}
