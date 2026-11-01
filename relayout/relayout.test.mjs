import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import { analyse } from "../rules/index.mjs";
import { room as fixtureRoom } from "../server/fixtures.mjs";
import { setTransport } from "../decisions/client.mjs";
import { applyFix } from "../app/js/fix-state.js";
import { relayoutBody, planCard, appliedWords } from "../app/js/relayout-state.js";
import { zonesOf } from "./zones.mjs";
import { relayoutPlans, relayout } from "./index.mjs";
import { relayoutRouter } from "../server/routes/relayout.mjs";

const zoopla = () => JSON.parse(readFileSync(new URL("../room/photo/fixtures/zoopla-openplan-blocked.room.json", import.meta.url)));
const hard = (room) => analyse(room).findings.filter((f) => ["overlap", "door_blocked", "through_wall"].includes(f.id));
const blocked = (room) => analyse(room).findings.filter((f) => f.id === "path_blocked" && f.severity === "fail");

// One search per room, shared by the tests below (each takes a few seconds).
let H, Z;
const hoskins = () => (H ??= relayoutPlans(fixtureRoom()));
const openplan = () => (Z ??= relayoutPlans(zoopla()));

test("zones: the sofa with its coffee table and TV, the dining set, the desk", () => {
  const zs = zonesOf(fixtureRoom());
  const seat = zs.find((z) => z.kind === "seating");
  assert.ok(seat.items.includes("sofa") && seat.items.includes("coffee_table"));
  assert.equal(zs.find((z) => z.id === seat.tv).lead, "tv_bench");
  assert.equal(zs.find((z) => z.kind === "dining").items.length, 5);
  assert.deepEqual(zs.find((z) => z.kind === "work").items, ["desk", "office_chair"]);
  // every piece in one zone at most, fixtures in none
  const all = zs.flatMap((z) => z.items);
  assert.equal(new Set(all).size, all.length);
  assert.ok(!all.includes("built-in_cupboards"));
});

test("Kate's flat: the seating goes towards the window and the blocked way opens", () => {
  const r = hoskins();
  assert.equal(r.before.blocked, 1);
  const best = r.plans[0];
  assert.equal(best.kind, "rearrange");
  assert.equal(best.after.blocked, 0);
  assert.equal(best.after.overlaps, 0);
  assert.ok(best.after.narrowest_m >= 0.6, `narrowest ${best.after.narrowest_m}`);
  assert.ok(best.after.problems < r.before.problems);
  // the sofa moves south (the balcony window is the south wall), at least half a metre, with its coffee table
  const sofa = best.steps.find((s) => s.item === "sofa"), table = best.steps.find((s) => s.item === "coffee_table");
  const s0 = fixtureRoom().furniture.find((x) => x.id === "sofa");
  assert.ok(sofa && s0.at[1] - sofa.at[1] >= 0.5, `sofa ${JSON.stringify(sofa)}`);
  assert.ok(table, "the coffee table goes with it");
  assert.match(best.moves[0], /^Move the sofa.*south, towards the window/);
});

test("every plan is what the rules measure once applied (through the app's own applyFix)", () => {
  for (const [room0, r] of [[fixtureRoom(), hoskins()], [zoopla(), openplan()]]) {
    assert.ok(r.plans.length >= 1 && r.plans.length <= 4);
    for (const p of r.plans) {
      const room = applyFix(room0, p).room;
      assert.equal(hard(room).length, p.after.overlaps, p.say);
      assert.equal(blocked(room).length, p.after.blocked, p.say);
      assert.equal(analyse(room).findings.filter((f) => !f.pass).length, p.after.problems, p.say);
      // nothing new stands in anything else
      assert.ok(hard(room).length <= hard(room0).length, p.say);
      assert.ok(p.say && p.moves.length && p.steps.length);
    }
  }
});

test("the plans are different ideas, not one plan three times", () => {
  const r = hoskins();
  assert.ok(r.plans.length >= 2);
  const sofaAt = (p) => p.steps.find((s) => s.item === "sofa")?.at ?? null;
  // one plan keeps the sofa where it stands, and says what that costs
  const keep = r.plans.find((p) => /^Keep the sofa/.test(p.say));
  assert.ok(keep && !sofaAt(keep), keep?.say);
  // no two plans move the same zones to the same places
  const sig = (p) => p.steps.filter((s) => ["sofa", "dining_table", "desk"].includes(s.item)).map((s) => `${s.item}@${s.at.map((v) => Math.round(v * 2)).join(",")}`).join(";");
  assert.equal(new Set(r.plans.map(sig)).size, r.plans.length);
});

