// The Decisions API picks which measured plan a designer would suggest first. It writes no text: each plan is
// sentences and numbers code wrote, and it chooses among them with a probability.
import { decide, messages } from "../decisions/client.mjs";
import { cm } from "../rules/geom.mjs";

const facts = (p) => [p.say, ...p.moves, `After: ${p.after.problems} problems, ${p.after.blocked} blocked ways, narrowest walkway ${p.after.narrowest_m != null ? cm(p.after.narrowest_m) : "wide"}` +
  `${p.after.sofa_to_tv_m != null ? `, sofa ${p.after.sofa_to_tv_m} m from the TV` : ""}, ${p.zones_moved} zone${p.zones_moved === 1 ? "" : "s"} moved.`].join(" ");

export async function pickPlan(room, plans, focus) {
  const input = messages(
    `Plans to rearrange "${room.name ?? room.id}". ${focus ? `The problem the owner tapped: ${focus.say}\n` : ""}` +
    "Each plan below was measured by code (walkways on a 4 cm grid, overlaps, door swings). The furniture in the room:",
    { furniture: (room.furniture ?? []).map((x) => x.name ?? x.id) });
  try {
    const d = await decide({ input, cacheKey: `relayout:${room.id}`, questions: [{ name: "plan", type: "choice",
      instructions: "Which plan would a careful interior designer suggest first? Prefer a room that works (every way open, no squeezing) with the fewest and lightest moves; keep the sofa facing the TV and each zone together; only take something out or buy a smaller piece when rearranging can't do it.",
      choices: plans.map((p) => ({ value: p.id, description: facts(p) })) }] });
    const a = d.answers.plan;
    if (!a?.choice) throw new Error("no choice in the answer");
    return { by: d.model, choice: a.choice, probabilities: a.probabilities, ms: d.ms };
  } catch (e) {
    return { by: "rules", choice: plans[0].id, error: e.message };
  }
}
