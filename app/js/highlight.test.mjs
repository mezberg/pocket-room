import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse } from "../../rules/index.mjs";
import { room as fixtureRoom } from "../../server/fixtures.mjs";
import { suggest } from "../../fixes/index.mjs";
import { applyFix } from "./fix-state.js";
import { highlightsOf, pinch } from "./highlight.js";

test("Check my room on the flat: the overlapping pieces glow, the blocked way is a red band at its pinch", () => {
  const findings = analyse(fixtureRoom()).findings;
  const h = highlightsOf(findings);
  assert.ok(h.glow.includes("coffee_table") && h.glow.includes("dining_chair_3"), "the coffee table and chair 3 overlap");
  const red = h.bands.filter((b) => b.color === "red");
  assert.ok(red.length >= 1, "a blocked way");
  const f = findings.find((x) => x.id === "path_blocked");
  for (const p of red[0].path) assert.ok(Math.hypot(p[0] - f.at[0], p[1] - f.at[1]) <= 1.35, "the band stays by the pinch");
  assert.ok(h.bands.some((b) => b.color === "amber"), "a tight walkway in amber");
});

test("the highlight clears once the problem is fixed and the room checked again", async () => {
  const room = fixtureRoom();
  const f = analyse(room).findings.find((x) => x.id === "overlap");
  const { options } = await suggest(room, f, {}, { decide: false });
  const after = applyFix(room, options[0]).room;
  const h = highlightsOf(analyse(after).findings);
  assert.ok(!(h.glow.includes("coffee_table") && h.glow.includes("dining_chair_3") && analyse(after).findings.some((x) => x.id === "overlap" && x.items.includes("coffee_table"))), "no longer drawn as overlapping");
  assert.deepEqual(highlightsOf([{ ...f, pass: true }]), { glow: [], bands: [] }, "a passing or fixed finding draws nothing");
});

test("pinch: the run of path points round the marker", () => {
  const path = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0]];
  assert.deepEqual(pinch(path, [2.5, 0], 1), [[2, 0], [3, 0]]);
  assert.deepEqual(pinch(path, [2, 0], 1.1), [[1, 0], [2, 0], [3, 0]]);
  assert.equal(pinch(path, [9, 9], 0.5).length, 2, "never a single point");
});
