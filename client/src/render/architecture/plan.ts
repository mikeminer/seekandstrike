/**
 * Procedural warehouse architecture for pipeline maps — the PLAN stage (no triangles here).
 *
 * Follows the DevFridge Game Builder skill v1.10.0:
 *   references/landscapes-and-architecture.md → vendor/threejs-graphics-skills/threejs-procedural-architecture
 *   (settings → mass → exposed-surface graph → façade/roof placements → material-slot writer).
 *
 * The mass is the map's own collision boxes, so what the player sees is exactly what bullets and
 * bodies hit. Ornament projects at most TRIM_MAX_PROJECTION outside a box and never changes the sim.
 * Everything is deterministic: the same boxes and building ids give the same plan.
 */

/** Dimensional contract (metres): 19th-century Trieste port warehouses ("magazzini"). */
export const BAY_WIDTH = 4.4;
export const TARGET_FLOOR_HEIGHT = 4.6;
export const PLINTH_HEIGHT = 1.1;
export const STRING_COURSE_HEIGHT = 0.28;
export const CORNICE_HEIGHT = 0.6;
export const TRIM_MAX_PROJECTION = 0.32;
/** A façade piece shorter than one bay but at least this long gets a single window. */
export const SINGLE_WINDOW_MIN = 2.6;
/** Exposed façade pieces shorter than this are walls only (no windows, no trim). */
export const MIN_SEGMENT = 0.25;
const EPS = 0.001;

export type Side = '+x' | '-x' | '+z' | '-z';

/** One axis-aligned mass box of a building (a collision box). */
export interface MassRect {
  id: string;
  building: string;
  minX: number; maxX: number;
  minZ: number; maxZ: number;
  top: number; // ground is y = 0
}

/** A wall piece nobody else covers: [a, b] along the side, [y0, y1] vertically. */
export interface FacadeEdge {
  id: string;
  rect: string;
  building: string;
  side: Side;
  /** Fixed coordinate of the wall plane (x for ±x sides, z for ±z sides). */
  plane: number;
  a: number; b: number;
  y0: number; y1: number;
}

export type PlacementKind = 'plinth' | 'stringCourse' | 'cornice' | 'window' | 'sill';

export interface Placement {
  kind: PlacementKind;
  edge: string;
  /** Interval along the edge and vertical span, in world metres. */
  a: number; b: number;
  y0: number; y1: number;
  /** How far the module stands out of the wall plane. */
  projection: number;
  arched?: boolean;
}

export interface BuildingStyle {
  /** Index into the plaster palette; chosen by seed among valid designs. */
  plaster: number;
  archedWindows: boolean;
  floors: number;
  floorHeight: number;
}

export interface BuildingPlan {
  building: string;
  style: BuildingStyle;
  rects: MassRect[];
  edges: FacadeEdge[];
  placements: Placement[];
  diagnostics: {
    rects: number;
    edges: number;
    windows: number;
    droppedShortSegments: number;
    hiddenSideLength: number;
  };
}

export const PLASTER_PALETTE = [0xd8c39a, 0xcdb48a, 0xe0cfaa, 0xc9a77c] as const;

