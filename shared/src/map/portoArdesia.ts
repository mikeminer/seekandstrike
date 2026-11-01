/**
 * "Porto di Ardesia — Banchina Est" (stage-1 slice of the brief's 3-phase map).
 * A 2030 container terminal: attackers (team 0) land at the south quay and must breach the
 * crane control bunker; defenders (team 1) hold the yard. All geometry is original.
 */
import type { MapBox, MapDef } from './types';
import { v3 } from '../sim/vec';

const C_LEN = 6.06; // 20 ft ISO container
const C_W = 2.44;
const C_H = 2.59;

const boxes: MapBox[] = [];
const add = (b: MapBox): void => { boxes.push(b); };

/** Container along X (long axis X) or Z. Sheet-steel shell, loaded with cargo → stops rifle rounds. */
function container(x: number, z: number, alongX: boolean, look: MapBox['look'], level = 0): void {
  add({
    c: v3(x, C_H / 2 + level * C_H, z),
    s: alongX ? v3(C_LEN, C_H, C_W) : v3(C_W, C_H, C_LEN),
    material: 'sheetMetal', look, shell: 0.002, fill: 1,
  });
}
function wall(x: number, z: number, sx: number, sz: number, h = 3.2): void {
  add({ c: v3(x, h / 2, z), s: v3(sx, h, sz), material: 'concrete', look: 'concrete' });
}
function crate(x: number, z: number, size = 1.2, y = 0): void {
  add({ c: v3(x, y + size / 2, z), s: v3(size, size, size), material: 'wood', look: 'crate', shell: 0.04 });
}
function barrier(x: number, z: number, alongX: boolean): void {
  // Jersey-style barrier, 0.9 m tall: crouch cover.
  add({ c: v3(x, 0.45, z), s: alongX ? v3(3, 0.9, 0.6) : v3(0.6, 0.9, 3), material: 'concrete', look: 'barrier' });
}

// --- Perimeter (tall harbour walls; east side is the quay edge with a low kerb).
wall(0, -42, 72, 1, 5);
wall(0, 42, 72, 1, 5);
wall(-36, 0, 1, 84, 5);
add({ c: v3(36.4, 0.35, 0), s: v3(0.8, 0.7, 84), material: 'concrete', look: 'barrier' });

// --- Objective bunker (crane control room) around (0, -22): 12 x 9 m with two doorways.
const bz = -22;
wall(0, bz - 4.5, 12, 0.4);            // back (north)
wall(-6, bz, 0.4, 9.4);                // west
wall(6, bz - 2.6, 0.4, 4.2);           // east, split by doorway
wall(6, bz + 3.2, 0.4, 3.0);
wall(-3.9, bz + 4.5, 4.2, 0.4);        // front (south) with central doorway
wall(3.9, bz + 4.5, 4.2, 0.4);
add({ c: v3(0, 3.35, bz), s: v3(12.4, 0.3, 9.4), material: 'concrete', look: 'concrete' }); // roof slab
// Control console (charge goes here).
add({ c: v3(0, 0.55, bz - 3.4), s: v3(2.4, 1.1, 0.8), material: 'metal', look: 'steelPlate' });
crate(-4.4, bz - 3.0);
crate(4.2, bz + 2.4, 1.0);

// --- Container stacks across the yard.
container(-24, 26, true, 'containerBlue');
container(-24, 26, true, 'containerRed', 1);
container(-16, 18, false, 'containerGrey');
container(-26, 12, true, 'containerRed');
container(-10, 30, true, 'containerGrey');
container(10, 28, true, 'containerBlue');
container(20, 20, false, 'containerRed');
container(20, 20, false, 'containerGrey', 1);
container(27, 10, true, 'containerBlue');
container(-20, 2, false, 'containerBlue');
container(-12, -4, true, 'containerRed');
container(-24, -14, false, 'containerGrey');
container(-24, -14, false, 'containerRed', 1);
container(14, -2, true, 'containerGrey');
container(22, -10, false, 'containerRed');
container(14, -32, true, 'containerBlue');
container(-14, -34, true, 'containerGrey');
container(26, -30, false, 'containerBlue');
container(26, -30, false, 'containerGrey', 1);
container(4, 10, false, 'containerRed');

// --- Low cover: barriers and crates.
barrier(-4, 18, true);
barrier(6, 16, true);
barrier(-8, 6, false);
barrier(9, 6, true);
barrier(-2, -8, true);
barrier(5, -10, true);
barrier(-10, -14, false);
barrier(12, -16, false);
crate(-6, 24); crate(-6, 25.3, 1.2); crate(-4.8, 24.6, 0.9);
crate(16, 12); crate(16, 12, 1.0, 1.2);
crate(-15, -22); crate(9, -24, 1.0);
crate(30, 2); crate(31.3, 2.2, 1.0);

// Steel plate shelter at mid yard.
add({ c: v3(0, 1.1, 0), s: v3(4, 2.2, 0.3), material: 'metal', look: 'steelPlate' });

const waypoints = [
  v3(0, 0, 34), v3(-12, 0, 34), v3(14, 0, 34), v3(-20, 0, 22), v3(-6, 0, 20), v3(6, 0, 22), v3(14, 0, 22), // 0-6 south
  v3(-28, 0, 18), v3(32.5, 0, 16), v3(-12, 0, 12), v3(0, 0, 14), v3(12, 0, 10), v3(-28, 0, 4), v3(30, 0, 4), // 7-13
  v3(-14, 0, 4), v3(-4, 0, 4), v3(6, 0, 3), v3(20, 0, 4), v3(-6, 0, -9), v3(8, 0, -6), v3(-18, 0, -8), // 14-20
  v3(18, 0, -16), v3(-30, 0, -24), v3(-16, 0, -16), v3(10, 0, -14), v3(0, 0, -13), v3(0, 0, -17.5), v3(8.5, 0, -21.5), // 21-27
  v3(0, 0, -22), v3(-3, 0, -24.5), v3(3, 0, -24.5), v3(-10, 0, -28), v3(10, 0, -28), v3(0, 0, -36), v3(-24, 0, -36), // 28-34
  v3(22, 0, -38), v3(30, 0, -20), v3(-30, 0, -6), v3(30, 0, 28), v3(-30, 0, 34), // 35-39
  v3(-12, 0, -38.5), v3(-30, 0, -15), v3(14, 0, -37.5), v3(-21, 0, 35), // 40-43
];

export const PORTO_ARDESIA: MapDef = {
  id: 'porto-ardesia-east',
  nameKey: 'map.portoArdesia',
  bounds: { minX: -35.4, maxX: 35.9, minZ: -41.4, maxZ: 41.4 },
  boxes,
  spawns: [
    [v3(-4, 0, 38), v3(0, 0, 38.5), v3(4, 0, 38), v3(-8, 0, 37.5), v3(8, 0, 37.5), v3(-2, 0, 36.5)],
    [v3(-6, 0, -38.5), v3(0, 0, -39), v3(6, 0, -38.5), v3(-10, 0, -38), v3(10, 0, -38), v3(2, 0, -37.5)],
  ],
  spawnYaw: [0, Math.PI],
  objective: v3(0, 1.1, bz - 2.9),
  waypoints,
  patrols: [
    [25, 19, 16, 15, 18],
    [24, 21, 36, 32, 27],
    [23, 20, 37, 22, 31],
    [28, 29, 30, 26],
  ],
  waterLevel: -1.6,
};
