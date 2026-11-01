// A room read from photos must be a room that can exist: no piece through another, through a wall or in a
// doorway. Positions and guessed sizes are rough, so the build checks itself with the same geometry
// as the rules (rules/geom.mjs) and repairs what the reading got wrong, in this order:
//   1. a short move (≤ 60 cm, 1.2 m out of a doorway as the rules' own fix allows, inside the walls, never pulling a piece off the wall it stands against),
//      of whichever piece needs the shortest one;
//   2. a fitted run against a wall is cut back to the door or unit it runs into;
//   3. a piece whose size was a category guess (nothing to measure it by) shrinks towards its smallest size;
//   4. an L-sofa's chaise goes to the other end; a measured piece in a doorway keeps its place and the opening
//      (read from the same photos, just as rough) slides along its wall to a clear stretch;
//   5. only then is a piece left out (a guessed one first, an L-sofa's chaise before the sofa), said in the caveats.
// Then big pieces left a few cm to 50 cm off a wall are put back against it. Nothing is drawn where the
// code knows it can't be.
import { outline, footprint } from "../../rules/geom.mjs";
import { overlap, outside, doorwayRect, hitsSwing } from "../../rules/geom.mjs";

const r3 = (v) => Math.round(v * 1000) / 1000;
const MAX_STEP = 0.6, DOOR_STEP = 1.2, STEP = 0.02, WALL = 0.05, DEPTH = 0.03;
// smallest believable footprint [w, d] when a guessed size has to give way
const MIN = { sofa: [1.4, 0.8], armchair: [0.7, 0.7], table: [0.7, 0.7], chair: [0.4, 0.45], desk: [0.9, 0.5], bed: [1.4, 1.9],
  shelf: [0.4, 0.25], cupboard: [0.4, 0.35], tv: [0.6, 0.1], lamp: [0.3, 0.3], plant: [0.3, 0.3], other: [0.3, 0.3] };

const solid = (i) => i.category !== "rug" && (i.on_floor !== false || i.category === "radiator");
// as rules/check.mjs: chairs tuck under dining tables and desks, not under coffee tables
const tucked = (a, b) => [[a, b], [b, a]].some(([c, t]) => ["chair", "stool"].includes(c.category) && ["table", "desk"].includes(t.category) && t.size[2] >= 0.65);

// An L-shaped sofa is two items (build.mjs splitCornerSofas): `x` and `x_chaise`. They move as one.
const groupOf = (room, it) => {
  const base = it.id.replace(/_chaise$/, "");
  return room.furniture.filter((i) => i.id === base || i.id === `${base}_chaise`);
};

/** Everything wrong with `it` standing at `at`: [{ kind, other? }] */
function problems(room, O, it, at = it.at, size = it.size, mates = groupOf(room, it)) {
  const me = { ...it, at, size };
  const R = footprint(me);
  const out = [];
  if (outside(O, R) > 0.01) out.push({ kind: "wall" });
  if (!solid(me)) return out;
  for (const o of [...room.fixtures, ...room.furniture]) {
    if (o === it || mates.includes(o) || !solid(o) || tucked(o, me)) continue;
    if (overlap(footprint(o), R).depth > DEPTH) out.push({ kind: "overlap", other: o });
  }
  for (const op of O.openings.filter((x) => x.passable))
    if (hitsSwing(op, R) || overlap(doorwayRect(op, 0.5), R).depth > DEPTH) out.push({ kind: "door", other: op });
  return out;
}

