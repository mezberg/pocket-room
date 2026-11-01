// The designer's plan for a new piece: like an interior designer, weigh three ways to bring it in.
//   place   — a free spot as the room is (rules/ place(), no replacing)
//   move    — move one or two pieces out of the way first, then put it there (the spot is measured again with
//             them moved; the moves make no walkway or door worse)
//   replace — take the old piece of the same kind out and put the new one there (place() swap spots)
// Code finds and measures every plan; the Decisions API picks one with a probability and the reason that
// decided it (designer/pick.mjs). Plans come back as steps the app can preview and apply.
import { footprint, outline, overlap, outside, doorwayRect, hitsSwing, compass, cm, r2 } from "../rules/geom.mjs";
import { obstacles, blocksFloor, occupies, stacked, label } from "../rules/grid.mjs";
import { place, candidates, WALK_MIN, WALK_OK } from "../rules/place.mjs";
import { snap, worse, byId, under } from "../fixes/measure.mjs";

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]];
// What a designer would shift to make room (not built-ins, beds, wardrobes; nothing over 1.2 m²).
const STAY = new Set(["bed", "wardrobe", "cupboard", "radiator", "rug", "sofa"]);
const movable = (room, it) => !(room.fixtures ?? []).some((f) => f.id === it.id) && blocksFloor(it) && !STAY.has(it.category) && it.size[0] * it.size[1] <= 1.2;

const nice = (id) => String(id).replace(/[_-]+/g, " ");
const where = (s) => (s.wall ? `on the ${nice(s.wall)} wall` : "in the middle of the room");
const pieceName = (p) => `the new ${p.category === "other" ? "piece" : p.category}`;

// One spot per wall (and per old piece replaced): people choose between places, not 10 cm nudges.
function distinct(spots, max) {
  const seen = new Map();
  for (const s of spots) {
    const k = `${s.wall ?? "centre"}|${s.replaces ?? ""}`;
    if (!seen.has(k)) seen.set(k, s);
  }
  return [...seen.values()].slice(0, max);
}

export function planPiece(room, piece, { budgetMs = 3000, maxMoveEvals = 24 } = {}) {
  const t0 = performance.now();
  const item = { ...piece, id: piece.id ?? "new" };
  const plans = [];

  // place and replace: rules/ place() with its swap spots
  const all = place(room, item, {});
  const free = all.spots.filter((s) => !s.replaces);
  const swaps = all.spots.filter((s) => s.replaces);
  for (const s of distinct(free, 3)) {
    plans.push({ kind: "place", spot: s, moves: [], say: `Put ${pieceName(piece)} ${where(s)}: nothing else moves.` });
  }
  for (const s of distinct(swaps, 2)) {
    const old = byId(room, s.replaces);
    plans.push({ kind: "replace", spot: s, moves: [], say: `Replace ${old ? label(old) : "the old one"} with ${pieceName(piece)}, where it stands now.` });
  }

  // move then place: wall spots where only one or two movable pieces stand in the way
  const bestFree = free[0];
  const moved = moveThenPlace(room, item, { t0, budgetMs, maxEvals: maxMoveEvals, better: bestFree });
  plans.push(...moved.found);

  for (const p of plans) {
    p.verdict = p.spot.verdict;
    p.steps = [...p.moves.flatMap((m) => m.steps), { place: { at: p.spot.at, rot: p.spot.rot, ...(p.spot.replaces ? { replaces: p.spot.replaces } : {}) } }];
  }
  // the order before the Decisions call: verdict, then fewer moves, then the rules' score
  const rank = { "Fits": 0, "Just fits": 1, "Doesn't fit": 2 };
  plans.sort((a, b) => rank[a.verdict] - rank[b.verdict] || (a.kind === "move") - (b.kind === "move") || b.spot.score - a.spot.score);
  plans.forEach((p, i) => { p.id = `plan${i + 1}`; });
  return { plans, near_miss: all.spots.length ? null : all.say, why: plans.length ? null : whyNot(all, moved.why, piece), ms: Math.round(performance.now() - t0) };
}

