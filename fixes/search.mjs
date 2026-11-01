// The fix search: for one finding, code proposes changes (move, turn, take out, add a lamp, a coffee table
// in proportion), measures the room again for each, and keeps the ones that clear the finding and make
// nothing else worse. Every number comes from rules/; no model here.
import { footprint, outline, compass, cm, r2 } from "../rules/geom.mjs";
import { blocksFloor, label } from "../rules/grid.mjs";
import { WALK_OK, WALK_MIN } from "../rules/place.mjs";
import { CHECKS } from "../decisions/design.mjs";
import { snap, worse, legal, bumped, byId, routeKey, under } from "./measure.mjs";

const CLOSED = WALK_MIN - 0.01;           // as in rules/check.mjs: within the grid's error of 60 cm is open
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]];

// Stop-list: only loose things may leave the room. Never a table, desk, sofa, bed, shelf, cupboard, TV…,
// never the new piece, never a fixture.
export const REMOVABLE = new Set(["other", "plant", "lamp", "stool", "chair"]);
// Small loose things that may be nudged out of the way when a bigger move bumps into them.
const LOOSE = new Set(["other", "plant", "lamp", "stool", "chair", "table"]);
export const canRemove = (room, it, ctx = {}) =>
  !!it && REMOVABLE.has(it.category) && it.id !== ctx.pieceId && !(room.fixtures ?? []).some((f) => f.id === it.id);

const isFixed = (room, id) => (room.fixtures ?? []).some((f) => f.id === id);
const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const near = (a, b, d) => Math.hypot(a[0] - b[0], a[1] - b[1]) < d;
const area = (it) => it.size[0] * it.size[1];
// distance from a point to a piece's footprint (0 inside)
function distTo(it, p) {
  const R = footprint(it);
  const dx = p[0] - R.c[0], dy = p[1] - R.c[1];
  const qx = Math.max(0, Math.abs(dx * R.ux[0] + dy * R.ux[1]) - R.hw), qy = Math.max(0, Math.abs(dx * R.uy[0] + dy * R.uy[1]) - R.hd);
  return Math.hypot(qx, qy);
}

const moveIds = (room, ids, v, d) => ({ ...room, furniture: room.furniture.map((x) => (ids.has(x.id) ? { ...x, at: [r2(x.at[0] + v[0] * d), r2(x.at[1] + v[1] * d)] } : x)) });
const turnId = (room, id, rot) => ({ ...room, furniture: room.furniture.map((x) => (x.id === id ? { ...x, rot } : x)) });
const removeId = (room, id) => ({ ...room, furniture: room.furniture.filter((x) => x.id !== id) });
const removeSay = (it) => (it.category === "other" || it.category === "plant" ? `Put ${label(it)} away.` : `Take ${label(it)} out of the room.`);

// A dining table with the chairs tucked round it moves as one.
function groupOf(room, it) {
  const table = it.category === "table" || it.category === "desk" ? it
    : (room.furniture ?? []).find((t) => under(it, t) && distTo(t, it.at) < 0.35);
  if (!table || table.size[2] < 0.65) return [it];
  const chairs = (room.furniture ?? []).filter((c) => under(c, table) && distTo(table, c.at) < 0.35);
  return chairs.length ? [table, ...chairs] : [it];
}

// ------------------------------------------------------------------ what "fixed" means for each finding
export function goalFor(f, s0) {
  if (f.id === "overlap" || f.id === "on_radiator") {
    const k = [...(f.items ?? [])].sort().join("|");
    return { test: (s) => !s.ov.has(k) };
  }
  if (f.id === "door_blocked") return { test: (s) => ![...s.door].some((k) => k.endsWith(`|${f.items?.[0]}`)) };
  if (f.id === "through_wall") return { test: (s) => !s.out.has(f.items?.[0]) };
  if ((f.id === "path_blocked" || f.id === "walkway_tight" || f.id === "flow") && f.at) {
    // the narrow ways whose pinch is at this marker
    const keys = [...s0.rs.values()].filter((r) => r.width < WALK_OK && r.at && near(r.at, f.at, 0.6)).map(routeKey);
    if (!keys.length) return null;
    const minW = (s) => Math.min(...keys.map((k) => s.rs.get(k)?.width ?? 0));
    // a closed way (path_blocked, or a flow under 60 cm) is fixed once it opens; a tight one at 75 cm
    const need = f.id === "path_blocked" || (f.id === "flow" && minW(s0) < CLOSED) ? CLOSED : WALK_OK - 0.01;
    return { keys: new Set(keys), need, minW, before: minW(s0), test: (s) => minW(s) >= need };
  }
  return null;
}