// The shortest legal move for `it` (and the rest of its group), or null. Legal: no problem at all at the new spot.
function shortMove(room, O, it, w, l, max = MAX_STEP) {
  const group = groupOf(room, it);
  const boxes = group.map(bbox);
  const box = [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
  let best = null;
  for (const [axis, sign] of [[0, 1], [0, -1], [1, 1], [1, -1]]) {
    // standing against a wall: slide along it, never off it
    if (sign > 0 && box[axis] <= WALL) continue;
    if (sign < 0 && box[axis + 2] >= [w, l][axis] - WALL) continue;
    for (let d = STEP; d <= max + 1e-9; d += STEP) {
      if (best && d >= best.d) break;
      const shift = (i) => i.at.map((v, k) => (k === axis ? r3(v + sign * d) : v));
      if (group.every((g) => !problems(room, O, g, shift(g)).length)) { best = { d, apply: () => group.forEach((g) => { g.at = shift(g); }) }; break; }
    }
  }
  return best;
}

const FITTED = new Set(["cupboard", "shelf"]);
// Cut a fitted run along its length from one end, keeping the other end where it was, until nothing is wrong.
function trim(room, O, it, w, l) {
  if (!FITTED.has(it.category) || groupOf(room, it).length > 1) return null;
  const b = bbox(it);
  if (!(b[0] <= WALL || b[1] <= WALL || b[2] >= w - WALL || b[3] >= l - WALL)) return null;
  const t = ((it.rot ?? 0) * Math.PI) / 180, ux = [Math.cos(t), Math.sin(t)];
  // cut a from one end and b from the other, the least in total first
  const cuts = [];
  for (let a = 0; a <= it.size[0] - 0.4 + 1e-9; a += 0.05) for (let b = 0; a + b <= it.size[0] - 0.4 + 1e-9; b += 0.05) if (a + b > 0) cuts.push([a, b]);
  cuts.sort((p, q) => p[0] + p[1] - (q[0] + q[1]));
  for (const [a, b] of cuts) {
    const shift = (a - b) / 2;   // the centre moves towards the end cut less
    const at = [r3(it.at[0] + ux[0] * shift), r3(it.at[1] + ux[1] * shift)];
    const size = [r3(it.size[0] - a - b), it.size[1], it.size[2]];
    if (!problems(room, O, it, at, size).length) return { cut: a + b, apply: () => Object.assign(it, { at, size }) };
  }
  return null;
}

// Back against the wall: a big piece the reading leaves a little off a wall (a gap nobody can walk through)
// stands against it. Only where the move is legal.
const AGAINST = new Set(["sofa", "cupboard", "shelf", "bed", "desk", "radiator"]);
const SNAP = 0.5;
function snapToWalls(room, O, w, l, repairs) {
  for (const it of room.furniture) {
    if (!AGAINST.has(it.category) || it.id.endsWith("_chaise")) continue;
    const group = groupOf(room, it), boxes = group.map(bbox);
    const box = [Math.min(...boxes.map((x) => x[0])), Math.min(...boxes.map((x) => x[1])), Math.max(...boxes.map((x) => x[2])), Math.max(...boxes.map((x) => x[3]))];
    const gaps = [[0, -box[0]], [0, w - box[2]], [1, -box[1]], [1, l - box[3]]]   // [axis, signed move to that wall]
      .filter(([, d]) => Math.abs(d) > 0.02 && Math.abs(d) < SNAP).sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]));
    for (const [axis, d] of gaps) {
      const shift = (i) => i.at.map((v, k) => (k === axis ? r3(v + d) : v));
      if (group.every((g) => !problems(room, O, g, shift(g)).length)) {
        group.forEach((g) => { g.at = shift(g); });
        repairs.push(`${it.id} moved ${Math.round(Math.abs(d) * 100)} cm back to the wall (too close to walk past, too far to be off it)`);
        break;
      }
    }
  }
}

