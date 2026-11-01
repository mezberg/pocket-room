// The Decisions API (POST /v1/decisions, model from OPENAI_MODEL_DECISIONS) behind one call.
// Request and answer shapes: decisions/README.md. Code passes measured numbers in; the model only judges.
//
// decide({ input, questions }) → { answers: { [name]: answer }, ms, model, usage }
//   predicate → { type, p }                                   p = probability the statement is true
//   choice    → { type, choice, p, probabilities: {value: p} } p = probability of the chosen value
//   score     → { type, level, score, p, probabilities: {label: p} }  score = expected level 0..n-1, p = score/(n-1)
//   refusal   → { type: "refusal", p: null }

let transport = null;   // tests swap the network out with setTransport(fn(body) → raw Decision)
export const setTransport = (fn) => { transport = fn; };

async function send(body) {
  if (transport) return transport(body);
  const { openai } = await import("../server/openai.mjs");   // lazy: tests run without a key
  return openai.decisions.create(body);
}

const model = () => process.env.OPENAI_MODEL_DECISIONS;

// One request for any number of questions (1–400). Every question needs a unique `name`.
export async function decide({ input, questions, cacheKey }) {
  const names = questions.map((q) => q.name);
  if (names.some((n) => !n) || new Set(names).size !== names.length) throw new Error("decide: every question needs a unique name");
  const body = { model: model(), input, questions };
  if (cacheKey) body.prompt_cache_key = cacheKey;
  if (!body.model && !transport) throw new Error("OPENAI_MODEL_DECISIONS is not set in .env");
  const t = Date.now();
  const raw = await send(body);
  const ms = Date.now() - t;
  const answers = {};
  raw.answers.forEach((a, i) => { answers[a.name ?? names[i]] = normalise(a, questions[i]); });
  return { answers, ms, model: raw.model, usage: raw.usage };
}

export function normalise(a, q) {
  if (a.type === "predicate") return { type: a.type, p: a.probability };
  if (a.type === "choice") {
    const probabilities = Object.fromEntries(a.probabilities.map((x) => [String(x.value), x.probability]));
    return { type: a.type, choice: a.choice, p: probabilities[String(a.choice)] ?? null, probabilities, confidence: a.confidence };
  }
  if (a.type === "score") {
    const n = q?.levels?.length ?? a.probabilities.length;
    const probabilities = Object.fromEntries(a.probabilities.map((x) => [x.label, x.probability]));
    const top = a.probabilities.reduce((m, x) => (x.probability > m.probability ? x : m));
    return { type: a.type, level: top.label, score: a.score, p: n > 1 ? a.score / (n - 1) : null, probabilities, confidence: a.confidence };
  }
  return { type: "refusal", p: null };
}

// Input helpers: a developer message that pins the rules, then a user message with text and JSON parts.
export const RULES = "You judge rooms for a furniture app. Every size, distance and clearance below was measured by code " +
  "and is correct; use only those numbers and never assume other sizes. Judge comfort, light, flow and style the way a careful interior designer would.";
export function messages(text, data, extra = []) {
  const content = [{ type: "input_text", text }];
  if (data) content.push({ type: "input_json", data });
  return [{ role: "developer", content: RULES }, { role: "user", content: [...content, ...extra] }];
}
