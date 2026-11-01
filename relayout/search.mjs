// Rearrange the whole room: a beam search over whole-zone moves (the seating group with its TV, the dining set,
// the desk, single pieces), each layout measured by rules/ (the same overlaps, door swings, walls and walkway grid
// as Check my room) and scored by code. A piece a zone bumps into is moved aside to the nearest free floor.
// No model here: every number is measured.
import { footprint, outline, outside, overlap, doorwayRect, hitsSwing, compass, cm, r2, sdRoom } from "../rules/geom.mjs";
import { blocksFloor, label } from "../rules/grid.mjs";
import { candidates } from "../rules/place.mjs";
import { snap, byId, bumped, allItems } from "../fixes/measure.mjs";
import { tucked } from "../rules/check.mjs";
import { zonesOf, stays } from "./zones.mjs";

export const CLOSED = 0.59, TIGHT = 0.75;
const AX = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]];
const DISTS = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0, 1.2, 1.5, 1.8, 2.2, 2.6, 3.0];
const area = (it) => it.size[0] * it.size[1];

// ------------------------------------------------------------------ room edits
const moveIds = (room, ids, v, d) => ({ ...room, furniture: room.furniture.map((x) => (ids.includes(x.id) ? { ...x, at: [r2(x.at[0] + v[0] * d), r2(x.at[1] + v[1] * d)] } : x)) });
const setAt = (room, id, at, rot) => ({ ...room, furniture: room.furniture.map((x) => (x.id === id ? { ...x, at: [r2(at[0]), r2(at[1])], ...(rot != null ? { rot } : {}) } : x)) });
export const removeId = (room, id) => ({ ...room, furniture: room.furniture.filter((x) => x.id !== id), lights: (room.lights ?? []).filter((l) => l.id !== id) });

// Geometry only (microseconds): every piece in `ids` is inside the walls, and stands no deeper in a doorway or
// door swing, or in another piece, than it did before (a room built from photos may start with a sofa half in an
// opening; a move may leave that as it is, never make it worse).
const doorDepth = (O, R) => Math.max(0, ...O.openings.filter((o) => o.passable).map((op) => Math.max(overlap(doorwayRect(op, 0.5), R).depth, hitsSwing(op, R) ? 0.02 : 0)));
function fits(room0, room2, ids, O) {
  const all = allItems(room2);
  for (const id of ids) {
    const it = all.find((x) => x.id === id);
    if (!it || !blocksFloor(it)) continue;
    const R = footprint(it), was = byId(room0, id), W0 = was ? footprint(was) : null;
    if (outside(O, R) > Math.max(0.01, W0 ? outside(O, W0) + 0.001 : 0)) return false;
    const dd = doorDepth(O, R);
    if (dd > 0.005 && dd > (W0 ? doorDepth(O, W0) : 0) + 0.001) return false;
    for (const o of all) {
      if (o.id === id || !blocksFloor(o) || tucked(o, it)) continue;
      const o0 = byId(room0, o.id) ?? o;
      const before = was ? overlap(footprint(o0), W0).depth : 0;
      if (overlap(footprint(o), R).depth > Math.max(0.01, before + 0.001)) return false;
    }
  }
  return true;
}

// A small loose piece in the way goes to the nearest free floor (rings of 10 cm out to 1.5 m, same turn or a
// quarter turn), or back against the nearest wall.
const SMALL = 0.8;   // m²
function aside(room, it, O, fixedIds) {
  const pts = [];
  for (let r = 0.1; r <= 1.5 + 1e-9; r = r2(r + 0.1)) for (let k = 0; k < 16; k++) {
    const a = (k / 16) * 2 * Math.PI;
    pts.push({ at: [it.at[0] + Math.cos(a) * r, it.at[1] + Math.sin(a) * r], rot: it.rot ?? 0, d: r });
  }
  for (const c of candidates(O, it)) {
    const d = Math.hypot(c.at[0] - it.at[0], c.at[1] - it.at[1]);
    if (d <= 2.5) pts.push({ at: c.at, rot: c.rot, d: d + 0.05 });
  }
  pts.sort((a, b) => a.d - b.d);
  for (const p of pts) {
    const room2 = setAt(room, it.id, p.at, p.rot);
    if (fits(room, room2, [it.id], O) && !fixedIds.some((id) => overlap(footprint(byId(room2, id)), footprint(byId(room2, it.id))).depth > 0.01)) return { room: room2, at: byId(room2, it.id).at, rot: p.rot, d: p.d };
  }
  return null;
}

