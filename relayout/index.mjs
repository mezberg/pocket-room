// Rearrange my room: the whole-room plan an interior designer would make when small fixes aren't enough.
// relayout(room, { focus }) → { plans, none?, before, decision, ms }
//   1. rearrange: move whole zones (the sofa with its coffee table and TV, the dining set, the desk) and single
//      pieces, found by annealing over layouts (search.mjs) and measured by rules/ like Check my room;
//   2. take something out: when no layout opens every way, which piece to take out and why (measured);
//   3. swap for a smaller one: when that isn't enough either, the size that would do (a Find for me hint);
//   4. none: only when even that can't help, and why, in plain words.
// Every number is measured; the Decisions API only picks which plan a designer would suggest first (pick.mjs).
import { compass, cm, r2, footprint } from "../rules/geom.mjs";
import { analyse } from "../rules/check.mjs";
import { label } from "../rules/grid.mjs";
import { byId, snap } from "../fixes/measure.mjs";
import { goalFor } from "../fixes/search.mjs";
import { annealMany, measure, movedZones, removeId, score, CLOSED } from "./search.mjs";
import { zonesOf, stays, isTv } from "./zones.mjs";
import { pickPlan } from "./pick.mjs";

const moved = (a, b) => Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) > 0.02 || (a.rot ?? 0) !== (b.rot ?? 0);
const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const nice = (id) => `the ${String(id).replace(/[_-]+/g, " ").replace(/:front$/, "")}`;
const ORDER = { seating: 0, tv: 1, dining: 2, work: 3, piece: 4 };

// The numbers a plan is judged by, from Check my room (rules/check.mjs) and the walkway grid.
function numbers(room, ctx, O) {
  const fs = analyse(room).findings.filter((f) => !f.pass);
  const m = measure(room, O, ctx);
  const sofa = (room.furniture ?? []).find((x) => x.category === "sofa"), tv = (room.furniture ?? []).find(isTv);
  return {
    problems: fs.length,
    blocked: fs.filter((f) => f.id === "path_blocked" && f.severity === "fail").length,
    tight: fs.filter((f) => f.id === "walkway_tight").length,
    overlaps: fs.filter((f) => f.id === "overlap" || f.id === "door_blocked" || f.id === "through_wall").length,
    narrowest_m: Number.isFinite(m.narrowest) ? r2(m.narrowest) : null,
    zones_in_daylight: m.lit,
    ...(sofa && tv ? { sofa_to_tv_m: r2(Math.hypot(sofa.at[0] - tv.at[0], sofa.at[1] - tv.at[1])) } : {}),
    _findings: fs,
  };
}

// Steps the app already knows how to preview and apply (contract/api.md `step`), and the sentences for them:
// one per zone, the big zones first.
function stepsFor(room0, room, ctx) {
  const steps = [], says = [], items = [];
  for (const x of room0.furniture ?? []) {
    const y = byId(room, x.id);
    if (!y) { steps.push({ item: x.id, remove: true }); items.push(x.id); continue; }
    if (moved(x, y) || JSON.stringify(x.size) !== JSON.stringify(y.size)) {
      steps.push({ item: x.id, at: y.at, rot: y.rot ?? 0, ...(JSON.stringify(x.size) !== JSON.stringify(y.size) ? { size: y.size } : {}) });
      items.push(x.id);
    }
  }
  const zs = ctx.zones.filter((z) => z.items.some((id) => items.includes(id) && byId(room, id)))
    .sort((a, b) => ORDER[a.kind] - ORDER[b.kind]);
  const told = new Set();
  for (const z of zs) {
    if (told.has(z.id)) continue;
    const a = byId(room0, z.lead), b = byId(room, z.lead);
    const v = [b.at[0] - a.at[0], b.at[1] - a.at[1]], d = Math.hypot(...v);
    const turn = (b.rot ?? 0) !== (a.rot ?? 0);
    if (d < 0.02 && !turn) {
      // the lead stayed: a piece of it stepped aside
      for (const id of z.items.filter((id) => items.includes(id))) {
        const p = byId(room0, id), q = byId(room, id), w = [q.at[0] - p.at[0], q.at[1] - p.at[1]];
        says.push(`Move ${label(p)} ${cm(Math.hypot(...w))} ${compass(w)}.`);
      }
      told.add(z.id);
      continue;
    }
    let s = `Move ${z.name} ${cm(d)} ${compass(v)}${towardsWindow(v, a.at, ctx.glazing)}`;
    if (z.tv) {
      const t0 = byId(room0, ctx.byZone.get(z.tv).lead), t1 = byId(room, t0.id);
      const tv = [t1.at[0] - t0.at[0], t1.at[1] - t0.at[1]];
      if (Math.hypot(...tv) > 0.02) s += `, and ${ctx.byZone.get(z.tv).name} ${cm(Math.hypot(...tv))} ${compass(tv)} so it still faces the sofa`;
      told.add(z.tv);
    }
    if (turn) s += `, turned to face ${compass([-footprint(b).uy[0], -footprint(b).uy[1]])}`;
    says.push(`${s}.`);
    told.add(z.id);
  }
  for (const id of items.filter((id) => !byId(room, id))) says.push(`Put ${label(byId(room0, id))} away.`);
  return { steps, items, say: says };
}
function towardsWindow(v, from, glazing) {
  if (!glazing.length) return "";
  const g = glazing.reduce((a, b) => (Math.hypot(b.mid[0] - from[0], b.mid[1] - from[1]) < Math.hypot(a.mid[0] - from[0], a.mid[1] - from[1]) ? b : a));
  const d = [g.mid[0] - from[0], g.mid[1] - from[1]], L = Math.hypot(...d) || 1, n = Math.hypot(...v) || 1;
  return (v[0] * d[0] + v[1] * d[1]) / L / n > 0.7 ? ", towards the window" : "";
}

