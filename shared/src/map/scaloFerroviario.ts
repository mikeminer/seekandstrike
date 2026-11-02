/**
 * "Scalo Ferroviario" — rail yard (52 x 84 m). Long sight lines along the tracks, broken by rows of
 * wagons; crossings between wagon rows are the fights. Attackers come from the south goods shed,
 * defenders hold the signal post in the north, where the charge goes on the switch panel under a
 * steel canopy. All geometry is original. Wagons use the container boxes (sheet steel, loaded).
 */
import type { MapBox, MapDef } from './types';
import { v3 } from '../sim/vec';

const boxes: MapBox[] = [];
const add = (b: MapBox): void => { boxes.push(b); };

function building(x: number, z: number, sx: number, sz: number, h: number, kind: 'plaster' | 'brick'): void {
  add({ c: v3(x, h / 2, z), s: v3(sx, h, sz), material: 'concrete', look: 'concrete', building: kind });
}
function wall(x: number, z: number, sx: number, sz: number, h = 3): void {
  add({ c: v3(x, h / 2, z), s: v3(sx, h, sz), material: 'concrete', look: 'concrete' });
}
/** A goods wagon along Z: body raised on the bogies (0.9 m gap underneath you can see through but not cross). */
function wagon(x: number, z: number, look: MapBox['look']): void {
  add({ c: v3(x, 0.45, z), s: v3(2.2, 0.9, 11), material: 'metal', look: 'steelPlate' }); // underframe (blocks walking)
  add({ c: v3(x, 0.9 + 1.4, z), s: v3(2.7, 2.8, 12), material: 'sheetMetal', look, shell: 0.002, fill: 1 });
}
function crate(x: number, z: number, size = 1.2, y = 0): void {
  add({ c: v3(x, y + size / 2, z), s: v3(size, size, size), material: 'wood', look: 'crate', shell: 0.04 });
}
function barrier(x: number, z: number, alongX: boolean): void {
  add({ c: v3(x, 0.45, z), s: alongX ? v3(3, 0.9, 0.6) : v3(0.6, 0.9, 3), material: 'concrete', look: 'barrier' });
}

// Perimeter.
wall(0, -42.5, 54, 1, 4);
wall(0, 42.5, 54, 1, 4);
wall(-26.5, 0, 1, 84, 4);
wall(26.5, 0, 1, 84, 4);

// Four tracks (x = -15, -5, 5, 15) with wagon rows; gaps are the crossings.
wagon(-15, 22, 'containerRed'); wagon(-15, 4, 'containerBlue'); wagon(-15, -16, 'containerGrey');
wagon(-5, 14, 'containerGrey'); wagon(-5, -6, 'containerRed');
wagon(5, 24, 'containerBlue'); wagon(5, 2, 'containerGrey'); wagon(5, -20, 'containerBlue');
wagon(15, 12, 'containerRed'); wagon(15, -10, 'containerGrey');

// South goods shed (attackers) and north signal post (defenders).
building(-18, 37, 14, 8, 7, 'brick');
building(18, 37, 12, 8, 6, 'plaster');
building(-19, -36, 12, 9, 8, 'brick');      // signal tower
building(19, -36, 12, 9, 6, 'plaster');     // depot
// Switch panel under a steel canopy (the charge goes here) with low walls around it.
add({ c: v3(0, 0.55, -33), s: v3(2.4, 1.1, 0.8), material: 'metal', look: 'steelPlate' });
for (const x of [-4, 4]) add({ c: v3(x, 1.6, -33), s: v3(0.3, 3.2, 0.3), material: 'metal', look: 'steelPlate' });
add({ c: v3(0, 3.35, -33), s: v3(9, 0.2, 5), material: 'metal', look: 'steelPlate' });
wall(-4.5, -29.5, 3, 0.4, 1.1); wall(4.5, -29.5, 3, 0.4, 1.1);

// Platforms and low cover between tracks.
add({ c: v3(-10, 0.4, -30), s: v3(4, 0.8, 10), material: 'concrete', look: 'concrete' });
add({ c: v3(10, 0.4, 32), s: v3(4, 0.8, 10), material: 'concrete', look: 'concrete' });
barrier(0, 8, true); barrier(-10, -2, false); barrier(10, 4, false); barrier(0, -14, true); barrier(-10, 30, true); barrier(20, -24, true);
barrier(-21, 12, false); barrier(21, -2, false);
crate(0, -22); crate(1.2, -22.3, 1.0); crate(-21, -24); crate(21, 24); crate(21, 25.3, 1.0); crate(-1, 30); crate(10, -30, 1.0);

const waypoints = [
  v3(0, 0, 38), v3(-10, 0, 36), v3(10, 0, 35), v3(-21, 0, 28), v3(21, 0, 30), v3(0, 0, 30), // 0-5 south
  v3(-10, 0, 20), v3(0, 0, 20), v3(10, 0, 20), v3(-21, 0, 12), v3(21, 0, 4), // 6-10
  v3(-10, 0, 10), v3(0, 0, 4), v3(10, 0, -2), v3(-21, 0, -6), v3(21, 0, -20), // 11-15
  v3(-10, 0, -10), v3(0, 0, -12), v3(10, 0, -12), v3(-10, 0, -24), v3(0, 0, -26), v3(10, 0, -24), // 16-21
  v3(-4, 0, -36), v3(4, 0, -36), v3(-17, 0, -27), v3(21, 0, -28), v3(-10, 0, -38), v3(10, 0, -39), // 22-27
];

export const SCALO_FERROVIARIO: MapDef = {
  id: 'scalo-ferroviario',
  nameKey: 'map.scalo',
  bounds: { minX: -26, maxX: 26, minZ: -42, maxZ: 42 },
  boxes,
  spawns: [
    [v3(-4, 0, 40), v3(0, 0, 40.5), v3(4, 0, 40), v3(-8, 0, 39.5), v3(8, 0, 39.5), v3(2, 0, 38.5)],
    [v3(-8, 0, -39), v3(-3, 0, -40), v3(3, 0, -40), v3(8, 0, -39), v3(12, 0, -38), v3(-12, 0, -38.5)],
  ],
  spawnYaw: [0, Math.PI],
  objective: v3(0, 1.1, -32.5),
  waypoints,
  patrols: [
    [20, 19, 22, 23, 21],
    [17, 16, 18],
    [24, 19, 20],
    [25, 21, 18],
  ],
  waterLevel: -3,
  environment: { sun: { azimuthDeg: 300, elevationDeg: 18 } },
};
