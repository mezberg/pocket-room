// "What's wrong with my room": the Decisions API ranks the problems Check my room found, most important first.
// One choice question over the findings' own sentences (written by code); the probabilities give the order.
import { decide, messages } from "../decisions/client.mjs";

export async function advise(room, findings) {
  const bad = findings.map((f, i) => ({ f, i })).filter(({ f }) => !f.pass);
  if (!bad.length) return { ranked: [], by: "rules" };
  if (bad.length === 1) return { ranked: [{ index: bad[0].i, id: bad[0].f.id, p: 1 }], by: "rules" };
  const key = (k) => `f${k}`;
  const questions = [{ name: "first", type: "choice",
    instructions: "You are an interior designer walking through this room with its owner. Which of these problems should they fix first? Getting in and around safely comes first (doors, ways through, things in each other), then comfort and light, then looks.",
    choices: bad.map(({ f }, k) => ({ value: key(k), description: f.say })) }];
  const input = messages(`Room "${room.name ?? room.id}". The problems our checker measured (every number is from code):`,
    { problems: bad.map(({ f }, k) => ({ id: key(k), kind: f.kind, check: f.id, severity: f.severity })) });
  try {
    const d = await decide({ input, questions, cacheKey: `advice:${room.id}` });
    const probs = d.answers.first.probabilities;
    const ranked = bad.map(({ f, i }, k) => ({ index: i, id: f.id, p: Math.round((probs[key(k)] ?? 0) * 1000) / 1000 })).sort((a, b) => b.p - a.p);
    return { ranked, by: d.model, ms: d.ms };
  } catch (e) {
    // the measured severity order stands: fail before warn, rules before design
    const sev = { fail: 0, warn: 1, info: 2 };
    const ranked = bad.sort((a, b) => sev[a.f.severity] - sev[b.f.severity] || (a.f.kind === "design") - (b.f.kind === "design")).map(({ f, i }) => ({ index: i, id: f.id, p: null }));
    return { ranked, by: "rules", error: e.message };
  }
}
