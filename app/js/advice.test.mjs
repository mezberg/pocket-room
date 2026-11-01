import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse } from "../../rules/index.mjs";
import { room as fixtureRoom } from "../../server/fixtures.mjs";
import { rankFindings, fold, BLOCKING } from "./advice.js";

const design = (id, p, severity = "warn") => ({ id, kind: "design", pass: false, severity, probability: p, say: id });

test("blocking rules first, then the advice's order; the top three ranked, the rest folded", () => {
  const findings = [
    design("daylight", 0.45), design("lamps_per_zone", 0, "fail"),
    ...analyse(fixtureRoom()).findings,
    { id: "tv_distance", kind: "design", pass: true, severity: "info", say: "ok" },
  ];
  // the advice likes lamps best, then daylight
  const advice = { ranked: [{ index: 1, p: 0.5 }, { index: 0, p: 0.3 }] };
  const out = rankFindings(findings, advice);
  assert.equal(out.length, findings.length);
  const firstNonBlocking = out.findIndex((f) => !(BLOCKING.has(f.id) && f.kind === "model"));
  assert.ok(out.slice(0, firstNonBlocking).every((f) => !f.pass), "only problems before");
  assert.ok(out.slice(firstNonBlocking).every((f) => !(BLOCKING.has(f.id) && f.kind === "model" && !f.pass)), "every blocking rule is ahead of the rest");
  const afterBlocking = out.slice(firstNonBlocking).filter((f) => !f.pass);
  assert.ok(afterBlocking.findIndex((f) => f.id === "lamps_per_zone") < afterBlocking.findIndex((f) => f.id === "daylight"), "then the advice's order");
  assert.deepEqual(out.filter((f) => f.rank).map((f) => f.rank), [1, 2, 3]);
  assert.equal(out[out.length - 1].id, "tv_distance", "passing ones last");
  const { shown, more } = fold(out);
  assert.equal(shown.length, 3);
  assert.equal(shown.length + more.length, out.length);
});

test("no advice (the call failed): severity order; a just-fixed finding stays on top", () => {
  const out = rankFindings([design("style", 0.4), design("coffee_table", 0.1, "fail"), { id: "overlap", kind: "model", pass: true, fixed: true, say: "Fixed: …" }]);
  assert.equal(out[0].fixed, true);
  assert.equal(out[1].id, "coffee_table");
  assert.equal(out[1].rank, 1);
  assert.deepEqual(fold(out).shown, [0, 1, 2]);
});
