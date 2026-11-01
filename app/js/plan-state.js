// The designer's plan in the app, and the advice order. Pure functions (no DOM, no three.js), tested in node.
import { previewMoves } from "./fix-state.js";

// A plan as an option fix-state.js can apply: the moves only (the new piece goes in through its placement).
export const planToFix = (plan) => ({ say: plan.say, steps: (plan.steps ?? []).filter((s) => !s.place) });

// What the 3D preview shows: each moved piece's ghost and arrow, the piece the plan replaces tinted red, and
// the new piece's ghost in its spot.
export function planMoves(room, plan, piece) {
  const moves = previewMoves(room, planToFix(plan));
  const spot = plan.spot;
  if (spot?.replaces) {
    const old = (room.furniture ?? []).find((f) => f.id === spot.replaces);
    if (old) moves.push({ item: old, from: old.at, to: old.at, rot: old.rot ?? 0, remove: true });
  }
  if (spot && piece) moves.push({ item: { ...piece, at: spot.at, rot: spot.rot }, piece: true, from: null, to: spot.at, rot: spot.rot ?? 0 });
  return moves;
}

// Once applied, the plan's spot is the placement the rest of the app knows (one spot, already chosen).
export function placementOf(planRes, plan) {
  const spot = { ...plan.spot, reasons: [plan.reason, ...(plan.spot.reasons ?? [])].filter(Boolean), decision: plan.probability != null ? { probability: plan.probability, reason: plan.reason } : undefined };
  return { verdict: plan.verdict, best: spot, spots: [spot], say: planRes.say && planRes.best?.id === plan.id ? planRes.say : `${plan.verdict}. ${plan.say.charAt(0).toUpperCase()}${plan.say.slice(1)}`, plan: plan.id };
}