/** FNV-1a: stable per-building seed from its id. */
export function seedOf(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

function sideInfo(r: MassRect, side: Side): { plane: number; a: number; b: number } {
  switch (side) {
    case '+x': return { plane: r.maxX, a: r.minZ, b: r.maxZ };
    case '-x': return { plane: r.minX, a: r.minZ, b: r.maxZ };
    case '+z': return { plane: r.maxZ, a: r.minX, b: r.maxX };
    case '-z': return { plane: r.minZ, a: r.minX, b: r.maxX };
  }
}

/**
 * Part of another box that hides this side: a box whose volume reaches the wall plane from the
 * outside (touching or overlapping it) and overlaps the side's interval. Returns the hidden
 * interval and the height up to which it hides the wall.
 */
function blockerOf(r: MassRect, side: Side, o: MassRect): { a: number; b: number; top: number } | null {
  if (o.id === r.id) return null;
  const { plane, a, b } = sideInfo(r, side);
  const alongX = side === '+z' || side === '-z';
  const oa = alongX ? o.minX : o.minZ, ob = alongX ? o.maxX : o.maxZ;
  const lo = Math.max(a, oa), hi = Math.min(b, ob);
  if (hi - lo <= EPS) return null;
  const omin = alongX ? o.minZ : o.minX, omax = alongX ? o.maxZ : o.maxX;
  // The other box must cover the plane from the outward side.
  const outward = side === '+x' || side === '+z';
  const covers = outward ? (omin <= plane + EPS && omax > plane + EPS) : (omax >= plane - EPS && omin < plane - EPS);
  return covers ? { a: lo, b: hi, top: o.top } : null;
}

/** Splits [a, b] at every blocker boundary and returns pieces with the height they are hidden to. */
function exposedPieces(a: number, b: number, blockers: { a: number; b: number; top: number }[]): { a: number; b: number; hidden: number }[] {
  const cuts = new Set<number>([a, b]);
  for (const k of blockers) { cuts.add(k.a); cuts.add(k.b); }
  const xs = [...cuts].filter((x) => x >= a - EPS && x <= b + EPS).sort((p, q) => p - q);
  const out: { a: number; b: number; hidden: number }[] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const p = xs[i]!, q = xs[i + 1]!;
    if (q - p <= EPS) continue;
    const mid = (p + q) / 2;
    let hidden = 0;
    for (const k of blockers) if (mid > k.a && mid < k.b) hidden = Math.max(hidden, k.top);
    const last = out[out.length - 1];
    if (last && Math.abs(last.b - p) <= EPS && Math.abs(last.hidden - hidden) <= EPS) last.b = q; // merge equal neighbours
    else out.push({ a: p, b: q, hidden });
  }
  return out;
}

const SIDES: readonly Side[] = ['+x', '-x', '+z', '-z'];

/**
 * Exposed-surface graph for one building. `others` are all mass boxes on the map (any building):
 * walls hidden by a neighbour are not decorated (skill rule: never decorate internal faces).
 */
export function exposedEdges(rects: readonly MassRect[], others: readonly MassRect[]): { edges: FacadeEdge[]; dropped: number; hidden: number } {
  const edges: FacadeEdge[] = [];
  let dropped = 0, hidden = 0;
  for (const r of rects) {
    for (const side of SIDES) {
      const { plane, a, b } = sideInfo(r, side);
      const blockers = others.map((o) => blockerOf(r, side, o)).filter((x): x is NonNullable<typeof x> => x !== null);
      let n = 0;
      for (const piece of exposedPieces(a, b, blockers)) {
        const y0 = Math.min(piece.hidden, r.top);
        if (r.top - y0 <= EPS) { hidden += piece.b - piece.a; continue; }
        if (piece.b - piece.a < MIN_SEGMENT) { dropped++; continue; }
        edges.push({ id: `${r.id}:${side}:${n++}`, rect: r.id, building: r.building, side, plane, a: piece.a, b: piece.b, y0, y1: r.top });
      }
    }
  }
  return { edges, dropped, hidden };
}

function chooseStyle(building: string, height: number): BuildingStyle {
  const s = seedOf(building);
  const floors = Math.max(1, Math.round(height / TARGET_FLOOR_HEIGHT));
  return { plaster: s % PLASTER_PALETTE.length, archedWindows: ((s >>> 8) & 1) === 1, floors, floorHeight: height / floors };
}

