// The Decisions API chooses the designer's plan: one choice over the plans, and per plan which measured fact
// matters most (the one-line reason). It writes no text: every sentence and number here comes from code.
import { decide, messages } from "../decisions/client.mjs";
import { spotFacts, reasonsFor } from "../decisions/best-spot.mjs";
import { cm } from "../rules/geom.mjs";

const nice = (id) => String(id).replace(/[_-]+/g, " ").replace(/:front$/, "");

// What is true of each plan, in plain words: what it costs (moves, the old piece out) first, then the spot.
export function planReasons(plans, room, piece) {
  const facts = plans.map((p) => spotFacts(p.spot, piece, p.room ?? room));
  const rel = { n: plans.length, maxClear: Math.max(...facts.map((f) => f.clearance_m)) };
  return plans.map((p, i) => {
    const out = [];
    if (p.kind === "place") out.push("nothing else in the room moves");
    if (p.kind === "replace") out.push("the old one goes, so the room keeps one");
    if (p.kind === "move") {
      out.push(`${p.moves.length} piece${p.moves.length > 1 ? "s" : ""} move${p.moves.length > 1 ? "" : "s"} first (${p.moves.map((m) => cm(m.d)).join(", ")})`);
      const n = p.moves.flatMap((m) => m.narrowed ?? [])[0];
      if (n) { const [a, b] = n.key.split(">"); out.push(`the way from the ${nice(a)} to the ${nice(b)} goes from ${cm(n.before_m)} to ${cm(n.after_m)}`); }
    }
    if (p.spot.blocked) out.push(`a way beside it was already blocked (${cm(p.spot.blocked.after_m)})`);
    out.push(...reasonsFor(facts[i], rel));
    return { facts: facts[i], reasons: [...new Set(out)], spot: reasonsFor(facts[i], rel) };
  });
}

export async function pickPlan(plans, { room, piece }) {
  if (!plans.length) return { by: "rules", choice: null };
  const measured = planReasons(plans, room, piece);
  plans.forEach((p, i) => { p.reasons = measured[i].reasons; });
  // one plan: nothing to choose; its reason is the first measured fact about the spot
  if (plans.length === 1) return { by: "rules", choice: plans[0].id, reasons: { [plans[0].id]: measured[0].spot[0] } };
  const what = `${piece.name ?? piece.category} (${piece.category}, ${piece.size.map((v) => Math.round(v * 100) / 100).join(" × ")} m)`;
  const questions = [
    { name: "plan", type: "choice", instructions: `You are an interior designer bringing a new ${what} into this room. Which plan would you recommend? Weigh how the room will be lived in and how much has to change, not only the clearance.`,
      choices: plans.map((p, i) => ({ value: p.id, description: `${p.say} (${p.verdict}) — ${measured[i].reasons.join("; ")}` })) },
    ...plans.filter((p) => p.reasons.length > 1).map((p) => ({ name: `why_${p.id}`, type: "choice",
      instructions: `For "${p.say}", which of these facts matters most to someone deciding?`, choices: p.reasons.map((r) => ({ value: r })) })),
  ];
  const input = messages(`Room "${room.name ?? room.id}". New piece: ${what}. The plans below were each measured by code:`,
    { piece: { category: piece.category, size_m: piece.size, style: piece.style }, plans: Object.fromEntries(plans.map((p, i) => [p.id, { kind: p.kind, verdict: p.verdict, ...measured[i].facts }])) });
  try {
    const d = await decide({ input, questions, cacheKey: `plan:${room.id}` });
    const probs = d.answers.plan.probabilities;
    const reasons = Object.fromEntries(plans.map((p) => [p.id, d.answers[`why_${p.id}`]?.choice ?? p.reasons[0]]));
    return { by: d.model, choice: d.answers.plan.choice, probabilities: probs, reasons, ms: d.ms };
  } catch (e) {
    return { by: "rules", choice: plans[0].id, reasons: Object.fromEntries(plans.map((p) => [p.id, p.reasons[0]])), error: e.message };
  }
}
