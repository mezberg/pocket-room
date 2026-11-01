// Best spot: lane D's rules find the legal spots and measure them; Decisions picks the one a person would
// choose, with a probability, and which measured fact decided it. One request for the whole choice.
import { decide, messages } from "./client.mjs";
import { r2, dist, front, footprint, frontCentre, polyDist, openings, isGlazed, isDoor, openingDist, byCategory, lightsOf } from "./geom.mjs";

const cm = (m) => `${Math.round(m * 100)} cm`;
const m1 = (m) => `${r2(m).toFixed(1)} m`;

// What code measures about one spot for one piece. Every number here is computed, never asked for.
export function spotFacts(spot, piece, room) {
  const placed = { at: spot.at, rot: spot.rot, size: piece.size };
  const fp = footprint(placed), fc = frontCentre(placed), f = front(spot.rot);
  const ops = openings(room);
  const facts = { wall: spot.wall ?? null, verdict: spot.verdict, clearance_m: r2(spot.clearance_m), rules_score: spot.score };

  const tv = byCategory(room, "tv").find((t) => t.id !== piece.id);
  if (tv && piece.category !== "tv") {
    const to = [tv.at[0] - fc[0], tv.at[1] - fc[1]];
    const off = Math.abs((Math.atan2(to[1], to[0]) - Math.atan2(f[1], f[0])) * 180 / Math.PI);
    facts.tv = { distance_m: r2(dist(fc, frontCentre(tv))), off_axis_deg: Math.round(Math.min(off, 360 - off)) };
  }
  const glazing = ops.filter(isGlazed);
  if (glazing.length) {
    const near = glazing.map((o) => ({ o, d: Math.min(...[o.ends[0], o.centre, o.ends[1]].map((p) => polyDist(p, fp))) })).sort((a, b) => a.d - b.d)[0];
    facts.window = { id: near.o.id, distance_m: r2(near.d), blocks: near.d < 0.3 && (near.o.sill ?? 0) < piece.size[2] };
  }
  const doors = ops.filter(isDoor);
  if (doors.length) facts.nearest_door_m = r2(Math.min(...doors.map((o) => Math.min(...fp.map((p) => openingDist(p, o))))));
  const radiators = (room.fixtures ?? []).filter((x) => x.category === "radiator");
  if (radiators.length) facts.radiator_m = r2(Math.min(...radiators.map((x) => Math.min(...footprint(x).map((p) => polyDist(p, fp))))));
  const lights = lightsOf(room);
  if (lights.length) facts.nearest_light_m = r2(Math.min(...lights.map((l) => dist(l.at, fc))));
  return facts;
}

// Plain reasons that are true of one spot, for the model to rank. `rel` compares with the other spots.
export function reasonsFor(facts, rel) {
  const out = [];
  if (facts.tv) out.push(facts.tv.off_axis_deg <= 30 ? `faces the TV from ${m1(facts.tv.distance_m)}` : `turned ${facts.tv.off_axis_deg}° away from the TV`);
  if (facts.clearance_m >= rel.maxClear - 1e-6 && rel.n > 1) out.push(`the most room to walk past (${cm(facts.clearance_m)})`);
  else if (facts.clearance_m < 0.75) out.push(`a tight walkway (${cm(facts.clearance_m)})`);
  if (facts.window?.blocks) out.push("stands across the glazing");
  else if (facts.window && facts.window.distance_m < 1.2) out.push(`daylight from the window ${cm(facts.window.distance_m)} away`);
  if (facts.radiator_m != null && facts.radiator_m < 0.3) out.push(facts.radiator_m < 0.02 ? "covers the radiator" : `${cm(facts.radiator_m)} from the radiator`);
  if (facts.nearest_door_m != null && facts.nearest_door_m < 0.6) out.push(`close to the door (${cm(facts.nearest_door_m)})`);
  if (facts.nearest_light_m != null && facts.nearest_light_m < 1.5) out.push(`a lamp within ${m1(facts.nearest_light_m)}`);
  if (!out.length) out.push(`${cm(facts.clearance_m)} clearance`);
  return out;
}

