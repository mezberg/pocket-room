import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { analyse, place, WALK_MIN } from "../rules/index.mjs";
import { tiny, typical, crowded } from "../rules/sample-rooms.mjs";
import { room as fixtureRoom, sofa as fixtureSofa } from "../server/fixtures.mjs";
import { setTransport } from "../decisions/client.mjs";
import { CHECKS, withPiece } from "../decisions/design.mjs";
import { applyFix } from "../app/js/fix-state.js";
import { suggest, REMOVABLE, canRemove } from "./index.mjs";
import { snap, worse } from "./measure.mjs";
import { fixesRouter } from "../server/routes/fixes.mjs";

const NEVER_REMOVE = ["table", "desk", "sofa", "armchair", "bed", "shelf", "wardrobe", "cupboard", "dresser", "tv", "radiator"];
const noDecide = { decide: false };

// Every option that has steps must really clear its finding and break nothing: apply it and measure again.
function assertChecked(room, f, opt, ctx = {}) {
  const before = withPiece(room, ctx);
  const after = applyFix(before, opt, {}).room;
  const s0 = snap(before), s1 = snap(after);
  const ignore = new Set();
  if (/path_blocked|walkway_tight|flow/.test(f.id)) for (const [k, r] of s0.rs) if (r.width < 0.75) ignore.add(k);
  assert.deepEqual(worse(s0, s1, ignore), [], `"${opt.say}" makes something worse`);
  if (f.id === "overlap") assert.ok(!s1.ov.has([...f.items].sort().join("|")), `"${opt.say}" leaves the overlap`);
  for (const st of opt.steps) if (st.remove) {
    const it = [...(before.furniture ?? [])].find((x) => x.id === st.item);
    assert.ok(REMOVABLE.has(it.category), `"${opt.say}" removes a ${it.category}`);
  }
}

test("the fixture flat: the overlap gets measured fixes that clear it and break nothing", async () => {
  const room = fixtureRoom();
  const f = analyse(room).findings.find((x) => x.id === "overlap");
  assert.ok(f, "the fixture has its coffee table / chair overlap");
  const out = await suggest(room, f, {}, noDecide);
  assert.ok(out.options.length >= 2, "more than one way to clear it");
  assert.ok(out.options.length <= 3);
  assert.equal(out.options.filter((o) => o.best).length, 1);
  for (const o of out.options) assertChecked(room, f, o);
  assert.ok(out.ms < 4000, `took ${out.ms} ms`);
});

test("a blocked way gets a multi-step fix that opens it to 60 cm", async () => {
  const room = fixtureRoom();
  const f = analyse(room).findings.find((x) => x.id === "path_blocked");
  const out = await suggest(room, f, {}, noDecide);
  assert.ok(out.options.length, out.none);
  const o = out.options[0];
  assert.ok(o.after_m >= WALK_MIN - 0.01);
  assertChecked(room, f, o);
  // and Check my room agrees: that finding is gone once applied
  const after = applyFix(room, o).room;
  assert.ok(!analyse(after).findings.some((g) => g.id === "path_blocked" && g.say === f.say));
});

test("stop-list: no option ever takes out a table, sofa, shelf, bed or the new piece", async () => {
  for (const c of NEVER_REMOVE) assert.ok(!REMOVABLE.has(c), c);
  const sofa = fixtureSofa();
  const rooms = [fixtureRoom(), tiny(), typical(), crowded()];
  let options = 0;
  for (const room of rooms) {
    const p = place(room, sofa);
    const ctxs = [{}];
    if (p.best) ctxs.push({ piece: { ...sofa, at: p.best.at, rot: p.best.rot }, replaces: p.best.replaces });
    for (const ctx of ctxs) {
      for (const f of analyse(withPiece(room, ctx)).findings.filter((x) => !x.pass)) {
        const out = await suggest(room, f, ctx, { ...noDecide, budgetMs: 800 });
        for (const o of out.options) {
          options++;
          for (const st of o.steps) {
            if (!st.remove) continue;
            const it = withPiece(room, ctx).furniture.find((x) => x.id === st.item);
            assert.ok(REMOVABLE.has(it.category), `${room.id}: "${o.say}" removes a ${it.category}`);
            assert.notEqual(st.item, sofa.id);
          }
          assert.ok(!o.steps.some((st) => (room.fixtures ?? []).some((x) => x.id === st.item)), `"${o.say}" moves a fixture`);
        }
        if (!out.options.length) assert.match(out.none, /\w/);
      }
    }
  }
  assert.ok(options > 0);
  assert.equal(canRemove(fixtureRoom(), { id: "x", category: "table" }), false);
  assert.equal(canRemove(fixtureRoom(), { id: "x", category: "other" }), true);
  assert.equal(canRemove(fixtureRoom(), { id: "new", category: "chair" }, { pieceId: "new" }), false);
});

