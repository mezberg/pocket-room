import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { analyse, place, outline, footprint } from "../rules/index.mjs";
import { overlap, outside } from "../rules/geom.mjs";
import { room as fixtureRoom, sofa as fixtureSofa } from "../server/fixtures.mjs";
import { getRoom } from "../server/rooms-store.mjs";
import { setTransport } from "../decisions/client.mjs";
import { applyFix } from "../app/js/fix-state.js";
import { planToFix, planMoves, placementOf } from "../app/js/plan-state.js";
import { snap, worse } from "../fixes/measure.mjs";
import { planPiece } from "./plan.mjs";
import { advise, plan } from "./index.mjs";

const armchair = { id: "arm", name: "Armchair", category: "armchair", size: [0.78, 0.82, 0.95] };

// A plan, applied, leaves the new piece legal in its spot (inside, clear of every piece), and its moves keep
// every walkway at 60 cm or more where it was.
function assertPlanLegal(room, piece, p) {
  const after = applyFix(room, planToFix(p)).room;
  const P = footprint(piece, p.spot.at, p.spot.rot);
  assert.ok(outside(outline(after), P) <= 0.02, `${p.say}: pokes out of the room`);
  for (const it of [...after.fixtures, ...after.furniture]) {
    if (it.id === p.spot.replaces || it.category === "rug" || (it.on_floor === false && it.category !== "radiator")) continue;
    assert.ok(overlap(footprint(it), P).depth <= 0.01, `${p.say}: overlaps ${it.id}`);
  }
  if (p.kind === "move") assert.deepEqual(worse(snap(room), snap(after), new Set(), { floor: 0.6 }), [], `${p.say}: the moves make a way worse`);
  assert.ok(["Fits", "Just fits"].includes(p.verdict));
}

test("the 0.78 m armchair that doesn't fit the living room today gets a move-then-place plan", () => {
  const room = fixtureRoom();
  assert.equal(place(room, armchair, { replace: false }).spots.length, 0, "no free spot as the room is");
  const r = planPiece(room, armchair);
  const moved = r.plans.filter((p) => p.kind === "move");
  assert.ok(moved.length >= 1, "a move-then-place plan");
  for (const p of moved) {
    assert.ok(p.moves.length >= 1 && p.moves.length <= 2);
    assert.match(p.say, /^Move .+, then put the new armchair on the .+ wall\.$/);
    assert.ok(p.steps.filter((s) => !s.place).every((s) => s.item && s.at), "each move is a step the app applies");
    assert.ok(!p.moves.some((m) => m.items.some((id) => ["sofa", "built-in_cupboards"].includes(id))), "the stop-list: no sofa, no built-ins");
    assertPlanLegal(room, armchair, p);
  }
  assert.ok(r.ms < 4000, `${r.ms} ms`);
});

test("the fixture sofa: a replace plan for the old sofa; every plan legal and ending in the piece going in", () => {
  const room = fixtureRoom(), sofa = fixtureSofa();
  const r = planPiece(room, sofa);
  assert.ok(r.plans.some((p) => p.kind === "replace" && p.spot.replaces === "sofa"));
  for (const p of r.plans) {
    assertPlanLegal(room, sofa, p);
    assert.deepEqual(p.steps[p.steps.length - 1].place.at, p.spot.at);
  }
});

