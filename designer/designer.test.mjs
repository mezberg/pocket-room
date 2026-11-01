import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { analyse } from "../rules/index.mjs";
import { room as fixtureRoom } from "../server/fixtures.mjs";
import { setTransport } from "../decisions/client.mjs";
import { advise } from "./index.mjs";
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
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());
const post = (path, body) => fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("POST /api/advice", async () => {
  assert.equal((await post("/advice", { roomId: "hoskins-living" })).status, 400);
  assert.equal((await post("/advice", { roomId: "nope", findings: [] })).status, 404);
  assert.equal((await post("/advice", { roomId: "hoskins-living", findings: [] })).status, 200);
});