test("lamps: a floor lamp is added where it lights the dark corner and blocks nothing", async () => {
  const room = fixtureRoom();
  const L = CHECKS.find((c) => c.id === "lamps_per_zone");
  const dark = (r) => { const m = L.measure(r, {}); return m.zones.filter((z) => !z.lights_within_2m.length).length + m.dark_corners.length; };
  assert.ok(dark(room) > 0, "the fixture has a dark corner");
  const out = await suggest(room, { id: "lamps_per_zone", kind: "design", pass: false, say: "dark" }, {}, noDecide);
  assert.ok(out.options.length, out.none);
  const o = out.options[0];
  assert.equal(o.kind, "add");
  const after = applyFix(room, o).room;
  assert.ok(dark(after) < dark(room));
  assert.deepEqual(worse(snap(room), snap(after)), []);
});

test("coffee table: the right size where it fits, else a shopping hint that says why", async () => {
  const room = fixtureRoom();
  const out = await suggest(room, { id: "coffee_table", kind: "design", pass: false, say: "small" }, {}, noDecide);
  assert.equal(out.options.length, 1);
  const o = out.options[0];
  assert.ok(["resize", "shop"].includes(o.kind));
  assert.equal(o.shop.name, "coffee table");
  const sofaLen = room.furniture.find((f) => f.category === "sofa").size[0];
  assert.ok(o.shop.size[0] >= sofaLen * 0.49 && o.shop.size[0] <= sofaLen * 0.7);
  if (o.kind === "shop") { assert.equal(o.steps.length, 0); assert.match(o.say, /not where this one stands yet: .+/); }
});

test("no easy fix: a plain sentence why, never an empty answer", async () => {
  const room = fixtureRoom();
  for (const id of ["daylight", "style", "too_tall"]) {
    const out = await suggest(room, { id, pass: false, say: "x" }, {}, noDecide);
    assert.equal(out.options.length, 0);
    assert.match(out.none, /^No easy fix: /);
  }
});

test("the Decisions API picks among the measured options; a failed call keeps the measured order", async () => {
  const room = fixtureRoom();
  const f = analyse(room).findings.find((x) => x.id === "overlap");
  let asked;
  setTransport((body) => {
    asked = body;
    const q = body.questions[0];
    const last = q.choices[q.choices.length - 1].value;
    return { model: "gpt-6-luna", answers: [{ type: "choice", name: "fix", choice: last, confidence: 0.5,
      probabilities: q.choices.map((c) => ({ value: c.value, probability: c.value === last ? 0.8 : 0.2 / (q.choices.length - 1) })) }] };
  });
  try {
    const out = await suggest(room, f, {});
    assert.equal(asked.questions[0].type, "choice");
    assert.ok(asked.questions[0].choices.every((c) => c.description.length > 10), "the model chooses among sentences code wrote");
    assert.equal(out.options[0].best, true);
    assert.equal(out.options[0].probability, 0.8);
    assert.equal(out.decision.by, "gpt-6-luna");
    setTransport(() => { throw new Error("down"); });
    const fallback = await suggest(room, f, {});
    assert.equal(fallback.decision.by, "rules");
    assert.equal(fallback.options[0].best, true);
    assert.equal(fallback.options.length, out.options.length);
  } finally { setTransport(null); }
});