const keyOf = (s, i, all) => (s.wall && all.filter((x) => x.wall === s.wall).length === 1 ? s.wall : `spot_${i + 1}`);
const where = (s) => (s.wall ? `on the ${s.wall} wall` : `at ${s.at.map((v) => r2(v)).join(", ")}`);

// placement (contract/api.md) in, placement out: spots re-ordered by the decision, `best` set, `say` rewritten,
// each spot annotated with `decision: { probability, reason }`. Spots that don't fit are kept at the end, unjudged.
export async function chooseBest(placement, { room, piece }) {
  const legal = placement.spots.filter((s) => s.verdict !== "Doesn't fit");
  const rest = placement.spots.filter((s) => s.verdict === "Doesn't fit");
  if (legal.length === 0) return { ...placement, best: null, decision: { by: "rules", reason: "no legal spot" } };

  const facts = legal.map((s) => spotFacts(s, piece, room));
  const rel = { n: legal.length, maxClear: Math.max(...facts.map((f) => f.clearance_m)) };
  const reasons = facts.map((f) => reasonsFor(f, rel));
  const keys = legal.map((s, i) => keyOf(s, i, legal));

  if (legal.length === 1) {
    const best = { ...legal[0], reasons: [reasons[0][0], ...(legal[0].reasons ?? [])] };
    return { ...placement, best, spots: [best, ...rest], say: `${best.verdict}. Put it ${where(best)}: ${reasons[0][0]}.`, decision: { by: "rules", reason: "only one legal spot" } };
  }

  const what = `${piece.name ?? piece.category} (${piece.category}, ${piece.size.map((v) => r2(v)).join(" × ")} m)`;
  const questions = [
    { name: "best", type: "choice", instructions: `Which spot would most people choose for this ${what} in everyday life? Weigh how the room will be used, not only the clearance.`,
      choices: keys.map((k, i) => ({ value: k, description: reasons[i].join("; ") })) },
    ...keys.filter((_, i) => reasons[i].length > 1).map((k) => {
      const i = keys.indexOf(k);
      return { name: `why_${k}`, type: "choice", instructions: `For the spot "${k}", which of these facts matters most to someone deciding where the ${piece.category} goes?`,
        choices: reasons[i].map((r) => ({ value: r })) };
    }),
  ];
  const input = messages(`Room "${room.name ?? room.id}". New piece: ${what}. Legal spots, measured by code:`,
    { piece: { category: piece.category, size_m: piece.size, style: piece.style }, spots: Object.fromEntries(keys.map((k, i) => [k, facts[i]])) });

  let d;
  try { d = await decide({ input, questions, cacheKey: `best-spot:${room.id}` }); }
  catch (e) { return fallback(placement, legal, rest, reasons, e); }

  const prob = d.answers.best.probabilities;
  const why = (i) => d.answers[`why_${keys[i]}`]?.choice ?? reasons[i][0];
  const judged = legal.map((s, i) => ({ ...s, reasons: [why(i), ...(s.reasons ?? []).filter((r) => r !== "stub")], decision: { probability: r2(prob[keys[i]] ?? 0), reason: why(i) } }))
    .sort((a, b) => b.decision.probability - a.decision.probability);
  const best = judged[0];
  return {
    ...placement,
    verdict: best.verdict,
    best,
    spots: [...judged, ...rest],
    say: `${best.verdict}. Put it ${where(best)}: ${best.decision.reason}.`,
    decision: { by: d.model, probability: best.decision.probability, ms: d.ms },
  };
}

// The Decisions call failed: keep the rules' own order and say why, so the app still works.
function fallback(placement, legal, rest, reasons, err) {
  const order = legal.map((s, i) => ({ s, i })).sort((a, b) => b.s.score - a.s.score);
  const spots = order.map(({ s, i }) => ({ ...s, reasons: [reasons[i][0], ...(s.reasons ?? [])] }));
  const best = spots[0];
  return { ...placement, verdict: best.verdict, best, spots: [...spots, ...rest], say: `${best.verdict}. Put it ${where(best)}: ${best.reasons[0]}.`,
    decision: { by: "rules", error: err.message } };
}
