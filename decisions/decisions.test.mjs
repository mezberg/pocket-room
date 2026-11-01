// Lane E tests. The network is mocked with setTransport; decisions/smoke.mjs does one live run.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setTransport, decide, normalise } from "./client.mjs";
import { chooseBest, spotFacts } from "./best-spot.mjs";
import { gradeDesign, measureAll, widestRoute } from "./design.mjs";
import { routeUtterance } from "./route.mjs";

const j = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const room = j("../contract/fixtures/hoskins-living-room.room.json");
const piece = j("../contract/fixtures/sofa-84.piece.json");
const placement = j("./fixtures/placement-sofa-84.json");

// A fake Decisions API: answers every question in the real response shape. `pick` chooses per question name.
let sent;
function fake(pick = {}) {
  return (body) => {
    sent = body;
    return {
      model: body.model ?? "gpt-6-luna",
      usage: { total_tokens: 100 },
      answers: body.questions.map((q) => {
        if (q.type === "predicate") return { type: "predicate", name: q.name, probability: pick[q.name] ?? 0.7 };
        if (q.type === "choice") {
          const want = pick[q.name] ?? q.choices[0].value;
          return { type: "choice", name: q.name, choice: want, confidence: 0.8,
            probabilities: q.choices.map((c) => ({ value: c.value, probability: c.value === want ? 0.9 : 0.1 / (q.choices.length - 1) })) };
        }
        const n = q.levels.length, top = pick[q.name] ?? n - 1;
        return { type: "score", name: q.name, score: top, confidence: 0.5, probabilities: q.levels.map((l, i) => ({ label: l.label, value: i, probability: i === top ? 1 : 0 })) };
      }),
    };
  };
}
beforeEach(() => { process.env.OPENAI_MODEL_DECISIONS = "gpt-6-luna"; sent = null; setTransport(fake()); });

test("normalise reads all three answer types and refusals", () => {
  assert.deepEqual(normalise({ type: "predicate", name: "a", probability: 0.3 }), { type: "predicate", p: 0.3 });
  const c = normalise({ type: "choice", choice: "west", confidence: 0.3, probabilities: [{ value: "east", probability: 0.33 }, { value: "west", probability: 0.67 }] });
  assert.equal(c.p, 0.67); assert.equal(c.probabilities.east, 0.33);
  const s = normalise({ type: "score", score: 0.54, confidence: 0.2, probabilities: [{ label: "dark", value: 0, probability: 0.49 }, { label: "ok", value: 1, probability: 0.48 }, { label: "bright", value: 2, probability: 0.03 }] },
    { levels: [{}, {}, {}] });
  assert.equal(s.level, "dark"); assert.equal(s.p, 0.27);
  assert.equal(normalise({ type: "refusal", name: "x" }).p, null);
});

test("decide sends the documented request and needs unique names", async () => {
  const d = await decide({ input: "x", questions: [{ name: "q", type: "predicate", instructions: "true" }] });
  assert.deepEqual(Object.keys(sent).sort(), ["input", "model", "questions"]);
  assert.equal(d.answers.q.p, 0.7);
  await assert.rejects(decide({ input: "x", questions: [{ type: "predicate", instructions: "a" }] }), /unique name/);
});

test("spot facts are measured, not asked for", () => {
  const [east, west, southWest] = placement.spots.map((s) => spotFacts(s, piece, room));
  assert.ok(west.tv.off_axis_deg <= 30, "west spot faces the TV");
  assert.ok(east.tv.off_axis_deg > 150, "east spot has its back to the TV");
  assert.ok(southWest.radiator_m < 0.05, "south-west spot covers the radiator");
});

test("best spot: one choice across legal spots, a reason per spot, Doesn't fit left out", async () => {
  setTransport(fake({ best: "spot_2" }));
  const out = await chooseBest(placement, { room, piece });
  const best = sent.questions.find((q) => q.name === "best");
  assert.deepEqual(best.choices.map((c) => c.value), ["east", "spot_2", "spot_3"]);
  assert.ok(sent.questions.length >= 2 && sent.questions.length <= 4);
  assert.ok(sent.input[1].content.some((c) => c.type === "input_json"));
  assert.deepEqual(out.best.at, [0.47, -2.575]);
  assert.equal(out.best.decision.probability, 0.9);
  assert.match(out.say, /^Fits\. Put it on the west wall: faces the TV/);
  assert.equal(out.spots.at(-1).verdict, "Doesn't fit");
  assert.equal(out.spots.length, 4);
  assert.ok(!out.best.reasons.includes("stub"));
});

