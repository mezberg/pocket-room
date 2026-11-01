// Lane E's hook into lane D's route (server/routes/place.mjs imports this file if it exists).
//   choose(room, piece, placement) → placement   Decisions picks among D's legal, measured spots
//   design(room, findings, ctx)    → finding[]   kind "design" findings (Decisions API), ctx = { piece, replaces }
// A Decisions failure never breaks the route: choose keeps D's order, design returns no findings. Both log it.
import { chooseBest } from "./best-spot.mjs";
import { gradeDesign } from "./design.mjs";

const MAX_CHOICES = 6;          // distinct spots the model chooses among
const DESIGN_TIMEOUT_MS = 20000;

// D offers a spot every 10 cm along every wall. A person chooses between places, not between 10 cm
// nudges, so keep the best-scored spot of each wall / centre (and of each "replaces the old one").
export function distinctSpots(spots, max = MAX_CHOICES) {
  const seen = new Map();
  for (const s of spots) {
    const k = `${s.wall ?? "centre"}|${s.replaces ?? ""}`;
    if (!seen.has(k)) seen.set(k, s);
  }
  return [...seen.values()].slice(0, max);
}

// D's say keeps "replacing the old one" when the chosen spot takes the old piece's place.
function withReplace(placement) {
  const best = placement.best;
  if (!best?.replaces || /replacing/.test(placement.say ?? "")) return placement;
  const say = (placement.say ?? "").replace(/^(.*?Put it (?:on the \S+ wall|at [^:]+))/, "$1, replacing the old one");
  return { ...placement, say };
}

export async function choose(room, piece, placement, { log = console.error } = {}) {
  if (!placement?.spots?.length) return placement;
  const spots = distinctSpots(placement.spots);
  let out;
  try {
    out = await chooseBest({ ...placement, spots }, { room, piece });
  } catch (e) {
    log(`[decisions] choose failed, keeping the rules' order: ${e.message}`);
    return { ...placement, spots, decision: { by: "rules", error: e.message } };
  }
  if (out.decision?.error) log(`[decisions] choose fell back to the rules' order: ${out.decision.error}`);
  if (!out.best) return { ...placement, spots };   // nothing legal by E's reading: D's answer stands
  return withReplace({ ...out, spots_total: placement.spots.length });
}

export async function design(room, findings, ctx = {}, { log = console.error, timeoutMs = DESIGN_TIMEOUT_MS } = {}) {
  let timer;
  try {
    const timeout = new Promise((_, no) => { timer = setTimeout(() => no(new Error(`no answer in ${timeoutMs / 1000} s`)), timeoutMs); });
    const { findings: out } = await Promise.race([gradeDesign(room, ctx), timeout]);
    return out ?? [];
  } catch (e) {
    log(`[decisions] design grade failed, rules-only findings: ${e.message}`);
    return [];
  } finally {
    clearTimeout(timer);
  }
}
