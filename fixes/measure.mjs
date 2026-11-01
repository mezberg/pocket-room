// One cheap measurement of a room, and what got worse between two of them. Everything comes from rules/:
// the same footprints, overlap test, door swings and walkway grid that Check my room uses.
import { outline, footprint, overlap, outside, doorwayRect, hitsSwing } from "../rules/geom.mjs";
import { obstacles, buildGrid, routes, reachable, blocksFloor } from "../rules/grid.mjs";
import { WALK_OK } from "../rules/place.mjs";

export const allItems = (room) => [...(room.fixtures ?? []), ...(room.furniture ?? [])];
export const byId = (room, id) => allItems(room).find((x) => x.id === id);
export const routeKey = (r) => `${r.from}>${r.to}`;

// Chairs may stand tucked under a dining table or desk (≥ 65 cm high, so not a coffee table): as in rules/check.mjs.
const TUCK = new Set(["chair", "stool"]), UNDER = new Set(["table", "desk"]);
export const under = (c, t) => TUCK.has(c.category) && UNDER.has(t.category) && t.size[2] >= 0.65;
export const tucked = (a, b) => under(a, b) || under(b, a);

// The outline is the expensive part of a grid (rules/grid.mjs keeps the walls-only grid per outline object),
// so a search passes one outline, made once, to every snap.
// { ov: overlapping pairs, door: doors blocked by a piece, out: pieces through a wall, rs: walkway widths }
export function snap(room, O = outline(room)) {
  const items = allItems(room);
  const solid = items.filter(blocksFloor);
  const ov = new Set(), door = new Set(), out = new Set();
  const R = new Map(solid.map((it) => [it.id, footprint(it)]));
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const a = solid[i], b = solid[j];
    if (!tucked(a, b) && overlap(R.get(a.id), R.get(b.id)).depth > 0.03) ov.add([a.id, b.id].sort().join("|"));
  }
  const doors = O.openings.filter((o) => o.passable);
  for (const it of solid) {
    const r = R.get(it.id);
    if (it.on_floor !== false && outside(O, r) > 0.03) out.add(it.id);
    for (const op of doors) if (hitsSwing(op, r) || overlap(doorwayRect(op, 0.5), r).depth > 0.03) door.add(`${op.id}|${it.id}`);
  }
  const rs = routes(buildGrid(O, obstacles(room)), O, items.filter(reachable));
  return { ov, door, out, rs: new Map(rs.map((r) => [routeKey(r), r])) };
}

// Everything that got worse from a to b: a new overlap, a door newly blocked, a piece newly through a wall,
// a walkway that drops below what it was (or below 75 cm, whichever is less) by more than the grid's error.
// `ignore`: the walkways the fix is about (they are judged by the goal instead).
export function worse(a, b, ignore = new Set()) {
  const bad = [];
  for (const k of b.ov) if (!a.ov.has(k)) bad.push({ kind: "overlap", key: k });
  for (const k of b.door) if (!a.door.has(k)) bad.push({ kind: "door", key: k });
  for (const k of b.out) if (!a.out.has(k)) bad.push({ kind: "wall", key: k });
  for (const [k, r] of b.rs) {
    if (ignore.has(k)) continue;
    const w0 = a.rs.get(k)?.width ?? 0;
    if (r.width < Math.min(w0, WALK_OK) - 0.03) bad.push({ kind: "walkway", key: k, before: w0, after: r.width });
  }
  return bad;
}

// Geometry only, no grid (microseconds): every piece in `ids` is inside the walls and overlaps nothing more
// than it did before. A pair that both moved compares with where both were.
export function legal(room0, room2, ids, O = outline(room2)) {
  const all = allItems(room2);
  for (const id of ids) {
    const it = all.find((x) => x.id === id);
    if (!it || !blocksFloor(it)) continue;
    const R = footprint(it);
    if (outside(O, R) > 0.01) return false;
    const was = byId(room0, id);
    for (const o of all) {
      if (o.id === id || !blocksFloor(o) || tucked(o, it)) continue;
      const o0 = byId(room0, o.id) ?? o;
      const before = was ? overlap(footprint(o0), footprint(was)).depth : 0;
      if (overlap(footprint(o), R).depth > Math.max(0.01, before + 0.001)) return false;
    }
  }
  return true;
}

// The pieces that a change in `ids` newly runs into.
export function bumped(room0, room2, ids) {
  return (room2.furniture ?? []).concat(room2.fixtures ?? []).filter((o) => !ids.includes(o.id) && blocksFloor(o) && ids.some((id) => {
    const it = byId(room2, id);
    if (!it || !blocksFloor(it) || tucked(o, it)) return false;
    const w = byId(room0, id), o0 = byId(room0, o.id) ?? o;
    const was = w ? overlap(footprint(o0), footprint(w)).depth : 0;
    return overlap(footprint(o), footprint(it)).depth > Math.max(0.01, was + 0.001);
  }));
}