// No plan at all: why, in plain words, from what place() and the move search saw.
function whyNot(all, why, piece) {
  const base = (all.say ?? "").replace(/^Doesn't fit\.\s*/, "");
  if (!why.cands) return `No spot, even after moving things: ${base.charAt(0).toLowerCase()}${base.slice(1)} Nothing that could move stands in the way of a better one.`;
  const parts = [];
  if (why.worse) parts.push("moving what's in the way would narrow a walkway below 60 cm");
  if (why.nospot) parts.push("the spots it frees leave too little room in front or to walk past");
  if (why.relocate && !parts.length) parts.push("there's nowhere free to move what's in the way");
  return `No spot, even after moving things: ${parts.join(", and ") || "nothing clears a spot"}. A smaller ${piece.category === "other" ? "piece" : piece.category} might.`;
}

// Room needed in front to use it (as rules/place.mjs): the footprint grown forward by that much is what
// has to be cleared.
const FRONT = { sofa: 0.3, armchair: 0.3, bed: 0.3, desk: 0.6, wardrobe: 0.6, cupboard: 0.6, dresser: 0.6, shelf: 0.4, tv: 0.5 };
function useArea(piece, c) {
  const P = footprint(piece, c.at, c.rot), f = FRONT[piece.category] ?? 0.3;
  // front is -uy: move the centre forward by f/2 and deepen by f
  return { ...P, c: [P.c[0] - P.uy[0] * f / 2, P.c[1] - P.uy[1] * f / 2], hd: P.hd + f / 2 };
}

// The pieces standing where the new one would go (or in front of it), if they're all movable (≤ 2), else null.
function blockersAt(room, O, piece, c) {
  const P0 = footprint(piece, c.at, c.rot), P = useArea(piece, c);
  if (outside(O, P0) > 0.01 || (piece.size[2] ?? 0) > (room.height ?? 9)) return null;
  for (const op of O.openings) {
    if (!op.passable) continue;
    if (overlap(doorwayRect(op), P0).depth > 0.005 || hitsSwing(op, P0)) return null;
  }
  const hit = [];
  for (const o of obstacles(room)) {
    if (overlap(o.R, P).depth <= 0.005) continue;
    if (o.fixed || o.item.category === "radiator" || !movable(room, o.item)) return null;
    hit.push(o.item);
  }
  return hit.length && hit.length <= 2 ? { P, hit } : null;
}

// A dining table moves with its chairs.
function groupOf(room, it) {
  const isTable = (it.category === "table" || it.category === "desk") && it.size[2] >= 0.65;
  const table = isTable ? it : (room.furniture ?? []).find((t) => under(it, t) && overlap(footprint(t), footprint(it)).depth > -0.3);
  if (!table) return [it];
  return [table, ...(room.furniture ?? []).filter((c) => under(c, table) && overlap(footprint(table), footprint(c)).depth > -0.3)];
}

// Places for a group of pieces clear of the new piece's footprint, the walls, the doors and everything else:
// the nearest one in each direction, nearest first.
function relocations(room, O, group, P, taken) {
  const ids = new Set(group.map((x) => x.id));
  const others = [...(room.fixtures ?? []), ...(room.furniture ?? [])].filter((o) => !ids.has(o.id) && occupies(o));
  const fits = (moved) => moved.every((m) => {
    const R = footprint(m);
    if (outside(O, R) > 0.01 || overlap(R, P).depth > -0.05) return false;
    for (const op of O.openings) if (op.passable && (overlap(doorwayRect(op, 0.5), R).depth > 0.005 || hitsSwing(op, R))) return false;
    for (const o of [...others, ...taken]) {
      if (ids.has(o.id) || under(m, o) || under(o, m) || stacked(m, o)) continue;
      if (overlap(footprint(o), R).depth > 0.01) return false;
    }
    return true;
  });
  const out = [];
  for (const v of DIRS) {
    for (let d = 0.1; d <= 2.0 + 1e-9; d = r2(d + 0.1)) {
      const moved = group.map((x) => ({ ...x, at: [r2(x.at[0] + v[0] * d), r2(x.at[1] + v[1] * d)] }));
      if (fits(moved)) { out.push({ moved, d, v }); break; }
    }
  }
  return out.sort((a, b) => a.d - b.d);
}

function moveThenPlace(room, piece, { t0, budgetMs, maxEvals, better }) {
  const O = outline(room);
  const found = [];
  const cands = [];
  for (const c of candidates(O, piece)) {
    if (!c.wall) continue;
    const b = blockersAt(room, O, piece, c);
    if (b) cands.push({ c, ...b, area: b.hit.reduce((s, x) => s + x.size[0] * x.size[1], 0) });
  }
  cands.sort((a, b) => a.area - b.area);
  const s0 = snap(room, O);
  let evals = 0;
  const why = { cands: cands.length, relocate: 0, worse: 0, nospot: 0, notbetter: 0 };   // what stopped the rest (for tests and logs)
  const triedWalls = new Map();
  for (const k of cands) {
    if (evals >= maxEvals || performance.now() - t0 > budgetMs) break;
    if ((triedWalls.get(k.c.wall) ?? 0) >= 4) continue;   // a few tries per wall, then the next wall
    // move each blocker (with its chairs) out of the way: the nearest place that makes no walkway or door worse
    let r2room = room;
    const moves = [], taken = [];
    let ok = true;
    const done = new Set();
    for (const it of k.hit) {
      if (done.has(it.id)) continue;
      const group = groupOf(r2room, byId(r2room, it.id));
      group.forEach((g) => done.add(g.id));
      let got = null;
      for (const rel of relocations(r2room, O, group, k.P, taken).slice(0, 5)) {
        if (performance.now() - t0 > budgetMs) break;
        const trial = { ...r2room, furniture: r2room.furniture.map((x) => rel.moved.find((m) => m.id === x.id) ?? x) };
        const st = snap(trial, O);
        if (worse(s0, st, new Set(), { floor: WALK_MIN }).length) { why.worse++; continue; }
        got = { rel, room: trial, narrowed: worse(s0, st) };
        break;
      }
      if (!got) { ok = false; break; }
      const { rel } = got;
      taken.push(...rel.moved);
      r2room = got.room;
      const name = group.length > 1 ? `${label(group[0])} and its chairs` : label(group[0]);
      moves.push({ items: group.map((g) => g.id), say: `${moves.length ? "move" : "Move"} ${name} ${cm(rel.d)} ${compass(rel.v)}`, d: rel.d, steps: rel.moved.map((m) => ({ item: m.id, at: m.at, rot: m.rot ?? 0 })),
        narrowed: got.narrowed.filter((x) => x.kind === "walkway").map((x) => ({ key: x.key, before_m: r2(Math.min(x.before, 2)), after_m: r2(x.after) })) });
    }
    if (!ok) { why.relocate++; continue; }
    evals++;
    triedWalls.set(k.c.wall, (triedWalls.get(k.c.wall) ?? 0) + 1);
    const pl = place(r2room, piece, { replace: false, at: k.c });
    const spot = pl.spots[0];
    if (!spot) { why.nospot++; continue; }
    // only worth it if it beats placing it as the room is
    if (better && !(spot.verdict === "Fits" && better.verdict !== "Fits") && spot.clearance_m <= better.clearance_m + 0.1) { why.notbetter++; continue; }
    if (found.some((f) => f.spot.wall === spot.wall)) continue;
    found.push({ kind: "move", spot, moves, room: r2room, say: `${moves.map((m) => m.say).join(", then ")}, then put ${pieceName(piece)} ${where(spot)}.` });
    if (found.length >= 2) break;
  }
  return { found, why };
}