// ------------------------------------------------------------------ moves, turns, removals
// The pieces to try: the ones the finding names, then anything movable within 70 cm of its marker (the far
// side of a gap is often unnamed). Up to four.
function movers(room, f, ctx) {
  const named = (f.items ?? []).map((id) => byId(room, id)).filter(Boolean);
  const nearby = f.at ? (room.furniture ?? []).filter((x) => blocksFloor(x) && distTo(x, f.at) < 0.7).sort((a, b) => distTo(a, f.at) - distTo(b, f.at)) : [];
  const seen = new Set(), out = [];
  for (const it of [...named, ...nearby]) {
    if (seen.has(it.id) || isFixed(room, it.id) || !blocksFloor(it)) continue;
    seen.add(it.id); out.push(it);
  }
  return out.slice(0, 4);
}

// Bumped into a small loose piece on the way? Nudge it aside too (up to two), or put a loose thing away.
function repair(room0, room2, ids, ctx, O) {
  const hit = bumped(room0, room2, ids);
  if (!hit.length || hit.length > 2) return null;
  let room = room2;
  const moved = [...ids], steps = [];
  for (const b of hit) {
    if (!LOOSE.has(b.category) || isFixed(room0, b.id) || b.id === ctx.pieceId) return null;
    let done = null;
    for (let d = 0.05; d <= 0.3 + 1e-9 && !done; d = r2(d + 0.05)) {   // a nudge aside, not a second move
      for (const v of DIRS) {
        const room3 = moveIds(room, new Set([b.id]), v, d);
        const pending = hit.filter((x) => x.id !== b.id && !moved.includes(x.id)).map((x) => x.id);
        const test = { ...room3, furniture: room3.furniture.filter((x) => !pending.includes(x.id)) };
        if (legal(room0, test, [...moved, b.id], O)) {
          done = { room: room3, step: { item: b.id, at: byId(room3, b.id).at, rot: b.rot ?? 0 }, say: `Then move ${label(b)} ${cm(d)} ${compass(v)}.`, cost: d };
          break;
        }
      }
    }
    if (!done && canRemove(room0, b, ctx) && (b.category === "other" || b.category === "plant")) {
      done = { room: removeId(room, b.id), step: { item: b.id, remove: true }, say: `Then ${removeSay(b).charAt(0).toLowerCase()}${removeSay(b).slice(1)}`, cost: 0.6, removed: true };
    }
    if (!done) return null;
    room = done.room; steps.push(done);
    if (!done.removed) moved.push(b.id);
  }
  return legal(room0, room, moved, O) ? { room, steps } : null;
}

