/**
 * "Magazzini del Sale" — compact warehouse district (64 x 64 m) for short rounds.
 * Attackers (team 0) enter from the south street, defenders (team 1) hold a walled loading yard in the
 * north where the charge goes on the dock console. Three lanes: west alley, central street, east alley.
 * All geometry is original. Buildings are solid masses rendered as procedural architecture.
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
function crate(x: number, z: number, size = 1.2, y = 0): void {
  add({ c: v3(x, y + size / 2, z), s: v3(size, size, size), material: 'wood', look: 'crate', shell: 0.04 });
}
function barrier(x: number, z: number, alongX: boolean): void {
  add({ c: v3(x, 0.45, z), s: alongX ? v3(3, 0.9, 0.6) : v3(0.6, 0.9, 3), material: 'concrete', look: 'barrier' });
}
function container(x: number, z: number, alongX: boolean, look: MapBox['look']): void {
  add({ c: v3(x, 1.295, z), s: alongX ? v3(6.06, 2.59, 2.44) : v3(2.44, 2.59, 6.06), material: 'sheetMetal', look, shell: 0.002, fill: 1 });
}

// Perimeter.
wall(0, -32.5, 66, 1, 5);
wall(0, 32.5, 66, 1, 5);
wall(-32.5, 0, 1, 64, 5);
wall(32.5, 0, 1, 64, 5);

// West block (alley at x -18..-14) and east block (alley 14..18).
building(-25, -20, 13, 10, 9, 'brick');
building(-25, -4, 13, 12, 7, 'plaster');
building(-25, 13, 13, 10, 8, 'brick');
building(25, -20, 13, 10, 8, 'plaster');
building(25, -3, 13, 12, 10, 'brick');
building(25, 14, 13, 10, 7, 'plaster');
// Central island splitting the street into two lanes south of the yard.
building(0, 10, 9, 8, 6, 'plaster');

// Walled loading yard (north): x -14..14, z -31..-9, main gate in the middle, side doors.
wall(-9.5, -9, 9, 0.5);   // south wall, west part
wall(9.5, -9, 9, 0.5);    // south wall, east part (gate x -5..5)
wall(-14, -26, 0.5, 10);  // west wall, door at z -21..-17... north part
wall(-14, -12.5, 0.5, 7); // west wall, south part
wall(14, -26, 0.5, 10);
wall(14, -12.5, 0.5, 7);
// Dock console (the charge goes here) and the loading dock edge behind it.
add({ c: v3(0, 0.55, -24), s: v3(2.4, 1.1, 0.8), material: 'metal', look: 'steelPlate' });
add({ c: v3(0, 0.6, -29.5), s: v3(20, 1.2, 3), material: 'concrete', look: 'concrete' });
// Yard cover.
barrier(-6, -16, true); barrier(6, -15, true); barrier(-9, -22, false); barrier(9, -21, false);
crate(-4, -20); crate(4.5, -19.5, 1.0); crate(-10, -27); crate(10.5, -26.5); crate(10.5, -26.5, 1.0, 1.2);
container(-8, -12.5, true, 'containerGrey');

// Streets: containers and barriers as mid cover.
container(-16, 4, false, 'containerRed');
container(16, -12, false, 'containerBlue');
container(9, 22, true, 'containerGrey');
container(-9, -3, true, 'containerBlue');
barrier(-6, 20, true); barrier(5, 2, true); barrier(-4, -6, false); barrier(12, 6, false); barrier(-12, 24, false);
crate(-16, 24); crate(-16, 25.3, 1.0); crate(16, 26); crate(7, -4); crate(-12, -14, 1.0); crate(12, -4.5, 1.0);
add({ c: v3(0, 1.1, 22), s: v3(4, 2.2, 0.3), material: 'metal', look: 'steelPlate' });

const waypoints = [
  v3(0, 0, 28), v3(-10, 0, 28), v3(10, 0, 28), v3(-16, 0, 18), v3(16, 0, 20), v3(-8, 0, 16), v3(8, 0, 16), // 0-6 south
  v3(-16, 0, 6), v3(16, 0, 6), v3(-7, 0, 4), v3(7, 0, 4), v3(0, 0, 0), v3(-16, 0, -8), v3(16, 0, -6), // 7-13 middle
  v3(-6, 0, -6), v3(6, 0, -6), v3(0, 0, -11), v3(-16, 0, -19), v3(16, 0, -19), // 14-18 gate and side doors
  v3(-6, 0, -18), v3(6, 0, -18), v3(0, 0, -21), v3(-10, 0, -25), v3(10, 0, -24), v3(0, 0, -27), // 19-24 yard
  v3(-11, 0, -19), v3(11, 0, -19), v3(-16, 0, -28), v3(16, 0, -28), v3(-28, 0, 24), v3(28, 0, 25), // 25-30
];

export const MAGAZZINI_SALE: MapDef = {
  id: 'magazzini-sale',
  nameKey: 'map.magazzini',
  bounds: { minX: -32, maxX: 32, minZ: -32, maxZ: 32 },
  boxes,
  spawns: [
    [v3(-4, 0, 30), v3(0, 0, 30.5), v3(4, 0, 30), v3(-8, 0, 29.5), v3(8, 0, 29.5), v3(-2, 0, 28.5)],
    [v3(-6, 0, -26), v3(0, 0, -26.5), v3(6, 0, -26), v3(-11, 0, -29), v3(11, 0, -29), v3(3, 0, -27.5)],
  ],
  spawnYaw: [0, Math.PI],
  objective: v3(0, 1.1, -23.5),
  waypoints,
  patrols: [
    [16, 19, 21, 20],
    [25, 22, 24, 23, 26],
    [14, 15, 16],
    [17, 25, 19],
  ],
  waterLevel: -3,
  environment: { sun: { azimuthDeg: 235, elevationDeg: 24 } },
};