// Move `ids` by v·d; anything small and loose they run into steps aside. → { room, displaced } or null
function moveZone(room, z, ids, v, d, O, ctx) {
  let room2 = moveIds(room, ids, v, d);
  if (fits(room, room2, ids, O)) return { room: room2, displaced: [] };
  // still clear of walls and doors? then see what it bumps
  for (const id of ids) {
    const it = byId(room2, id), was = byId(room, id);
    if (!it || !blocksFloor(it)) continue;
    const R = footprint(it), W0 = footprint(was);
    if (outside(O, R) > Math.max(0.01, outside(O, W0) + 0.001)) return null;
    const dd = doorDepth(O, R);
    if (dd > 0.005 && dd > doorDepth(O, W0) + 0.001) return null;
  }
  const hit = bumped(room, room2, ids);
  if (!hit.length || hit.length > 2) return null;
  const displaced = [];
  for (const b of hit) {
    const bz = ctx.zoneOf.get(b.id);
    if (!bz || bz.kind !== "piece" || bz.items.length > 1 || area(b) > SMALL || (ctx.pinned?.has(b.id))) return null;
    const got = aside(room2, b, O, ids);
    if (!got) return null;
    displaced.push({ item: b.id, from: byId(room, b.id).at, at: got.at, rot: got.rot, d: got.d });
    room2 = got.room;
  }
  return fits(room, room2, ids, O) ? { room: room2, displaced } : null;
}

// ------------------------------------------------------------------ measuring and scoring a layout
// Glazing and how far daylight reaches in from it (twice the head height, as decisions/design.mjs).
function glazingOf(room, O) {
  const head = new Map(room.walls.flatMap((w) => (w.openings ?? []).map((o) => [o.id, o.head ?? 2.1])));
  return O.openings.filter((o) => o.kind === "window" || o.kind === "glazed_door").map((o) => ({ mid: o.mid, reach: 2 * head.get(o.id) }));
}

export function measure(room, O, ctx) {
  const s = snap(room, O);
  const ways = [...s.rs.values()];
  let closed = 0, closedShort = 0, tight = 0, tightShort = 0, narrowest = Infinity;
  for (const r of ways) {
    const w = r.width, k = r.type === "window" ? 0.3 : 1;
    if (r.type !== "window") narrowest = Math.min(narrowest, w);
    if (w < CLOSED) { closed += k; closedShort += k * (0.6 - Math.max(0, w)); } else if (w < TIGHT) { tight += k; tightShort += k * (TIGHT - w); }
  }
  const hard = s.ov.size + s.door.size + s.out.size;
  // seating: still faces its TV square on (within 30°)?
  let tvOff = 0;
  for (const z of ctx.zones.filter((z) => z.kind === "seating" && z.tv)) {
    const sofa = byId(room, z.lead), tv = byId(room, ctx.byZone.get(z.tv).lead);
    if (!sofa || !tv) continue;
    const R = footprint(sofa), f = [-R.uy[0], -R.uy[1]], d = [tv.at[0] - sofa.at[0], tv.at[1] - sofa.at[1]];
    const deg = Math.acos(Math.max(-1, Math.min(1, (d[0] * f[0] + d[1] * f[1]) / (Math.hypot(...d) || 1)))) * 180 / Math.PI;
    tvOff += Math.max(0, deg - 15);
  }
  // daylight: the main zones (seating, dining, desk) within reach of the glass
  const lit = ctx.zones.filter((z) => z.kind !== "piece" && z.kind !== "tv").filter((z) => {
    const it = byId(room, z.lead);
    return it && ctx.glazing.some((g) => Math.hypot(it.at[0] - g.mid[0], it.at[1] - g.mid[1]) <= g.reach);
  }).length;
  // a light within 2 m of each zone (decisions/design.mjs, lamps_per_zone); a floor lamp's light goes where it goes
  const lights = (room.lights ?? []).map((l) => byId(room, l.id)?.at ?? (ctx.lamps.has(l.id) ? null : l.at)).filter(Boolean);
  const unlit = ctx.zones.filter((z) => z.kind !== "piece" && z.kind !== "tv").filter((z) => {
    const it = byId(room, z.lead);
    return it && !lights.some((p) => Math.hypot(it.at[0] - p[0], it.at[1] - p[1]) <= 2);
  }).length;
  return { s, hard, unlit, closed: r2(closed), closedShort: r2(closedShort), tight: r2(tight), tightShort: r2(tightShort), narrowest: r2(narrowest), tvOff: Math.round(tvOff), lit };
}