test("a free spot when there is one; an honest no when even moving things won't do", async () => {
  const room = fixtureRoom();
  const lamp = { id: "lamp", name: "Lamp", category: "lamp", size: [0.3, 0.3, 1.5] };
  const r = planPiece(room, lamp);
  assert.ok(r.plans.some((p) => p.kind === "place"), "a small lamp has a free spot");
  const sofa = { id: "s", name: "Sofa", category: "sofa", size: [2.2, 0.95, 0.85] };
  const no = await plan(getRoom("hoskins-bedroom"), sofa, { decide: false });
  assert.equal(no.plans.length, 0);
  assert.equal(no.verdict, "Doesn't fit");
  assert.match(no.say, /^Doesn't fit\. No spot, even after moving things: .+/);
});

test("the Decisions API picks a plan and its one-line reason; a failed call keeps the measured order", async () => {
  const room = fixtureRoom();
  const side = { id: "x", name: "Side table", category: "table", size: [0.4, 0.4, 0.5] };
  let asked;
  setTransport((body) => {
    asked = body;
    return { model: "gpt-6-luna", answers: body.questions.map((q) => {
      const last = q.choices[q.choices.length - 1].value;
      return { type: "choice", name: q.name, choice: last, confidence: 0.4, probabilities: q.choices.map((c) => ({ value: c.value, probability: c.value === last ? 0.7 : 0.3 / Math.max(1, q.choices.length - 1) })) };
    }) };
  });
  try {
    const out = await plan(room, side);
    assert.ok(out.plans.length > 1, "more than one plan to choose from");
    assert.equal(asked.questions[0].name, "plan");
    assert.ok(asked.questions[0].choices.every((c) => /\((Fits|Just fits)\)/.test(c.description)), "each choice carries its measured verdict");
    assert.equal(out.plans[0].best, true);
    assert.equal(out.plans[0].probability, 0.7);
    assert.ok(out.plans[0].reasons.includes(out.plans[0].reason), "the reason is a sentence code wrote");
    assert.match(out.say, /Why: /);
    setTransport(() => { throw new Error("down"); });
    const fb = await plan(room, side);
    assert.equal(fb.decision.by, "rules");
    assert.equal(fb.plans[0].best, true);
  } finally { setTransport(null); }
});

test("plan-state: the preview shows moves, the piece replaced and the new piece; applied it is one spot", () => {
  const room = fixtureRoom(), sofa = fixtureSofa();
  const r = planPiece(room, sofa);
  const p = r.plans.find((x) => x.kind === "replace");
  const moves = planMoves(room, p, sofa);
  assert.ok(moves.some((m) => m.remove && m.item.id === "sofa"), "the old sofa tinted red");
  assert.ok(moves.some((m) => m.piece && m.to === p.spot.at), "the new sofa's ghost in its spot");
  const pl = placementOf({ ...r, say: "Just fits. …", best: p }, p);
  assert.equal(pl.spots.length, 1);
  assert.equal(pl.best.replaces, "sofa");
  assert.deepEqual(planToFix(p).steps, [], "a replace plan moves nothing else");
  const m = r.plans.find((x) => x.kind === "move") ?? planPiece(room, armchair).plans.find((x) => x.kind === "move");
  const mv = planMoves(room, m, armchair);
  assert.ok(mv.some((x) => x.from && x.to && (x.from[0] !== x.to[0] || x.from[1] !== x.to[1])), "a moved piece has an arrow from where it was");
});
import { designerRouter } from "../server/routes/designer.mjs";

const noDecide = { decide: false };

test("advice: the Decisions API ranks the checker's own sentences; a failed call keeps fail before warn", async () => {
  const room = fixtureRoom();
  const findings = analyse(room).findings;
  const bad = findings.filter((f) => !f.pass);
  assert.ok(bad.length >= 2);
  setTransport((body) => {
    const q = body.questions[0];
    assert.equal(q.type, "choice");
    assert.ok(q.choices.every((c, k) => c.description === bad[k].say), "the model chooses among sentences code wrote");
    const last = q.choices[q.choices.length - 1].value;
    return { model: "gpt-6-luna", answers: [{ type: "choice", name: "first", choice: last, confidence: 0.5,
      probabilities: q.choices.map((c) => ({ value: c.value, probability: c.value === last ? 0.6 : 0.4 / (q.choices.length - 1) })) }] };
  });
  try {
    const a = await advise(room, findings);
    assert.equal(a.by, "gpt-6-luna");
    assert.equal(findings[a.ranked[0].index].say, bad[bad.length - 1].say);
    assert.equal(a.ranked.length, bad.length);
    setTransport(() => { throw new Error("down"); });
    const fb = await advise(room, findings);
    assert.equal(fb.by, "rules");
    assert.equal(findings[fb.ranked[0].index].severity, "fail");
  } finally { setTransport(null); }
});

let server, base;
before(async () => {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api", designerRouter(noDecide));
  await new Promise((ok) => (server = app.listen(0, ok)));
  // under the full suite the event loop can stall past the server's 5 s keep-alive while the client reuses the
  // socket (\"fetch failed\"): keep idle sockets open longer than the client does
  server.keepAliveTimeout = 60000;
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());
const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("POST /api/plan", async () => {
  const res = await post("/plan", { roomId: "hoskins-living", piece: armchair });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.ok(out.plans.length >= 1);
  assert.equal((await post("/plan", { roomId: "hoskins-living" })).status, 400);
  assert.equal((await post("/plan", { roomId: "nope", piece: armchair })).status, 404);
});

test("POST /api/advice", async () => {
  assert.equal((await post("/advice", { roomId: "hoskins-living" })).status, 400);
  assert.equal((await post("/advice", { roomId: "nope", findings: [] })).status, 404);
  assert.equal((await post("/advice", { roomId: "hoskins-living", findings: [] })).status, 200);
});
