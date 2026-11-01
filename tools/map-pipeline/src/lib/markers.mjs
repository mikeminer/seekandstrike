// SPDX-License-Identifier: GPL-3.0-or-later
// Marker conventions. A node is a marker if its NAME matches the pipeline prefixes, or if it carries
// 3dmap-creator extras ({ marker: 'spawn'|'waypoint'|'trigger'|'pointLight', tags, props, params }).
//   spawn_attack_*  spawn_defend_*   team spawns (face −Z, i.e. yaw from node rotation)
//   objective_*                       objective anchor; props.kind = plant|defuse|capture|carry|build|escort
//   cover_*                           hand-placed cover hint (props.height, props.stance)
//   nav_*                             bot waypoint (props.patrols = loop indices)
//   trigger_*                         volume (node scale = full size in metres)
import { decompose, quatYaw, r3, round } from './math.mjs';

const NAME_RE = /^(spawn_attack|spawn_defend|spawn|objective|cover|nav|trigger|light)(?:[_.\-\s]|$)/i;
const TEAM_TAGS = { attack: 0, attackers: 0, allies: 0, axis: 1, defend: 1, defenders: 1 };

export function classifyMarker(node, worldMatrix) {
  const name = node.getName() ?? '';
  const ex = node.getExtras() ?? {};
  const m = NAME_RE.exec(name);
  let kind = null, team = null;
  if (m) {
    const p = m[1].toLowerCase();
    if (p === 'spawn_attack') { kind = 'spawn'; team = 0; }
    else if (p === 'spawn_defend') { kind = 'spawn'; team = 1; }
    else kind = p === 'light' ? 'light' : p;
  } else if (ex.marker) {
    kind = { spawn: 'spawn', waypoint: 'nav', trigger: 'trigger', pointLight: 'light', objective: 'objective', cover: 'cover' }[ex.marker] ?? null;
  } else if (Array.isArray(ex.tags) && ex.tags.includes('objective') && !node.getMesh()) {
    kind = 'objective';
  }
  if (!kind) return null;
  const tags = Array.isArray(ex.tags) ? ex.tags : [];
  if (kind === 'spawn' && team === null) {
    for (const t of tags) if (t.toLowerCase() in TEAM_TAGS) team = TEAM_TAGS[t.toLowerCase()];
    if (ex.props?.team !== undefined) team = Number(ex.props.team);
  }
  const { t, r, s } = decompose(worldMatrix);
  const out = { kind, name, position: r3(t, 3), yaw: round(quatYaw(r), 4) };
  if (team !== null) out.team = team;
  if (kind === 'trigger') out.size = r3(s, 3);
  if (tags.length) out.tags = tags;
  const props = { ...(ex.params ?? {}), ...(ex.props ?? {}) };
  if (Object.keys(props).length) out.props = props;
  if (ex.id) out.editorId = ex.id;
  return out;
}

export function summarize(markers) {
  const by = (k, t) => markers.filter((m) => m.kind === k && (t === undefined || m.team === t)).length;
  const issues = [];
  if (by('spawn', 0) === 0) issues.push('no spawn_attack_* markers');
  if (by('spawn', 1) === 0) issues.push('no spawn_defend_* markers');
  if (by('objective') === 0) issues.push('no objective_* marker');
  const anon = markers.filter((m) => m.kind === 'spawn' && m.team === undefined);
  if (anon.length) issues.push(`${anon.length} spawn markers without team (name them spawn_attack_* / spawn_defend_* or tag attack/defend)`);
  return { counts: { spawnAttack: by('spawn', 0), spawnDefend: by('spawn', 1), objective: by('objective'), cover: by('cover'), nav: by('nav'), trigger: by('trigger'), light: by('light') }, issues };
}