// Lower is better. Walls of furniture and squeezes dominate; then TV, daylight; then how much has to move.
export function score(m, cost = 0) {
  return 60 * m.hard + 12 * m.closed + 40 * m.closedShort + 1.5 * m.tight + 12 * m.tightShort + m.tvOff / 10 - 0.6 * m.lit + 0.8 * m.unlit + cost;
}
// what a move costs: a sofa is harder to shift than a stool, and every piece moved is one more thing to do
const moveCost = (room, ids, d) => ids.reduce((s, id) => { const it = byId(room, id); return s + (it && it.on_floor !== false ? 0.25 + 0.35 * d * (1 + area(it)) : 0); }, 0);

// ------------------------------------------------------------------ the search
// The moves a zone can make from where it stands. The seating slides along its wall with its TV (so it still
// faces it), or a little towards / away from it on its own; everything else in 8 directions.
function movesFor(room, z, ctx) {
  const out = [];
  const ids = z.items;
  if (z.kind === "tv" && ctx.byZone.get(z.faces)) {
    // towards or away from its sofa only, so it still faces it
    const tv = byId(room, z.lead), R = footprint(tv), f = [-R.uy[0], -R.uy[1]];
    for (const v of [f, [-f[0], -f[1]]]) for (const d of DISTS.filter((d) => d <= 1.0)) out.push({ ids, v, d, z });
    return out;
  }
  if (z.kind === "seating") {
    const s = byId(room, z.lead), R = footprint(s), f = [-R.uy[0], -R.uy[1]], side = [R.ux[0], R.ux[1]];
    const both = z.tv ? [...ids, ...ctx.byZone.get(z.tv).items] : ids;
    // along its wall, with its TV; off the wall towards the TV (with it, or on its own a little)
    for (const v of [side, [-side[0], -side[1]]]) for (const d of DISTS) out.push({ ids: both, v, d, z });
    for (const v of [f, [-f[0], -f[1]]]) for (const d of DISTS.filter((d) => d <= 0.6)) { out.push({ ids, v, d, z }); if (z.tv) out.push({ ids: both, v, d, z }); }
    return out;
  }
  for (const v of [...AX, ...DIAG]) for (const d of DISTS) out.push({ ids, v, d, z });
  return out;
}

// Zones worth trying: any with a piece near a way that is closed or tight (within `r` of its narrowest point).
function nearProblems(room, m, zones, r = 1.2) {
  const pins = [...m.s.rs.values()].filter((x) => x.width < TIGHT && x.at).map((x) => x.at);
  return new Set(zones.filter((z) => z.items.some((id) => {
    const it = byId(room, id);
    return it && pins.some((p) => Math.hypot(it.at[0] - p[0], it.at[1] - p[1]) < r + Math.max(...it.size.slice(0, 2)) / 2);
  })).map((z) => z.id));
}

const sig = (room) => (room.furniture ?? []).map((x) => `${x.id}@${x.at.map((v) => Math.round(v * 20)).join(",")}`).join(";");