// A gap under 60 cm that isn't closed is a way nobody can use. At photo accuracy it is a misread, so open it
// to 62 cm when a short move (≤ 25 cm) of one piece does it legally: between a piece and a wall, or between
// two pieces facing each other across it.
const WAY = 0.62, NUDGE = 0.25;
function openGaps(room, O, w, l, repairs) {
  const items = room.furniture.filter(solid);
  const tryMove = (it, axis, d, why) => {
    if (Math.abs(d) > NUDGE + 1e-9) return false;
    const group = groupOf(room, it), shift = (i) => i.at.map((v, k) => (k === axis ? r3(v + d) : v));
    if (!group.every((g) => !problems(room, O, g, shift(g)).length)) return false;
    group.forEach((g) => { g.at = shift(g); });
    repairs.push(`${it.id} moved ${Math.round(Math.abs(d) * 100)} cm to leave a ${Math.round(WAY * 100)} cm way ${why}`);
    return true;
  };
  for (const it of items) {
    const b = bbox(it);
    for (const [axis, gap, dir] of [[0, b[0], 1], [0, w - b[2], -1], [1, b[1], 1], [1, l - b[3], -1]])
      if (gap > 0.02 && gap < WAY - 0.02) tryMove(it, axis, dir * (WAY - gap), `by the ${["west", "east", "south", "north"][axis * 2 + (dir < 0 ? 1 : 0)]} wall`);
  }
  for (const a of items) for (const c of items) {
    if (a === c || groupOf(room, a).includes(c) || tucked(a, c)) continue;
    const A = bbox(a), C = bbox(c);
    for (const axis of [0, 1]) {
      const o = 1 - axis;
      if (Math.min(A[o + 2], C[o + 2]) - Math.max(A[o], C[o]) <= 0.1) continue;   // not facing each other
      const gap = C[axis] - A[axis + 2];                                       // c beyond a along axis
      if (gap > 0.02 && gap < WAY - 0.02) {
        const [small, d] = a.size[0] * a.size[1] <= c.size[0] * c.size[1] ? [a, -(WAY - gap)] : [c, WAY - gap];
        tryMove(small, axis, d, `between the ${(a.name || a.id).toLowerCase()} and the ${(c.name || c.id).toLowerCase()}`);
      }
    }
  }
}

// Slide an opening along its wall (≤ 1.5 m) to where nothing stands in it. Returns the distance, or null.
function slideOpening(room, id) {
  const wall = room.walls.find((x) => x.openings.some((o) => o.id === id));
  const op = wall.openings.find((o) => o.id === id), from = op.from;
  const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
  const clear = () => {
    const O = outline(room), o = O.openings.find((x) => x.id === id);
    const others = wall.openings.filter((x) => x !== op);
    if (others.some((x) => x.from < op.from + op.width && op.from < x.from + x.width)) return false;
    return room.furniture.filter(solid).every((i) => !hitsSwing(o, footprint(i)) && overlap(doorwayRect(o, 0.5), footprint(i)).depth <= DEPTH);
  };
  for (let d = 0.05; d <= 1.5 + 1e-9; d += 0.05)
    for (const s of [1, -1]) {
      const f = r3(from + s * d);
      if (f < 0 || f + op.width > len) continue;
      op.from = f;
      if (clear()) return d;
    }
  op.from = from;
  return null;
}

const bbox = (i) => {
  const [fx, fy] = (((i.rot ?? 0) % 180) + 180) % 180 === 90 ? [i.size[1], i.size[0]] : [i.size[0], i.size[1]];
  return [i.at[0] - fx / 2, i.at[1] - fy / 2, i.at[0] + fx / 2, i.at[1] + fy / 2];
};

/**
 * room: built by roomFromReading (box room, w x l). guessed: ids whose footprint is a category default.
 * Changes room.furniture in place. Returns { repairs: [string], left_out: [string] }.
 */