// What changed, in one sentence of numbers.
function gains(before, after) {
  const out = [];
  if (before.blocked && after.blocked < before.blocked) out.push(after.blocked ? `${before.blocked - after.blocked} of ${before.blocked} blocked ways open` : `every blocked way opens`);
  if (before.overlaps > after.overlaps) out.push("nothing stands in anything else");
  if (before.narrowest_m != null && after.narrowest_m != null && after.narrowest_m > before.narrowest_m + 0.02) out.push(`the narrowest walkway goes from ${cm(before.narrowest_m)} to ${cm(after.narrowest_m)}`);
  if (after.problems < before.problems) out.push(`${before.problems} problems become ${after.problems}`);
  if (after.blocked) out.push(`${after.blocked === 1 ? "one way stays" : `${after.blocked} ways stay`} blocked`);
  return out.join(", ");
}

// Pieces that went somewhere and came back within 2 cm stand exactly where they stood (no step for them), so the
// plan's numbers are the room the app will have once it applies the steps.
const settle = (room0, room) => ({ ...room, furniture: room.furniture.map((x) => {
  const o = byId(room0, x.id);
  return o && !moved(o, x) && JSON.stringify(o.size) === JSON.stringify(x.size) ? o : x;
}) });

function planOf(kind, room0, st, ctx, O, before, extra = {}) {
  st = { ...st, room: settle(room0, st.room) };
  const after = numbers(st.room, ctx, O);
  const { steps, items, say } = stepsFor(room0, st.room, ctx);
  return { kind, steps, items, moves: say, after, room: st.room, score: st.score, zones_moved: movedZones(room0, st.room, ctx.zones).length, ...extra,
    gain: gains(before, after) };
}

// Does a layout clear the finding the user tapped? (the same test the fix search uses)
function clears(focus, s0, room, O) {
  const goal = focus && goalFor(focus, s0);
  return goal ? goal.test(snap(room, O)) : null;
}