// state = { room, moves: [{ zone, v, d, displaced }], cost, m, score }
export function rearrange(room, { budgetMs = 9000, beam = 4, rounds = 6, pinned = new Set(), zones: zs, bucket = false } = {}) {
  const t0 = performance.now();
  const O = outline(room);
  const zones = zs ?? zonesOf(room);
  const ctx = { zones, byZone: new Map(zones.map((z) => [z.id, z])), zoneOf: new Map(zones.flatMap((z) => z.items.map((id) => [id, z]))), glazing: glazingOf(room, O), pinned, lamps: new Set((room.furniture ?? []).map((x) => x.id)) };
  const m0 = measure(room, O, ctx);
  const start = { room, moves: [], cost: 0, m: m0, score: score(m0) };
  const seen = new Set([sig(room)]);
  let frontier = [start], all = [start], evals = 1, geo = 0;
  const late = () => performance.now() - t0 > budgetMs;

  for (let round = 0; round < rounds && !late(); round++) {
    const next = [];
    for (const st of frontier) {
      if (late()) break;
      const done = new Set(st.moves.map((x) => x.zone));
      // the first round tries every zone (whole-zone moves free space far away); later ones what's near a squeeze
      const near = nearProblems(st.room, st.m, zones, round ? 1.0 : 1.2);
      for (const z of zones) {
        if (done.has(z.id) || ((z.kind === "piece" || round) && !near.has(z.id)) || z.items.some((id) => pinned.has(id))) continue;
        for (const mv of movesFor(st.room, z, ctx)) {
          if (late()) break;
          geo++;
          const got = moveZone(st.room, z, mv.ids, mv.v, mv.d, O, ctx);
          if (!got) continue;
          const k = sig(got.room);
          if (seen.has(k)) continue;
          seen.add(k);
          evals++;
          const m = measure(got.room, O, ctx);
          const cost = st.cost + moveCost(room, mv.ids, mv.d) + got.displaced.reduce((s, x) => s + 0.3 + 0.35 * x.d, 0);
          const s2 = { room: got.room, moves: [...st.moves, { zone: z.id, ids: mv.ids, v: mv.v, d: mv.d, displaced: got.displaced }], cost, m, score: score(m, cost) };
          next.push(s2);
        }
      }
    }
    if (!next.length) break;
    next.sort((a, b) => a.score - b.score);
    all.push(...next.slice(0, 40));
    // keep the best few that differ in what they moved
    const keep = [], kinds = new Set();
    for (const s of next) {
      const k = s.moves.map((x) => (bucket ? `${x.zone}~${Math.round(x.d * 2)}` : x.zone)).sort().join("|");
      if (kinds.has(k)) continue;
      kinds.add(k); keep.push(s);
      if (keep.length >= beam) break;
    }
    // stop once nothing beats where we are
    if (keep[0].score >= Math.min(...frontier.map((f) => f.score)) - 0.05) { break; }
    frontier = keep;
  }
  all.sort((a, b) => a.score - b.score);
  return { start, best: all, zones, ctx, O, evals, geo, ms: Math.round(performance.now() - t0) };
}

// ------------------------------------------------------------------ words
const towards = (v, from, glazing) => {
  if (!glazing.length) return "";
  const g = glazing.reduce((a, b) => (Math.hypot(b.mid[0] - from[0], b.mid[1] - from[1]) < Math.hypot(a.mid[0] - from[0], a.mid[1] - from[1]) ? b : a));
  const d = [g.mid[0] - from[0], g.mid[1] - from[1]], L = Math.hypot(...d) || 1;
  return (v[0] * d[0] + v[1] * d[1]) / L > 0.7 ? ", towards the window" : "";
};
export function moveWords(room0, mv, ctx) {
  const z = ctx.byZone.get(mv.zone);
  const lead = byId(room0, z.lead);
  let s = `Move ${z.name} ${cm(mv.d)} ${compass(mv.v)}${towards(mv.v, lead.at, ctx.glazing)}`;
  if (z.tv && mv.ids.length > z.items.length) s += `, and ${ctx.byZone.get(z.tv).name} with them so it still faces the sofa`;
  s += ".";
  for (const x of mv.displaced) s += ` Then move ${label(byId(room0, x.item))} ${cm(x.d)} aside.`;
  return s;
}

// ------------------------------------------------------------------ the search, take two: annealing
// Beam search is myopic: the move that looks best first (a 30 cm nudge) can shut out the one that opens the room
// (the seating 1.2 m down the room). Simulated annealing over the zones' positions, with a seeded random walk so a
// run is repeatable: each step moves one zone (one near a squeeze more often), or puts one back where it was.
// The cost of a layout counts how far each piece ends up from where it stood, not the path taken.
const rng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
// a piece moved: 25p, plus per metre (more for a big one); a loose thing put away: 1.2
export const netCost = (room0, room) => (room0.furniture ?? []).reduce((s, o) => {
  const x = byId(room, o.id);
  if (o.on_floor === false) return s;
  if (!x) return s + PUT_AWAY_COST;
  const d = Math.hypot(x.at[0] - o.at[0], x.at[1] - o.at[1]);
  // a small piece carried right across the room reads as clutter moved about: it costs as much as putting it away and more
  const far = d > 2.2 && area(x) < 0.5 ? 1.5 : 0;
  return d < 0.02 && (x.rot ?? 0) === (o.rot ?? 0) ? s : s + 0.25 + d * (0.3 + 0.35 * area(x)) + far;
}, 0);
const PUT_AWAY_COST = 1.2;
// Loose things a designer may simply put away (a bag, a box, a clothes airer): never furniture.
export const canPutAway = (it) => it.category === "other" && it.on_floor !== false;