export function settle(room, guessed = new Set()) {
  let O = outline(room);
  const xs = room.walls.flatMap((x) => [x.a[0], x.b[0]]), ys = room.walls.flatMap((x) => [x.a[1], x.b[1]]);
  const w = Math.max(...xs), l = Math.max(...ys);
  const repairs = [], left_out = [];
  const movable = (i) => room.furniture.includes(i);
  const name = (i) => (i.name || i.id).toLowerCase();
  for (let round = 0; round < 60; round++) {
    let conflict = null;
    for (const it of room.furniture) {
      const p = problems(room, O, it);
      if (p.length) { conflict = { it, p: p[0] }; break; }
    }
    if (!conflict) break;
    const { it, p } = conflict;
    const cands = [it, ...(p.kind === "overlap" && movable(p.other) ? [p.other] : [])];
    // 1. the shortest move of either piece
    const moves = cands.map((c) => ({ c, m: shortMove(room, O, c, w, l, p.kind === "door" ? DOOR_STEP : MAX_STEP) })).filter((x) => x.m).sort((a, b) => a.m.d - b.m.d);
    if (moves.length) {
      const { c, m } = moves[0];
      m.apply();
      repairs.push(`${c.id} moved ${Math.round(m.d * 100)} cm (${why(p, it, c)})`);
      continue;
    }
    // 2. a fitted run against a wall (kitchen units, wardrobes, shelving) ends at a door or the unit next to it
    const run = cands.map((c) => ({ c, t: trim(room, O, c, w, l) })).filter((x) => x.t).sort((a, b) => a.t.cut - b.t.cut)[0];
    if (run) {
      run.t.apply();
      repairs.push(`${run.c.id} cut ${Math.round(run.t.cut * 100)} cm shorter (${why(p, it, run.c)})`);
      continue;
    }
    // 3. a guessed size gives way
    const g = cands.find((c) => guessed.has(c.id));
    const min = g && (MIN[g.category] ?? MIN.other);
    if (g && (g.size[0] > min[0] + 0.01 || g.size[1] > min[1] + 0.01)) {
      const was = bbox(g);
      g.size = [r3(Math.max(min[0], g.size[0] * 0.8)), r3(Math.max(min[1], g.size[1] * 0.85)), g.size[2]];
      // it stays against the walls it stood against
      const now = bbox(g);
      g.at = g.at.map((v, ax) => r3(was[ax] <= WALL ? v - (now[ax] - was[ax]) : was[ax + 2] >= [w, l][ax] - WALL ? v + (was[ax + 2] - now[ax + 2]) : v));
      if (!repairs.at(-1)?.startsWith(`${g.id} shrunk`)) repairs.push(`${g.id} shrunk: its size was a guess (${why(p, it, g)})`);
      continue;
    }
    // an L-sofa's chaise end may be on the wrong end: try the other end, then a straight sofa
    const ch = cands.find((c) => c.id.endsWith("_chaise"));
    if (ch && !ch.flipped) {
      const main = room.furniture.find((i) => i.id === ch.id.replace(/_chaise$/, ""));
      const t = ((main.rot ?? 0) * Math.PI) / 180, ux = [Math.cos(t), Math.sin(t)];
      const u = (ch.at[0] - main.at[0]) * ux[0] + (ch.at[1] - main.at[1]) * ux[1];
      const at = [r3(ch.at[0] - 2 * u * ux[0]), r3(ch.at[1] - 2 * u * ux[1])];
      ch.flipped = true;
      if (!problems(room, O, ch, at).length) { ch.at = at; repairs.push(`${main.id}: chaise end put at the other end (${why(p, it, ch)})`); continue; }
    }
    // a door read where a measured sofa, bed or kitchen stands: the door's place is as rough as the piece's,
    // and the piece was measured, so the opening slides along its wall to the nearest clear stretch
    if (p.kind === "door" && !guessed.has(it.id)) {
      const slid = slideOpening(room, p.other.id);
      if (slid) { O = outline(room); repairs.push(`${p.other.id} moved ${Math.round(slid * 100)} cm along its wall (${(it.name || it.id).toLowerCase()} stood in it)`); continue; }
    }
    if (ch) {
      room.furniture = room.furniture.filter((i) => i !== ch);
      left_out.push(`${ch.name}: left out, the photos put it ${p.kind === "door" ? "in a doorway" : `on top of ${name(ch === it ? p.other : it)}`}; the sofa is drawn straight`);
      continue;
    }
    // 4. leave it out rather than draw it where it can't be
    const out = g ?? [...cands].sort((a, b) => a.size[0] * a.size[1] - b.size[0] * b.size[1])[0];
    const gone = groupOf(room, out);
    room.furniture = room.furniture.filter((i) => !gone.includes(i));
    left_out.push(`${out.name}: left out, the photos put it ${p.kind === "door" ? "in a doorway" : p.kind === "wall" ? "through a wall" : `on top of ${name(out === it ? p.other : it)}`} and no short move clears it`);
  }
  snapToWalls(room, O, w, l, repairs);
  openGaps(room, O, w, l, repairs);
  for (const i of room.furniture) delete i.flipped;
  return { repairs, left_out };
}

function why(p, it, mover) {
  if (p.kind === "door") return `it stood in the ${p.other.id.replace(/_/g, " ")}`;
  if (p.kind === "wall") return "it went through a wall";
  const other = mover === it ? p.other : it;
  return `it overlapped the ${(other.name || other.id).toLowerCase()}`;
}