export function relayoutPlans(room, { focus = null, budgetMs = 15000, pinned = [] } = {}) {
  const t0 = performance.now();
  const zones = zonesOf(room);
  const pins = new Set(pinned);
  const run = annealMany(room, { budgetMs: budgetMs * 0.6, zones, pinned: pins, seeds: [7, 11, 23] });
  const { ctx, O } = run;
  const before = numbers(room, ctx, O);
  const s0 = snap(room, O);
  const open = (st) => st.m.closed < 0.5 && st.m.hard === 0;     // no door or piece cut off (a window may still be)
  const better = (st) => st.score < run.start.score - 1;
  const good = run.best.filter(better);
  const plans = [];

  // 1. rearrange: three different ideas, not three versions of one.
  //   a. the best layout found;
  //   b. the best that keeps a's main zone (the one it moves furthest) where it stands: a second search with it pinned;
  //   c. the smallest change: only small pieces move (or are put away), or else the fewest zones.
  const BIG = new Set(["seating", "dining", "work"]);
  const opening = good.filter(open);
  const A = opening[0] ?? good[0];
  const picks = [];
  if (A) picks.push({ st: A, head: "Rearrange the room" });
  const main = A && mainZone(room, A.room, ctx);
  let B = null;
  if (main) {
    const keepIds = [...main.items, ...(main.tv ? ctx.byZone.get(main.tv).items : [])];
    const alt = annealMany(room, { budgetMs: budgetMs * 0.4, zones, pinned: new Set([...pins, ...keepIds]), seeds: [5, 13] });
    // shown even when it can't open the room: then it says what keeping it costs
    B = alt.best.filter(better)[0] ?? null;
    if (B) picks.push({ st: B, head: `Keep ${main.name} where ${main.items.length > 1 ? "they are" : "it is"}` });
    run.best.push(...alt.best);
  }
  const bigMoved = (st) => movedZones(room, st.room, zones).filter((id) => BIG.has(ctx.byZone.get(id)?.kind)).length;
  const others = run.best.filter(better).filter((st) => !picks.some((p) => p.st === st || sameIdea(room, p.st.room, st.room, zones)));
  // as open as the best plan, with the fewest big zones moved, then the fewest moves
  const pool = others.filter((st) => open(st) || !open(A));
  const small = pool.sort((a, b) => bigMoved(a) - bigMoved(b) || movedZones(room, a.room, zones).length - movedZones(room, b.room, zones).length || a.score - b.score)[0];
  if (small) picks.push({ st: small, head: bigMoved(small) ? "Smallest change" : "Smallest change: only small pieces move" });
  for (const p of picks.slice(0, 3)) plans.push(planOf("rearrange", room, p.st, ctx, O, before, { head: p.head }));

  // 2. take something out: when no layout opens every way
  if (!plans.some((p) => p.after.blocked === 0 && p.after.overlaps === 0)) {
    const bestSt = A ?? run.start;
    const cands = (bestSt.room.furniture ?? []).filter((x) => !stays(room, x) && x.on_floor !== false && x.category !== "rug"
      && !["sofa", "desk", "bed"].includes(x.category) && !isTv(x) && !(x.category === "table" && x.size[2] >= 0.65));
    const tries = cands.map((x) => {
      const r = removeId(bestSt.room, x.id);
      const m = measure(r, O, ctx);
      return { x, st: { room: r, m, cost: bestSt.cost + 2.5, score: score(m, bestSt.cost + 2.5) } };
    }).filter((t) => t.st.score < bestSt.score - 1).sort((a, b) => a.st.score - b.st.score).slice(0, 2);
    for (const t of tries) {
      const why = `Taking ${label(t.x)} out frees ${Math.round(t.x.size[0] * t.x.size[1] * 100) / 100} m² of floor`;
      plans.push(planOf("remove", room, t.st, ctx, O, before, { removes: t.x.id, why }));
    }
    // 3. swap for a smaller one: the big pieces by the squeeze that's left, 20% smaller (a sofa one seat shorter)
    if (!tries.some((t) => open(t.st))) {
      const pinch = [...bestSt.m.s.rs.values()].filter((r) => r.width < CLOSED && r.at && r.type !== "window").map((r) => r.at);
      const big = (bestSt.room.furniture ?? []).filter((x) => !stays(room, x) && x.on_floor !== false && x.size[0] * x.size[1] > 0.3
        && pinch.some((p) => Math.hypot(x.at[0] - p[0], x.at[1] - p[1]) < 1.5 + Math.max(...x.size.slice(0, 2)) / 2));
      for (const x of big.slice(0, 3)) {
        const size = smaller(x);
        // keep its back where it was: shrink towards the wall behind it
        const R = footprint(x), dd = (x.size[1] - size[1]) / 2;
        const at = [r2(x.at[0] + R.uy[0] * dd), r2(x.at[1] + R.uy[1] * dd)];
        const r = { ...bestSt.room, furniture: bestSt.room.furniture.map((y) => (y.id === x.id ? { ...y, size, at } : y)) };
        const m = measure(r, O, ctx);
        if (score(m, bestSt.cost + 3) >= bestSt.score - 1) continue;
        const st = { room: r, m, cost: bestSt.cost + 3, score: score(m, bestSt.cost + 3) };
        plans.push(planOf("swap", room, st, ctx, O, before, { swaps: x.id,
          shop: { category: x.category, name: x.category === "other" ? (x.name ?? "piece").toLowerCase() : x.category === "table" && x.size[2] < 0.6 ? "coffee table" : x.category, size },
          why: `A ${x.category === "other" ? "piece" : x.category} about ${Math.round(size[0] * 100)} × ${Math.round(size[1] * 100)} cm instead of ${Math.round(x.size[0] * 100)} × ${Math.round(x.size[1] * 100)} cm` }));
        if (open(st)) break;
      }
    }
  }

  // say each plan in a line
  for (const p of plans) {
    const head = p.head ?? p.why;
    p.say = `${sentence(head)}${p.gain ? `: ${p.gain}` : ""}.`;
    delete p.head;
    if (focus) p.clears_focus = clears(focus, s0, p.room, O);
  }
  // the one that clears the tapped problem first, then the best measured
  plans.sort((a, b) => (b.clears_focus === true) - (a.clears_focus === true) || a.score - b.score);
  plans.forEach((p, i) => { p.id = `plan${i + 1}`; });

  let none = null;
  if (!plans.length || !plans.some((p) => p.after.blocked === 0 && p.after.overlaps === 0) && before.blocked + before.overlaps > 0) {
    none = noneWhy(room, run, before);
  }
  return { plans, none, before, zones: zones.map((z) => ({ id: z.id, kind: z.kind, name: z.name, items: z.items })),
    evals: run.evals, ms: Math.round(performance.now() - t0) };
}

