// The interior designer: plan(room, piece) → measured plans (place / move then place / replace) with the
// Decisions pick first; advise(room, findings) → the problems ranked, most important first.
import { planPiece } from "./plan.mjs";
import { pickPlan } from "./pick.mjs";
export { advise } from "./advice.mjs";

export async function plan(room, piece, opts = {}) {
  const t0 = performance.now();
  const res = planPiece(room, piece, opts);
  const d = opts.decide === false ? { by: "rules", choice: res.plans[0]?.id, reasons: {} } : await pickPlan(res.plans, { room, piece });
  const plans = res.plans.map(({ room: _r, ...p }) => ({
    ...p,
    reason: d.reasons?.[p.id] ?? p.reasons?.[0],
    ...(d.probabilities?.[p.id] != null ? { probability: Math.round(d.probabilities[p.id] * 100) / 100 } : {}),
    ...(p.id === d.choice ? { best: true } : {}),
  })).sort((a, b) => (b.best ? 1 : 0) - (a.best ? 1 : 0) || (b.probability ?? 0) - (a.probability ?? 0));
  const best = plans[0] ?? null;
  return {
    verdict: best?.verdict ?? "Doesn't fit",
    best, plans,
    say: best ? `${best.verdict}. ${best.say.charAt(0).toUpperCase()}${best.say.slice(1)}${best.reason ? ` Why: ${best.reason}.` : ""}` : `Doesn't fit. ${res.why}`,
    decision: { by: d.by, ms: d.ms, error: d.error },
    ms: Math.round(performance.now() - t0), search_ms: res.ms,
  };
}
