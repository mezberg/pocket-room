// The Decisions API picks which measured fix a designer would suggest first. It writes no text: the options
// are sentences code wrote from measured numbers, and it chooses among them with a probability.
import { decide, messages } from "../decisions/client.mjs";
import { cm } from "../rules/geom.mjs";

export async function pickBest(room, finding, options) {
  const choices = options.map((o) => ({ value: o.id, description: o.say + (o.after_m != null ? ` (the way becomes ${cm(o.after_m)})` : "") }));
  const input = messages(
    `A problem the checker found in "${room.name ?? room.id}": ${finding.say}\n` +
    "Every option below was measured by code: each one clears this problem and makes nothing else in the room worse. The furniture in the room:",
    { furniture: (room.furniture ?? []).map((x) => x.name ?? x.id) });
  try {
    const d = await decide({ input, cacheKey: `fix:${room.id}`, questions: [{ name: "fix", type: "choice",
      instructions: "Which fix would a careful interior designer suggest first? Prefer the least disruption: small moves of light pieces over moving big ones or taking things out, and keep each zone of the room working and looking right.",
      choices }] });
    const a = d.answers.fix;
    if (!a?.choice) throw new Error("no choice in the answer");
    return { by: d.model, choice: a.choice, probabilities: a.probabilities, ms: d.ms };
  } catch (e) {
    // the measured order stands: cheapest change first
    return { by: "rules", choice: options[0].id, error: e.message };
  }
}