// Searches until `budgetMs` is spent or four fixes are found. Returns the fixes (cheapest first) and what
// stopped the rest, for the "No easy fix" sentence.
export function searchMoves(room, f, ctx = {}, { budgetMs = 2500, maxD = 1.0 } = {}) {
  const t0 = performance.now();
  const O = outline(room);
  const s0 = snap(room, O);
  const goal = goalFor(f, s0);
  if (!goal) return { fixes: [], evals: 1, why: "no-goal" };
  const stats = { evals: 1, cleared_but_broke: [], best_w: goal.before ?? null };
  const found = [];
  const keyOf = (c) => `${c.kind}|${c.ids.join(",")}`;
  const seen = new Set();

  const evaluate = (c, room2, extra) => {
    stats.evals++;
    const s = snap(room2, O);
    if (goal.minW) stats.best_w = Math.max(stats.best_w ?? 0, goal.minW(s));
    if (!goal.test(s)) return false;
    const bad = worse(s0, s, goal.keys);
    if (bad.length) { stats.cleared_but_broke.push({ by: c.name, bad: bad[0] }); return false; }
    if (seen.has(keyOf(c))) return true;
    seen.add(keyOf(c));
    found.push({ ...extra, kind: c.kind, after_m: goal.minW ? r2(goal.minW(s)) : undefined });
    return true;
  };

  // candidate moves: each piece alone, and its dining group as one; directions away from the marker first
  const cands = [];
  for (const it of movers(room, f, ctx)) {
    const group = groupOf(room, it);
    // a dining table moves with its chairs, never on its own
    const sets = group.length > 1 && group[0] === it ? [group] : [[it], group].filter((g, i) => i === 0 || g.length > 1);
    for (const g of sets) {
      const ids = g.map((x) => x.id);
      if (cands.some((c) => c.ids.join() === ids.join())) continue;
      const name = g.length > 1 ? `${label(g[0])} and its chairs` : label(it);
      const weight = 1 + g.reduce((s, x) => s + area(x), 0) / 2;   // a sofa is harder to shift than a stool
      const away = f.at ? [it.at[0] - f.at[0], it.at[1] - f.at[1]] : [0, 0];
      const dirs = f.id === "overlap" || f.id === "through_wall" || !f.at ? DIRS
        : DIRS.slice().sort((a, b) => (b[0] * away[0] + b[1] * away[1]) - (a[0] * away[0] + a[1] * away[1])).slice(0, 3);
      for (const v of dirs) cands.push({ kind: "move", ids, it, v, name, weight });
      if (g.length === 1 && it.category !== "table" && it.category !== "desk") {
        for (const dr of [90, 270, 180]) cands.push({ kind: "turn", ids, it, dr, name, weight, once: true });
      }
      if (g.length === 1 && canRemove(room, it, ctx)) cands.push({ kind: "remove", ids, it, name, weight, once: true });
    }
  }

  // turns and removals first: a handful, and often the simplest answer (put the coat stand away)
  for (const c of cands.filter((c) => c.once)) {
    if (c.kind === "turn") {
      const rot = (((c.it.rot ?? 0) + c.dr) % 360 + 360) % 360;
      const room2 = turnId(room, c.it.id, rot);
      if (!legal(room, room2, c.ids, O)) continue;
      const how = c.dr === 180 ? "round" : `a quarter turn ${c.dr === 90 ? "anticlockwise" : "clockwise"}`;
      evaluate(c, room2, { say: `Turn ${c.name} ${how}.`, steps: [{ item: c.it.id, at: c.it.at, rot }], cost: 0.3 * c.weight, items: c.ids });
    } else {
      evaluate(c, removeId(room, c.it.id), { say: removeSay(c.it), steps: [{ item: c.it.id, remove: true }], cost: 0.9, items: c.ids });
    }
  }
  // moves in 5 cm steps, cheapest first across all pieces and directions
  const queue = cands.filter((c) => c.kind === "move").map((c) => ({ c, d: 0.05 }));
  const out = () => performance.now() - t0 > budgetMs;
  while (queue.length && found.length < 4 && !out()) {
    queue.sort((a, b) => a.d * a.c.weight - b.d * b.c.weight);
    const { c, d } = queue.shift();
    if (d + 0.05 <= maxD + 1e-9) queue.push({ c, d: r2(d + 0.05) });
    const room2 = moveIds(room, new Set(c.ids), c.v, d);
    const steps = c.ids.map((id) => ({ item: id, at: byId(room2, id).at, rot: byId(room2, id).rot ?? 0 }));
    let say = `Move ${c.name} ${cm(d)} ${compass(c.v)}.`, cost = d * c.weight, room3 = room2;
    if (!legal(room, room2, c.ids, O)) {
      const rep = repair(room, room2, c.ids, ctx, O);
      if (!rep) continue;
      room3 = rep.room;
      for (const r of rep.steps) { steps.push(r.step); say += ` ${r.say}`; cost += 0.3 + r.cost; }
    }
    if (evaluate(c, room3, { say, steps, cost, items: c.ids })) {
      // found the smallest move for this piece and direction: drop its longer ones
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].c === c) queue.splice(i, 1);
    }
  }
  found.sort((a, b) => a.cost - b.cost);
  return { fixes: found.slice(0, 3), evals: stats.evals, stats, goal, ms: Math.round(performance.now() - t0) };
}

// ------------------------------------------------------------------ lamps
const LAMP = { id: "new_floor_lamp", name: "Floor lamp", category: "lamp", size: [0.3, 0.3, 1.55], rot: 0, on_floor: true };
const lampCheck = CHECKS.find((c) => c.id === "lamps_per_zone");