/** Façade and trim placements for one exposed edge. Pure data, no geometry. */
function placeEdge(e: FacadeEdge, style: BuildingStyle, buildingTop: number): Placement[] {
  const out: Placement[] = [];
  const len = e.b - e.a;
  const fh = style.floorHeight;
  // Plinth and cornice frame the whole visible piece.
  if (e.y0 <= EPS) out.push({ kind: 'plinth', edge: e.id, a: e.a, b: e.b, y0: 0, y1: Math.min(PLINTH_HEIGHT, e.y1), projection: 0.06 });
  if (Math.abs(e.y1 - buildingTop) <= EPS && e.y1 - e.y0 >= CORNICE_HEIGHT) {
    out.push({ kind: 'cornice', edge: e.id, a: e.a, b: e.b, y0: e.y1 - CORNICE_HEIGHT, y1: e.y1, projection: TRIM_MAX_PROJECTION });
  }
  for (let f = 1; f < style.floors; f++) {
    const y = f * fh;
    if (y - STRING_COURSE_HEIGHT / 2 > e.y0 && y + STRING_COURSE_HEIGHT / 2 < e.y1 - CORNICE_HEIGHT) {
      out.push({ kind: 'stringCourse', edge: e.id, a: e.a, b: e.b, y0: y - STRING_COURSE_HEIGHT / 2, y1: y + STRING_COURSE_HEIGHT / 2, projection: 0.1 });
    }
  }
  // Window rhythm: whole bays only, centred so both ends keep a pier of at least half a bay.
  // Short pieces (stair-stepped approximations of oblique OSM walls) still get one centred window.
  const bays = len >= BAY_WIDTH ? Math.floor(len / BAY_WIDTH) : len >= SINGLE_WINDOW_MIN ? 1 : 0;
  if (bays < 1) return out;
  const bay = len / bays;
  const w = Math.min(1.7, bay * 0.42);
  for (let f = 0; f < style.floors; f++) {
    const floorBase = f * fh;
    const sillY = floorBase + (f === 0 ? Math.max(PLINTH_HEIGHT + 0.5, fh * 0.32) : fh * 0.3);
    const headY = floorBase + fh * 0.82;
    const capY = f === style.floors - 1 ? e.y1 - CORNICE_HEIGHT - 0.25 : headY;
    const top = Math.min(headY, capY);
    if (top - sillY < 1.0 || sillY < e.y0 + 0.2 || top > e.y1 - 0.2) continue; // window must sit fully on this visible piece
    for (let i = 0; i < bays; i++) {
      const c = e.a + bay * (i + 0.5);
      out.push({ kind: 'window', edge: e.id, a: c - w / 2, b: c + w / 2, y0: sillY, y1: top, projection: 0.03, arched: style.archedWindows });
      out.push({ kind: 'sill', edge: e.id, a: c - w / 2 - 0.12, b: c + w / 2 + 0.12, y0: sillY - 0.12, y1: sillY, projection: 0.16 });
    }
  }
  return out;
}

/** Plans every building on the map from its collision boxes. */
export function planBuildings(rects: readonly MassRect[]): BuildingPlan[] {
  const byBuilding = new Map<string, MassRect[]>();
  for (const r of rects) byBuilding.set(r.building, [...(byBuilding.get(r.building) ?? []), r]);
  const plans: BuildingPlan[] = [];
  for (const [building, own] of [...byBuilding].sort(([p], [q]) => (p < q ? -1 : 1))) {
    const top = Math.max(...own.map((r) => r.top));
    const style = chooseStyle(building, top);
    const { edges, dropped, hidden } = exposedEdges(own, rects);
    const placements = edges.flatMap((e) => placeEdge(e, style, top));
    plans.push({
      building, style, rects: own, edges, placements,
      diagnostics: { rects: own.length, edges: edges.length, windows: placements.filter((p) => p.kind === 'window').length, droppedShortSegments: dropped, hiddenSideLength: hidden },
    });
  }
  return plans;
}

/** Pipeline collider boxes whose node name marks a building (`bld_…`) → mass rectangles. */
export function massFromSimBoxes(boxes: readonly { c: { x: number; y: number; z: number }; s: { x: number; y: number; z: number }; node?: string }[]): MassRect[] {
  const out: MassRect[] = [];
  boxes.forEach((b, i) => {
    if (!b.node || !b.node.startsWith('bld_')) return;
    const top = b.c.y + b.s.y / 2, bottom = b.c.y - b.s.y / 2;
    if (top <= 0.5 || bottom > 0.5) return; // only boxes standing on the ground
    out.push({
      id: `${b.node}#${i}`, building: b.node,
      minX: b.c.x - b.s.x / 2, maxX: b.c.x + b.s.x / 2, minZ: b.c.z - b.s.z / 2, maxZ: b.c.z + b.s.z / 2, top,
    });
  });
  return out;
}