// `from`: a layout to start from (a concept: a zone already put somewhere new); costs still count from `room`.
export function anneal(room, { budgetMs = 6000, iters = 4000, seed = 7, pinned = new Set(), zones: zs, T0 = 15, T1 = 0.2, from = null } = {}) {
  const t0 = performance.now();
  const O = outline(room);
  const zones = (zs ?? zonesOf(room)).filter((z) => !z.items.some((id) => pinned.has(id)));
  const ctx = { zones, byZone: new Map(zones.map((z) => [z.id, z])), zoneOf: new Map(zones.flatMap((z) => z.items.map((id) => [id, z]))), glazing: glazingOf(room, O), pinned, lamps: new Set((room.furniture ?? []).map((x) => x.id)) };
  const rand = rng(seed);
  const m0 = measure(from ?? room, O, ctx);
  const mk = (r, m) => ({ room: r, m, cost: netCost(room, r), score: score(m, netCost(room, r)) });
  let cur = mk(from ?? room, m0);
  const start = cur;
  const keep = new Map();   // best layout per set of zones moved
  const remember = (st) => {
    const k = movedZones(room, st.room, zones).join("|");
    if (!keep.has(k) || keep.get(k).score > st.score) keep.set(k, st);
  };
  let evals = 1, geo = 0, i = 0;
  const movers = zones;
  for (; movers.length && i < iters && performance.now() - t0 < budgetMs; i++) {   // nothing left to move: the room as it is
    const T = T0 * Math.pow(T1 / T0, i / iters);
    const near = i % 25 === 0 || !cur._near ? (cur._near = nearProblems(cur.room, cur.m, zones, 1.2)) : cur._near;
    // pick a zone: near a squeeze 4×, big zones 2×, other single pieces 1×
    const w = movers.map((z) => (near.has(z.id) ? 4 : 1) * (z.kind === "piece" ? 1 : 2));
    let r = rand() * w.reduce((a, b) => a + b, 0), z = movers[0];
    for (let k = 0; k < movers.length; k++) { r -= w[k]; if (r <= 0) { z = movers[k]; break; } }
    let got;
    geo++;
    const lead = byId(cur.room, z.lead);
    if (z.kind === "piece" && lead && canPutAway(lead) && rand() < 0.08) {
      got = { room: removeId(cur.room, z.lead) };
    } else if (!lead) {
      // put away earlier: bring it back where it stood
      const o = byId(room, z.lead);
      const r_ = { ...cur.room, furniture: [...cur.room.furniture, o] };
      got = fits(cur.room, r_, [o.id], O) ? { room: r_ } : null;
    } else if (rand() < 0.12) {
      // put it back where it stood (and the TV with the seating)
      const ids = z.items;
      let r2_ = cur.room;
      for (const id of ids) { const o = byId(room, id); if (o) r2_ = setAt(r2_, id, o.at, o.rot ?? 0); }
      got = fits(cur.room, r2_, ids, O) ? { room: r2_ } : null;
    } else {
      const opts = movesFor(cur.room, z, ctx);
      const mv = opts[Math.floor(rand() * opts.length)];
      got = mv && moveZone(cur.room, z, mv.ids, mv.v, mv.d, O, ctx);
    }
    if (!got) continue;
    evals++;
    const nx = mk(got.room, measure(got.room, O, ctx));
    if (nx.score < cur.score || rand() < Math.exp(-(nx.score - cur.score) / T)) { cur = nx; remember(cur); }
  }
  const best = [...keep.values()].sort((a, b) => a.score - b.score).map((st) => simplify(room, st, O, ctx));
  best.sort((a, b) => a.score - b.score);
  return { start, best, zones, ctx, O, evals, geo, iters: i, ms: Math.round(performance.now() - t0) };
}