test("a room built from photos: the 26 cm way by the dining table opens", () => {
  const r = openplan();
  assert.ok(r.before.blocked >= 1);
  const best = r.plans[0];
  assert.equal(best.after.blocked, 0);
  assert.ok(best.after.narrowest_m >= 0.6, `narrowest ${best.after.narrowest_m}`);
  // kitchen cabinets and the oven never move
  assert.ok(!best.steps.some((s) => /kitchen|oven/.test(s.item)));
});

test("a tapped problem: the plans that clear it come first", () => {
  const room = fixtureRoom();
  const f = analyse(room).findings.find((x) => x.id === "path_blocked");
  const r = relayoutPlans(room, { focus: f });
  assert.equal(r.plans[0].clears_focus, true);
});

test("nothing to do only when even a re-layout can't help, and then why", () => {
  // a built-in cupboard runs across the room leaving 40 cm: no move, removal or smaller piece opens it
  const W = 3, D = 4;
  const room = { id: "stuck", height: 2.4,
    walls: [{ id: "south", a: [0, 0], b: [W, 0], openings: [{ id: "door", kind: "door", from: 1, width: 0.8 }] },
      { id: "east", a: [W, 0], b: [W, D], openings: [] },
      { id: "north", a: [W, D], b: [0, D], openings: [{ id: "window", kind: "window", from: 1, width: 1, sill: 0.9, head: 2.1 }] },
      { id: "west", a: [0, D], b: [0, 0], openings: [] }],
    fixtures: [{ id: "cupboard", name: "Built-in cupboard", category: "cupboard", at: [1.3, 2], size: [2.6, 0.6, 2.2], rot: 0 }],
    furniture: [{ id: "sofa", name: "Sofa", category: "sofa", at: [1.5, 3.5], size: [2.0, 0.9, 0.85], rot: 0 }] };
  const r = relayoutPlans(room, { budgetMs: 1500 });
  assert.ok(r.none, "says why");
  assert.match(r.none, /the built-in cupboard can't move/);
  assert.match(r.none, /stays at \d+ cm/);
  assert.ok(r.plans.every((p) => p.after.blocked > 0), "no plan claims to open it");
});

test("the Decisions API picks among the measured plans; if it fails the measured order stands", async () => {
  let asked = null;
  setTransport((body) => { asked = body; const c = body.questions[0].choices; return { model: "test", answers: [{ type: "choice", choice: c.at(-1).value, probabilities: c.map((x, i) => ({ value: x.value, probability: i === c.length - 1 ? 0.7 : 0.3 / (c.length - 1) })) }] }; });
  try {
    const out = await relayout(fixtureRoom(), { budgetMs: 2500 });
    if (out.plans.length > 1) {
      assert.ok(asked.questions[0].choices.every((c) => /Narrowest|narrowest/.test(c.description)));
      assert.equal(out.plans[0].best, true);
      assert.equal(out.decision.by, "test");
      assert.equal(out.plans[0].probability, 0.7);
    }
    assert.ok(!("room" in out.plans[0]) && !("_findings" in out.before && out.before._findings));
    setTransport(() => { throw new Error("down"); });
    const fb = await relayout(fixtureRoom(), { budgetMs: 2500 });
    if (fb.plans.length > 1) assert.equal(fb.decision.by, "rules");
  } finally { setTransport(null); }
});

test("the app's card: before → after numbers, the steps, the toast", () => {
  const r = hoskins();
  const c = planCard({ ...r.plans[0], best: true }, r.before, { by: "rules" });
  assert.equal(c.tag, "Best measured");
  assert.match(c.numbers, /Blocked ways 1 → 0/);
  assert.match(c.numbers, /Narrowest walkway 17 cm →/);
  assert.match(appliedWords(r.plans[0]), /^\d+ moves: Move the sofa/);
  const body = relayoutBody(fixtureRoom(), null, null, { id: "path_blocked", at: [1, 1], items: ["sofa"], say: "x", path: [[0, 0]] }, { saved: false });
  assert.equal(body.finding.id, "path_blocked");
  assert.ok(!("path" in body.finding));
});

// --- POST /api/relayout ---------------------------------------------------------------------------------
let server, base;
before(async () => {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api/relayout", relayoutRouter({ decide: false, budgetMs: 2000 }));
  await new Promise((ok) => (server = app.listen(0, ok)));
  server.keepAliveTimeout = 60000;
  base = `http://localhost:${server.address().port}/api/relayout`;
});
after(() => server.close());
const post = (body) => fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("POST /api/relayout: plans for the room it names; an unknown room is a 404", async () => {
  const res = await post({ roomId: "hoskins-living" });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.ok(out.plans.length >= 1);
  assert.ok(out.plans.every((p) => p.say && Array.isArray(p.steps) && p.after && p.id));
  assert.equal(out.before.blocked, 1);
  assert.equal((await post({ roomId: "nope" })).status, 404);
});
