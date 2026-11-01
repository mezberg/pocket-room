import { test } from "node:test";
import assert from "node:assert/strict";
import { fixBody, applyFix, undoStack, withFixed, previewMoves } from "./fix-state.js";

const room = () => ({
  id: "r", walls: [], fixtures: [{ id: "rad", category: "radiator", at: [0, 0], size: [1, 0.1, 0.6] }],
  furniture: [
    { id: "chair", category: "chair", at: [1, 1], rot: 0, size: [0.5, 0.5, 0.9] },
    { id: "bag", category: "other", at: [2, 2], rot: 0, size: [0.4, 0.3, 0.2] },
    { id: "table", category: "table", at: [3, 3], rot: 90, size: [0.9, 0.5, 0.45] },
    { id: "lamp", category: "lamp", at: [0.5, 2], rot: 0, size: [0.3, 0.3, 1.5] },
  ],
  lights: [{ id: "lamp", kind: "floor_lamp", at: [0.5, 2], h: 1.4 }],
});

test("apply: move, turn, remove, resize and add, without touching the room passed in", () => {
  const r = room();
  const before = structuredClone(r);
  const { room: out } = applyFix(r, { steps: [
    { item: "chair", at: [1, 1.1], rot: 0 },
    { item: "table", at: [3, 3], rot: 180 },
    { item: "bag", remove: true },
    { item: "table", size: [1.2, 0.6, 0.45] },
    { add: { id: "new_floor_lamp", category: "lamp", at: [4, 4], rot: 0, size: [0.3, 0.3, 1.55] }, light: { id: "new_floor_lamp", kind: "floor_lamp", at: [4, 4], h: 1.4 } },
    { item: "lamp", at: [0.6, 2], rot: 0 },
  ] });
  assert.deepEqual(r, before, "the old room is unchanged (undo needs it)");
  const by = (id) => out.furniture.find((f) => f.id === id);
  assert.deepEqual(by("chair").at, [1, 1.1]);
  assert.equal(by("table").rot, 180);
  assert.deepEqual(by("table").size, [1.2, 0.6, 0.45]);
  assert.equal(by("bag"), undefined);
  assert.deepEqual(by("new_floor_lamp").at, [4, 4]);
  assert.ok(out.lights.some((l) => l.id === "new_floor_lamp"));
  assert.deepEqual(out.lights.find((l) => l.id === "lamp").at, [0.6, 2], "a lamp that moves takes its light with it");
  assert.equal(out.fixtures.length, 1);
});

test("apply: a step on the new piece moves its spot, not the room", () => {
  const r = room();
  const spot = { at: [5, 5], rot: 90, verdict: "Just fits" };
  const { room: out, spot: s } = applyFix(r, { steps: [{ item: "new-sofa", at: [5, 5.2], rot: 90 }] }, { pieceId: "new-sofa", spot });
  assert.deepEqual(s.at, [5, 5.2]);
  assert.equal(s.moved, true);
  assert.deepEqual(out.furniture, r.furniture);
  assert.deepEqual(spot.at, [5, 5], "the old spot is unchanged");
});

test("undo: what was there before each apply comes back, newest first", () => {
  const u = undoStack();
  const r0 = room();
  u.push({ room: r0 });
  const r1 = applyFix(r0, { steps: [{ item: "bag", remove: true }] }).room;
  u.push({ room: r1 });
  assert.equal(u.size, 2);
  assert.equal(u.pop().room.furniture.length, 3);
  assert.deepEqual(u.pop().room, r0);
  assert.equal(u.pop(), null);
  u.push({ room: r0 }); u.clear();
  assert.equal(u.size, 0);
});

test("after a fix: the finding shows as Fixed when it's gone, and stays when it isn't", () => {
  const fixed = { id: "overlap", kind: "model", at: [1, 1], items: ["chair", "table"], say: "The chair and the table overlap by 10 cm." };
  const opt = { say: "Move the chair 10 cm north." };
  const other = { id: "walkway_tight", pass: false, at: [3, 3], items: ["table"], say: "…" };
  const gone = withFixed([other], fixed, opt);
  assert.equal(gone.length, 2);
  assert.equal(gone[0].fixed, true);
  assert.equal(gone[0].pass, true);
  assert.match(gone[0].say, /^Fixed: Move the chair/);
  const still = withFixed([{ ...fixed, pass: false, say: "The chair and the table overlap by 4 cm." }, other], fixed, opt);
  assert.equal(still.length, 2, "same pieces at the same place: not fixed");
  // a different way still closed near the same spot is another finding: the fixed one still shows as fixed
  const near = withFixed([{ id: "overlap", pass: false, at: [1.1, 1], items: ["chair", "bag"], say: "The chair and the bag overlap." }], fixed, opt);
  assert.equal(near[0].fixed, true);
  assert.deepEqual(withFixed([other], null, opt), [other]);
});

test("the request and the preview", () => {
  const r = room();
  const f = { id: "overlap", kind: "model", at: [1, 1], items: ["chair"], say: "x", path: [[0, 0]], extra: 1 };
  const body = fixBody(r, null, null, f, { saved: true });
  assert.deepEqual(body, { roomId: "r", finding: { id: "overlap", kind: "model", at: [1, 1], items: ["chair"], say: "x", width_m: undefined } });
  assert.ok(fixBody(r, null, null, f, { saved: false }).room, "an unsaved room goes whole");
  const moves = previewMoves(r, { steps: [{ item: "chair", at: [1, 1.2], rot: 0 }, { item: "bag", remove: true }, { add: { id: "n", at: [4, 4], size: [0.3, 0.3, 1.5] } }] });
  assert.deepEqual(moves[0].from, [1, 1]);
  assert.deepEqual(moves[0].to, [1, 1.2]);
  assert.equal(moves[1].remove, true);
  assert.deepEqual(moves[2].to, [4, 4]);
});