test("with a new piece placed, fixes are measured on the room with it in", async () => {
  const room = fixtureRoom(), sofa = fixtureSofa();
  const p = place(room, sofa);
  const ctx = { piece: { ...sofa, at: p.best.at, rot: p.best.rot }, replaces: p.best.replaces };
  const f = analyse(withPiece(room, ctx)).findings.find((x) => x.id === "walkway_tight" && x.items?.length);
  const out = await suggest(room, f, ctx, noDecide);
  for (const o of out.options) {
    assert.ok(!o.steps.some((s) => s.item === p.best.replaces), "never moves the piece that was replaced");
    assertChecked(room, f, o, ctx);
  }
});

// --- POST /api/fixes ------------------------------------------------------------------------------------

let server, base;
before(async () => {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api/fixes", fixesRouter({ decide: false }));
  await new Promise((ok) => (server = app.listen(0, ok)));
  // under the full suite the event loop can stall past the server's 5 s keep-alive while the client reuses the
  // socket (\"fetch failed\"): keep idle sockets open longer than the client does
  server.keepAliveTimeout = 60000;
  base = `http://localhost:${server.address().port}/api/fixes`;
});
after(() => server.close());

const post = (body) => fetch(base, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("POST /api/fixes: options for a finding of the room it names", async () => {
  const f = analyse(fixtureRoom()).findings.find((x) => x.id === "overlap");
  const res = await post({ roomId: "hoskins-living", finding: f });
  assert.equal(res.status, 200);
  const out = await res.json();
  assert.equal(out.finding, "overlap");
  assert.ok(out.options.length >= 1);
  assert.ok(out.options.every((o) => o.say && Array.isArray(o.steps)));
});

test("POST /api/fixes: a finding is needed, and an unknown room is a 404", async () => {
  assert.equal((await post({ roomId: "hoskins-living" })).status, 400);
  assert.equal((await post({ roomId: "nope", finding: { id: "overlap" } })).status, 404);
});

// Regression: rooms from photos record no lights but keep the lamps they saw as furniture. The designer used to
// call the sofa dark and put a new floor lamp on top of the one standing beside it.
test("lamp fix: a lamp already by the sofa counts as light, and no new lamp lands on or beside it", async () => {
  const { readFileSync } = await import("node:fs");
  const { searchLamp } = await import("./search.mjs");
  const room = JSON.parse(readFileSync(new URL("../room/photo/fixtures/zoopla-openplan-blocked.room.json", import.meta.url)));
  const lampCheck = CHECKS.find((c) => c.id === "lamps_per_zone");
  for (const on_floor of [true, false]) {
    const lamp = { id: "lamp_1", name: "Floor lamp", category: "lamp", at: [1.66, 3.45], size: [0.35, 0.35, 1.6], rot: 0, on_floor };
    const r = { ...room, lights: [], furniture: [...room.furniture, lamp] };
    const sofaZone = lampCheck.measure(r, {}).zones.find((z) => z.zone === "sofa");
    assert.ok(sofaZone.lights_within_2m.length, "the lamp beside the sofa lights the sofa");
    for (const fx of searchLamp(r, {}).fixes) {
      const at = fx.steps[0].add.at;
      assert.ok(Math.hypot(at[0] - lamp.at[0], at[1] - lamp.at[1]) >= 0.6, `new lamp ${at} too close to the existing one`);
      assert.notEqual(fx.steps[0].add.id, "lamp_1");
    }
  }
});

test("lamp fix: a second added lamp gets its own id", async () => {
  const { searchLamp } = await import("./search.mjs");
  const room = fixtureRoom();
  const first = searchLamp(room, {}).fixes[0];
  if (!first) return;   // nothing dark in the fixture: nothing to add
  const after = applyFix(room, first).room;
  const second = searchLamp({ ...after, lights: after.lights.filter((l) => l.id !== first.steps[0].add.id) }, {}).fixes[0];
  if (second) assert.notEqual(second.steps[0].add.id, first.steps[0].add.id);
});