// The zones a layout moved (any of their pieces off where it stood).
export function movedZones(room0, room, zones) {
  return zones.filter((z) => z.items.some((id) => {
    const a = byId(room0, id), b = byId(room, id);
    return !a ? false : !b || Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) > 0.02 || (a.rot ?? 0) !== (b.rot ?? 0);
  })).map((z) => z.id).sort();
}

// Fewer steps for the same result: put each moved piece back on its own if that costs (almost) nothing.
function simplify(room0, st, O, ctx) {
  let cur = st;
  for (const x of room0.furniture ?? []) {
    const now = byId(cur.room, x.id);
    if (!now) {
      const r = { ...cur.room, furniture: [...cur.room.furniture, x] };
      if (!fits(cur.room, r, [x.id], O)) continue;
      const m = measure(r, O, ctx), c = netCost(room0, r), s = score(m, c);
      if (s <= cur.score + 0.3) cur = { room: r, m, cost: c, score: s };
      continue;
    }
    if ((Math.hypot(now.at[0] - x.at[0], now.at[1] - x.at[1]) < 0.02 && (now.rot ?? 0) === (x.rot ?? 0))) continue;
    const z = ctx.zoneOf.get(x.id);
    const ids = z && z.kind !== "piece" ? (z.tv ? [...z.items, ...ctx.byZone.get(z.tv).items] : z.items) : [x.id];
    let r = cur.room;
    for (const id of ids) { const o = byId(room0, id); if (o) r = setAt(r, id, o.at, o.rot ?? 0); }
    if (!fits(cur.room, r, ids, O)) continue;
    const m = measure(r, O, ctx), c = netCost(room0, r), s = score(m, c);
    if (s <= cur.score + 0.3) cur = { room: r, m, cost: c, score: s };
  }
  return cur;
}

// A few seeded runs, merged: annealing on one seed can miss what another finds. Each run is a fixed number of
// steps, so a room gives the same plans every time; the time budget is only a cap (about 6 s for 4 runs here).
export function annealMany(room, { seeds = [7, 11, 23, 41], budgetMs = 15000, iters = 1100, ...o } = {}) {
  const t0 = performance.now();
  const runs = [];
  for (const seed of seeds) {
    const left = budgetMs - (performance.now() - t0);
    if (left < 300 && runs.length) break;
    runs.push(anneal(room, { ...o, seed, iters, budgetMs: left / (seeds.length - runs.length) }));
  }
  const by = new Map();
  for (const r of runs) for (const st of r.best) {
    const k = movedZones(room, st.room, r.zones).join("|");
    if (!by.has(k) || by.get(k).score > st.score) by.set(k, st);
  }
  const best = [...by.values()].sort((a, b) => a.score - b.score);
  return { ...runs[0], best, evals: runs.reduce((s, r) => s + r.evals, 0), runs: runs.length, ms: Math.round(performance.now() - t0) };
}

// ------------------------------------------------------------------ concepts: a zone put somewhere new in one go
// Turn a zone about its lead piece and put the lead at `at` facing `rot` (everything in it keeps its place relative to
// the lead: the coffee table stays in front of the sofa, the chairs round the table).
export function teleport(room, ids, leadId, at, rot) {
  const lead = byId(room, leadId);
  const dr = (((rot - (lead.rot ?? 0)) % 360) + 360) % 360, a = dr * Math.PI / 180, c = Math.cos(a), sn = Math.sin(a);
  return { ...room, furniture: room.furniture.map((x) => {
    if (!ids.includes(x.id)) return x;
    const d = [x.at[0] - lead.at[0], x.at[1] - lead.at[1]];
    return { ...x, at: [r2(at[0] + c * d[0] - sn * d[1]), r2(at[1] + sn * d[0] + c * d[1])], rot: (((x.rot ?? 0) + dr) % 360 + 360) % 360 };
  }) };
}
// How far from p, along dir, to the nearest wall.
export function toWall(O, p, dir) {
  let t = 0;
  while (t < 20 && sdRoom(O, [p[0] + dir[0] * t, p[1] + dir[1] * t]) > 0) t += 0.05;
  return t;
}
export { glazingOf, candidates as wallSpots };
