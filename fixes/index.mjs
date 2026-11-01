// Tap an issue → suggested fixes. suggest(room, finding, ctx) runs the code search for that kind of finding
// (fixes/search.mjs), then the Decisions API picks the one a designer would suggest first (fixes/pick.mjs).
// Every option is measured: it clears the finding and makes nothing else worse. When nothing does, `none`
// says why in plain words.
import { withPiece } from "../decisions/design.mjs";
import { cm } from "../rules/geom.mjs";
import { label } from "../rules/grid.mjs";
import { byId } from "./measure.mjs";
import { searchMoves, searchLamp, searchCoffee, whyWords } from "./search.mjs";
import { pickBest } from "./pick.mjs";

export { REMOVABLE, canRemove } from "./search.mjs";

const MOVES = new Set(["overlap", "on_radiator", "door_blocked", "through_wall", "path_blocked", "walkway_tight", "flow"]);

// room: the room as it is; ctx: { piece (with at/rot), replaces } like /api/analyse. finding: from /api/analyse.
// opts: { budgetMs, decide: false to skip the Decisions call }
export async function suggest(room, finding, ctx = {}, opts = {}) {
  const t0 = performance.now();
  const r = withPiece(room, ctx);
  const c = { pieceId: ctx.piece?.id };
  const res = searchFor(r, finding, c, opts);
  const options = res.fixes.map((x, i) => ({
    id: `fix${i + 1}`, kind: x.kind, say: x.say, steps: x.steps, items: x.items,
    // within the grid's ~1 cm sampling error of 60 cm reads as 60, as Check my room says it
    ...(x.after_m != null ? { after_m: x.after_m >= 0.59 && x.after_m < 0.6 ? 0.6 : x.after_m } : {}), ...(x.shop ? { shop: x.shop } : {}),
  }));
  const searchMs = Math.round(performance.now() - t0);
  let decision = null;
  const usable = options.filter((o) => o.steps.length);
  if (usable.length > 1 && opts.decide !== false) {
    decision = await pickBest(r, finding, usable);
  } else if (usable.length) {
    decision = { by: "rules", choice: usable[0].id };
  }
  if (decision?.choice) {
    const best = options.find((o) => o.id === decision.choice);
    best.best = true;
    for (const o of options) if (decision.probabilities?.[o.id] != null) o.probability = Math.round(decision.probabilities[o.id] * 100) / 100;
    options.sort((a, b) => (b.best ? 1 : 0) - (a.best ? 1 : 0));
  }
  const out = { finding: finding.id, options, ms: Math.round(performance.now() - t0), search_ms: searchMs };
  if (decision) out.decision = { by: decision.by, ms: decision.ms, error: decision.error };
  if (!options.length) out.none = res.none ?? "No easy fix found.";
  return out;
}

function searchFor(room, f, c, opts) {
  if (MOVES.has(f.id)) {
    const budgetMs = opts.budgetMs ?? (f.id === "path_blocked" ? 4000 : 2500);
    const res = searchMoves(room, f, c, { budgetMs });
    if (!res.fixes.length) res.none = noMoveWhy(room, f, res);
    return res;
  }
  if (f.id === "lamps_per_zone") {
    const res = searchLamp(room, c, opts);
    if (!res.fixes.length) res.none = "No easy fix: there's no free spot near the dark area for a floor lamp that keeps the walkways clear. A wall light or a lamp on a shelf would do it.";
    return res;
  }
  if (f.id === "coffee_table") {
    const res = searchCoffee(room, c);
    if (!res.fixes.length) res.none = "The coffee table is in proportion already.";
    return res;
  }
  return { fixes: [], none: NONE[f.id] ?? "No easy fix for this one: it isn't something moving a piece can change." };
}

const NONE = {
  daylight: "No easy fix: daylight only reaches so far in from the glass. Bringing that zone into it means rearranging the room; a lamp there helps on dull days.",
  style: "No easy fix: style is a judgement, not a measurement. Try Find for me for one in your room's colours and materials.",
  tv_distance: "Choose a screen in the size range above, or try the next spot for the sofa.",
  too_tall: "No easy fix: it is taller than the ceiling. Only a lower piece will do.",
  off_floor: "It stands outside the room: drag it back in, or take it out of the plan.",
};

// Why nothing worked, from what the search saw.
function noMoveWhy(room, f, res) {
  if (res.why === "no-goal") return "No easy fix: this one needs a bigger change than moving one piece.";
  const broke = res.stats?.cleared_but_broke?.[0];
  if (broke) return `No easy fix: moving ${broke.by} far enough opens it, but ${whyWords(room, broke.bad)}.`;
  const fixed = (f.items ?? []).map((id) => byId(room, id)).filter((it) => it && (room.fixtures ?? []).some((x) => x.id === it.id));
  if (fixed.length) return `No easy fix: ${label(fixed[0])} is built in, and nothing nearby moves far enough to open it.`;
  if (res.goal?.minW) {
    const need = Math.round(res.goal.need * 100) >= 74 ? 75 : 60;
    return `No easy fix: moving the pieces nearby up to 1 m gets the way to ${cm(res.stats.best_w)} at best; it needs ${need} cm. That takes a smaller piece or a different layout.`;
  }
  return "No easy fix: nothing nearby can move far enough without running into something else.";
}
