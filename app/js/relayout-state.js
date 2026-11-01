// Rearrange my room in the app: what to send, and how a plan reads on its card. Pure (no DOM), tested in node.
// A plan's steps are fix steps (fix-state.js applyFix and previewMoves take them as they are).
import { analyseBody } from "./scene-state.js";

// POST /api/relayout body: the room as /api/analyse got it, and the problem tapped (if any) to clear first.
export function relayoutBody(room, piece, spot, finding, opts) {
  const body = analyseBody(room, piece, spot, opts);
  if (finding) { const { id, kind, at, items, say, width_m } = finding; body.finding = { id, kind, at, items, say, width_m }; }
  return body;
}

const cmw = (m) => (m == null ? "wide" : `${Math.round(m * 100)} cm`);
// The card: a tag, the headline, the steps, and the measured before → after.
export function planCard(plan, before, decision) {
  const tag = plan.best ? (decision?.by && decision.by !== "rules" && plan.probability != null ? `Designer's pick · ${Math.round(plan.probability * 100)}% sure` : "Best measured")
    : plan.kind === "remove" ? "Take one out" : plan.kind === "swap" ? "Smaller piece" : "";
  const a = plan.after;
  const nums = [
    `Problems ${before.problems} → ${a.problems}`,
    `Blocked ways ${before.blocked} → ${a.blocked}`,
    `Narrowest walkway ${cmw(before.narrowest_m)} → ${cmw(a.narrowest_m)}`,
  ];
  return { tag, say: plan.say, steps: plan.moves ?? [], numbers: nums.join(" · ") };
}
// What the apply toast says.
export const appliedWords = (plan) => (plan.moves?.[0] ? `${plan.moves.length > 1 ? `${plan.moves.length} moves: ` : ""}${plan.moves[0].replace(/\.$/, "")}${plan.moves.length > 1 ? "…" : ""}` : plan.say);
