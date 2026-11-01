// Voice routing (lane 6): one spoken sentence → move | swap | ask | render, with a probability.
// The app acts on `intent`; below `sure` it should ask back instead of acting.
import { decide } from "./client.mjs";

export const INTENTS = [
  { value: "move", description: "put, move, turn or shift a piece that is already in the room, or try it somewhere else" },
  { value: "swap", description: "replace a piece with another one, bring in a new piece, or remove one" },
  { value: "ask", description: "a question about the room or a piece: does it fit, how big, what would look good, why" },
  { value: "render", description: "show a picture: a photoreal view, a render, what it would look like" },
];

// context: optional { room, selected } so "move it left" can resolve; only names go in, never sizes.
export async function routeUtterance(sentence, context = {}) {
  const what = [context.selected && `Selected piece: ${context.selected}.`, context.room && `Room: ${context.room}.`].filter(Boolean).join(" ");
  const d = await decide({
    input: [{ role: "developer", content: "A person is talking to a 3D model of their room in a furniture app. Classify what they want the app to do." },
      { role: "user", content: `${what}${what ? "\n" : ""}They said: "${sentence}"` }],
    questions: [{ name: "intent", type: "choice", instructions: "What should the app do with this sentence?", choices: INTENTS }],
    cacheKey: "route",
  });
  const a = d.answers.intent;
  return { intent: a.choice, probability: a.p, probabilities: a.probabilities, sure: a.p >= 0.6, ms: d.ms };
}