// A floor lamp beside each unlit zone / the darkest corner: the nearest spot that stands legally, narrows
// no walkway and leaves fewer unlit zones and dark corners.
export function searchLamp(room, ctx = {}, { budgetMs = 2500 } = {}) {
  const t0 = performance.now();
  const O = outline(room);
  const f0 = lampCheck.measure(room, ctx);
  const dark = (f) => f.zones.filter((z) => !z.lights_within_2m.length).length + f.dark_corners.length;
  const before = dark(f0);
  if (!before) return { fixes: [] };
  const s0 = snap(room, O);
  const targets = [
    ...f0.zones.filter((z) => !z.lights_within_2m.length).map((z) => ({ at: z.at, what: `the ${z.zone}` })),
    ...f0.corners.filter((c) => f0.dark_corners.includes(c.corner)).sort((a, b) => b.nearest_light_m - a.nearest_light_m).map((c) => ({ at: c.at, what: `the ${c.corner} corner` })),
  ];
  const fixes = [];
  const done = new Set();
  for (const t of targets) {
    if (done.has(t.what)) continue;   // a corner name can cover several wall corners: try the darkest once
    done.add(t.what);
    if (performance.now() - t0 > budgetMs) break;
    let got = null;
    // every 10 cm within 2.5 m of the dark spot, nearest first; cheap tests before the walkway grid
    const pts = [];
    for (let dx = -2.5; dx <= 2.5 + 1e-9; dx += 0.1) for (let dy = -2.5; dy <= 2.5 + 1e-9; dy += 0.1) {
      const d = Math.hypot(dx, dy);
      if (d <= 2.5) pts.push({ at: [r2(t.at[0] + dx), r2(t.at[1] + dy)], d });
    }
    pts.sort((a, b) => a.d - b.d);
    for (const { at, d } of pts) {
      if (performance.now() - t0 > budgetMs) break;
      const lamp = { ...LAMP, at };
      const light = { id: LAMP.id, kind: "floor_lamp", at, h: 1.4 };
      const room2 = { ...room, furniture: [...room.furniture, lamp], lights: [...(room.lights ?? []), light] };
      if (!legal(room, room2, [LAMP.id], O)) continue;
      const left = dark(lampCheck.measure(room2, ctx));
      if (left >= before) continue;
      if (worse(s0, snap(room2, O)).length) continue;
      got = { kind: "add", say: `Add a floor lamp by ${t.what}${left === 0 ? ": then every zone and corner has a light" : ""}.`,
        steps: [{ add: lamp, light }], cost: 0.5 + d + left, items: [LAMP.id], left };
      break;
    }
    if (got && !fixes.some((x) => near(x.steps[0].add.at, got.steps[0].add.at, 0.5))) fixes.push(got);
    if (fixes.length >= 2) break;
  }
  fixes.sort((a, b) => a.left - b.left || a.cost - b.cost);
  return { fixes, ms: Math.round(performance.now() - t0) };
}

// ------------------------------------------------------------------ coffee table in proportion
const coffeeCheck = CHECKS.find((c) => c.id === "coffee_table");

// Half to two-thirds of the sofa (designers' rule, decisions/design.mjs). Try that size where the table stands;
// if it can't stand there, say what it should be as a shopping hint, and why it doesn't fit yet.
export function searchCoffee(room, ctx = {}) {
  const t0 = performance.now();
  const C = coffeeCheck.measure(room, ctx);
  if (!C) return { fixes: [] };
  if (C.ratio >= 0.5 && C.ratio <= 0.7) return { fixes: [] };
  const O = outline(room);
  const s0 = snap(room, O);
  const table = byId(room, C.table);
  let why = null;
  const sizes = [0.6, 0.55, 0.5, 0.66].map((k) => {
    const len = Math.round(C.sofa_length_m * k * 10) / 10;
    return { k, size: [len, Math.max(0.5, Math.round(len * 0.5 * 10) / 10), table.size[2]] };
  });
  for (const { k, size } of sizes) {
    const room2 = { ...room, furniture: room.furniture.map((x) => (x.id === table.id ? { ...x, size } : x)) };
    if (!legal(room, room2, [table.id], O)) {
      const hit = bumped(room, room2, [table.id])[0];
      why ??= hit ? `it would run into ${label(hit)}` : "it would go through a wall";
      continue;
    }
    const bad = worse(s0, snap(room2, O));
    if (bad.length) { why ??= whyWords(room, bad[0]); continue; }
    return { fixes: [{ kind: "resize", say: `Swap the coffee table for one about ${Math.round(size[0] * 100)} × ${Math.round(size[1] * 100)} cm (${Math.round(k * 100)}% of the sofa): it fits where this one stands.`,
      steps: [{ item: table.id, size }], cost: 1.5, items: [table.id], shop: { category: "table", name: "coffee table", size } }], ms: Math.round(performance.now() - t0) };
  }
  const size = sizes[0].size;
  return { fixes: [{ kind: "shop", say: `A coffee table about ${Math.round(size[0] * 100)} × ${Math.round(size[1] * 100)} cm would suit the sofa, but not where this one stands yet: ${why}.`,
    steps: [], cost: 3, items: [table.id], shop: { category: "table", name: "coffee table", size } }], ms: Math.round(performance.now() - t0) };
}

// ------------------------------------------------------------------ plain words for what went wrong
const nice = (id) => `the ${String(id).replace(/[_-]+/g, " ").replace(/:front$/, "")}`;
export function whyWords(room, bad) {
  if (!bad) return "";
  const name = (id) => { const it = byId(room, id); return it ? label(it) : nice(id); };
  if (bad.kind === "overlap") { const [a, b] = bad.key.split("|"); return `${name(a)} would run into ${name(b)}`; }
  if (bad.kind === "door") { const [d, it] = bad.key.split("|"); return `${name(it)} would block ${nice(d)}`; }
  if (bad.kind === "wall") return `${name(bad.key)} would go into the wall`;
  const [from, to] = bad.key.split(">");
  return `the way from ${nice(from)} to ${nice(to)} would drop to ${cm(bad.after)}`;
}
export { sentence };
