// The app's replace logic: a spot that replaces the old sofa takes it out of the room it sends and shows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { roomWithPiece, analyseBody, placeBody, hiddenIds, spotOf, chanceWords } from "./scene-state.js";
import { analyse } from "../../rules/index.mjs";

const room = JSON.parse(readFileSync(new URL("../../contract/fixtures/hoskins-living-room.room.json", import.meta.url)));
const piece = JSON.parse(readFileSync(new URL("../../contract/fixtures/sofa-84.piece.json", import.meta.url)));
const spot = { at: [0.58, -2.59], rot: 90, wall: "west", verdict: "Just fits", replaces: "sofa" };

test("the replaced sofa leaves the room; no 'the sofa and the green velvet sofa overlap'", () => {
  const r = roomWithPiece(room, piece, spot);
  assert.ok(!r.furniture.some((f) => f.id === "sofa"));
  assert.ok(r.furniture.some((f) => f.id === piece.id && f.at === spot.at));
  const { findings } = analyse(r);
  assert.ok(!findings.some((f) => f.id === "overlap" && f.items.includes(piece.id)), findings.map((f) => f.say).join("\n"));
  assert.equal(room.furniture.filter((f) => f.id === "sofa").length, 1, "the room itself is untouched");
});

test("a spot that replaces nothing keeps every item", () => {
  const r = roomWithPiece(room, piece, { ...spot, replaces: undefined });
  assert.equal(r.furniture.length, room.furniture.length + 1);
  assert.deepEqual(hiddenIds({ ...spot, replaces: undefined }), []);
  assert.deepEqual(hiddenIds(spot), ["sofa"]);
});

test("analyse body: room by id, the piece in its spot, what it replaces", () => {
  const b = analyseBody(room, piece, spot);
  assert.equal(b.roomId, "hoskins-living");
  assert.equal(b.room, undefined);
  assert.deepEqual(b.piece.at, spot.at);
  assert.equal(b.piece.rot, 90);
  assert.equal(b.replaces, "sofa");
  assert.equal(analyseBody(room, null, null).piece, undefined);
  assert.equal(analyseBody(room, piece, spot, { saved: false }).room.id, "hoskins-living");
});

test("place body sends the id, and the room only when the server doesn't keep it", () => {
  assert.deepEqual(Object.keys(placeBody(room, piece)), ["roomId", "piece"]);
  assert.ok(placeBody(room, piece, { saved: false }).room);
});

test("spotOf and chanceWords", () => {
  const p = { best: spot, spots: [spot, { ...spot, wall: "east" }] };
  assert.equal(spotOf(p, 1).wall, "east");
  assert.equal(spotOf({ best: spot }, 3), spot);
  assert.equal(chanceWords({ kind: "design", pass: false, probability: 0 }), "very likely a problem, 100% sure");
  assert.equal(chanceWords({ kind: "design", pass: false, probability: 0.4 }), "likely a problem, 60% sure");
  assert.equal(chanceWords({ kind: "design", pass: true, probability: 0.82 }), "looks right, 82% sure");
  assert.equal(chanceWords({ kind: "model", pass: false }), "");
});