test("best spot falls back to the rules' order when Decisions fails", async () => {
  setTransport(() => { throw new Error("network down"); });
  const out = await chooseBest(placement, { room, piece });
  assert.equal(out.best.wall, "east");   // highest rules score
  assert.equal(out.decision.by, "rules");
});

test("best spot with one legal spot makes no call", async () => {
  const one = { ...placement, spots: [placement.spots[1]] };
  const out = await chooseBest(one, { room, piece });
  assert.equal(sent, null); assert.equal(out.best.wall, "west");
});

test("design measures: coffee table, TV, flow, daylight on the fixture", () => {
  const f = Object.fromEntries(measureAll(room, { piece }).map(({ c, facts }) => [c.id, facts]));
  assert.equal(f.coffee_table.ratio, 0.38);
  assert.equal(f.tv_distance.screens_for_distance, "40–55″");
  assert.deepEqual(f.flow.items.sort(), ["dining_chair_3", "sofa"]);
  assert.equal(f.daylight.zones.find((z) => z.zone === "dining table").lit, false);
  assert.ok(f.lamps_per_zone.zones.find((z) => z.zone === "desk").lights_within_2m.length === 0);
});

test("design grade: 4–6 design findings in one request; positions never reach the model", async () => {
  setTransport(fake({ flow: 0.1, coffee_table: 0.3 }));
  const { findings, decision } = await gradeDesign(room, { piece });
  assert.ok(findings.length >= 4 && findings.length <= 6, `${findings.length} findings`);
  assert.equal(decision.questions, findings.length);
  for (const f of findings) {
    assert.equal(f.kind, "design"); assert.equal(typeof f.probability, "number"); assert.ok(f.say.length > 10);
    assert.ok(["info", "warn", "fail"].includes(f.severity));
  }
  const by = Object.fromEntries(findings.map((f) => [f.id, f]));
  assert.equal(by.flow.severity, "fail"); assert.equal(by.coffee_table.severity, "warn"); assert.equal(by.tv_distance.pass, true);
  assert.ok(!JSON.stringify(sent.input).includes('"at"'));
});

test("design grade skips checks with nothing to judge", async () => {
  const bare = { ...room, furniture: [], lights: [] };
  const { findings } = await gradeDesign(bare, {});
  assert.deepEqual(findings.map((f) => f.id), ["daylight", "lamps_per_zone", "flow"]);
});

test("widest route: an empty 3 × 4 m box is wide open, a sofa across it makes the pinch", () => {
  const box = { walls: [{ id: "s", a: [0, 0], b: [3, 0], openings: [{ id: "d1", kind: "door", from: 1, width: 0.9 }] },
    { id: "e", a: [3, 0], b: [3, 4], openings: [] }, { id: "n", a: [3, 4], b: [0, 4], openings: [{ id: "d2", kind: "door", from: 1, width: 0.9 }] },
    { id: "w", a: [0, 4], b: [0, 0], openings: [] }], furniture: [], fixtures: [] };
  const r = widestRoute(box, [1.45, 0.3], [1.55, 3.7]);
  assert.ok(r.width_m > 1.5, `${r.width_m}`);   // clearance also counts the end walls, so not the full 3 m
  assert.ok(r.length_m < 3.6);
  const sofa = { id: "sofa", at: [1.2, 2], size: [2.4, 0.9, 0.8], rot: 0 };   // leaves 0.6 m on the east side
  const p = widestRoute({ ...box, furniture: [sofa] }, [1.45, 0.3], [1.55, 3.7]);
  assert.ok(Math.abs(p.width_m - 0.6) < 0.06, `${p.width_m}`);
  assert.deepEqual(p.beside, ["sofa"]);
});

test("voice routing returns an intent with a probability", async () => {
  setTransport(fake({ intent: "render" }));
  const v = await routeUtterance("show me what it looks like at night");
  assert.equal(v.intent, "render"); assert.equal(v.probability, 0.9); assert.equal(v.sure, true);
  assert.deepEqual(sent.questions[0].choices.map((c) => c.value), ["move", "swap", "ask", "render"]);
});

test("a placed new sofa replaces the old one for the design checks", () => {
  const ctx = { piece: { ...piece, at: [0.47, -2.575], rot: 90 }, replaces: "sofa" };
  const f = Object.fromEntries(measureAll(room, ctx).map(({ c, facts }) => [c.id, facts]));
  assert.equal(f.coffee_table.sofa, "fixture-sofa-84");
  assert.equal(f.coffee_table.ratio, 0.42);
  assert.ok(!f.flow.items.includes("sofa"));
});