const smaller = (x) => {
  const w = x.category === "sofa" ? Math.max(1.5, x.size[0] - 0.5) : Math.max(0.4, r2(x.size[0] * 0.8));
  const d = x.category === "sofa" ? Math.max(0.8, x.size[1] - 0.1) : Math.max(0.3, r2(x.size[1] * 0.85));
  return [r2(w), r2(d), x.size[2]];
};

// The zone a layout moves furthest among the big ones (seating, dining, desk), weighted by how much it holds.
function mainZone(room0, room, ctx) {
  let best = null, w = 0;
  for (const z of ctx.zones.filter((z) => z.kind === "seating" || z.kind === "dining" || z.kind === "work")) {
    const a = byId(room0, z.lead), b = byId(room, z.lead);
    if (!a || !b) continue;
    const d = Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1]);
    const k = d * z.items.reduce((s, id) => { const x = byId(room0, id); return s + (x ? x.size[0] * x.size[1] : 0); }, 0);
    if (d > 0.1 && k > w) { w = k; best = z; }
  }
  return best;
}
// Two layouts are the same idea when they move the same big zones to within 40 cm of each other.
function sameIdea(room0, a, b, zones) {
  for (const z of zones.filter((z) => z.kind !== "piece")) {
    const o = byId(room0, z.lead), x = byId(a, z.lead), y = byId(b, z.lead);
    if (!o || !x || !y) continue;
    const mx = Math.hypot(x.at[0] - o.at[0], x.at[1] - o.at[1]) > 0.1, my = Math.hypot(y.at[0] - o.at[0], y.at[1] - o.at[1]) > 0.1;
    if (mx !== my || Math.hypot(x.at[0] - y.at[0], x.at[1] - y.at[1]) > 0.4) return false;
  }
  return true;
}

// Even a full re-layout can't open it: say what stands where, in plain words.
function noneWhy(room, run, before) {
  const st = run.best[0] ?? run.start;
  const r = [...st.m.s.rs.values()].filter((x) => x.width < CLOSED && x.type !== "window" && x.at).sort((a, b) => a.width - b.width)[0];
  if (!r) return before.overlaps ? "Even moving everything that can move, two pieces still stand in each other: one of them has to go or be smaller." : null;
  const fixedNear = [...(room.fixtures ?? []), ...(room.furniture ?? []).filter((x) => stays(room, x))]
    .filter((x) => Math.hypot(x.at[0] - r.at[0], x.at[1] - r.at[1]) < 1.2 + Math.max(...x.size.slice(0, 2)) / 2).map((x) => label(x));
  const why = fixedNear.length ? `${fixedNear.slice(0, 2).join(" and ")} can't move, and the room is too narrow beside ${fixedNear.length > 1 ? "them" : "it"}` : "the room is too narrow there for what has to stand in it";
  return `Even rearranging everything that can move, the way from ${nice(r.from)} to ${nice(r.to)} stays at ${cm(Math.max(0, r.width))} at best: ${why}. Only a smaller piece or one fewer will open it.`;
}

// With the Decisions pick (one choice over the measured plans), as /api/relayout returns it.
export async function relayout(room, opts = {}) {
  const res = relayoutPlans(room, opts);
  const t1 = performance.now();
  let decision = null;
  if (res.plans.length > 1 && opts.decide !== false) decision = await pickPlan(room, res.plans, opts.focus);
  else if (res.plans.length) decision = { by: "rules", choice: res.plans[0].id };
  if (decision?.choice) {
    for (const p of res.plans) {
      p.best = p.id === decision.choice || undefined;
      if (decision.probabilities?.[p.id] != null) p.probability = Math.round(decision.probabilities[p.id] * 100) / 100;
    }
    res.plans.sort((a, b) => (b.best ? 1 : 0) - (a.best ? 1 : 0));
  }
  const strip = ({ room: _r, score: s, after, ...p }) => ({ ...p, score: Math.round(s * 10) / 10, after: { ...after, _findings: undefined } });
  return { plans: res.plans.map(strip), ...(res.none ? { none: res.none } : {}), before: { ...res.before, _findings: undefined }, zones: res.zones,
    decision: decision && { by: decision.by, ms: decision.ms, error: decision.error }, evals: res.evals, search_ms: res.ms, ms: res.ms + Math.round(performance.now() - t1) };
}
