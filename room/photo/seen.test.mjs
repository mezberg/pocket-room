import { test } from "node:test";
import assert from "node:assert/strict";
import { spotUnseen, preferSeen } from "./seen.mjs";

const room = {
  walls: [["south", [0, 0], [4, 0], []], ["east", [4, 0], [4, 3], [[1, 3]]], ["north", [4, 3], [0, 3], null], ["west", [0, 3], [0, 0], []]]
    .map(([id, a, b, seen]) => (seen ? { id, a, b, seen } : { id, a, b })),
  floor_seen: [[0, 1], [4, 1], [4, 3], [0, 3]],
};
const S = (wall, at, verdict = "Fits") => ({ wall, at, rot: 0, verdict, score: 1 });

test("a spot on an unseen wall or floor", () => {
  assert.equal(spotUnseen(room, S("south", [2, 0.45])), "wall");
  assert.equal(spotUnseen(room, S("east", [3.55, 2])), null);
  assert.equal(spotUnseen(room, { at: [2, 0.5] }), "floor");
});

test("seen spots first; best and say follow", () => {
  const p = { verdict: "Fits", say: "Fits. Put it on the south wall.", spots: [S("south", [2, 0.45]), S("north", [2, 2.55], "Just fits")] };
  p.best = p.spots[0];
  const out = preferSeen(room, p);
  assert.deepEqual(out.spots.map((s) => s.wall), ["north", "south"]);
  assert.equal(out.best.wall, "north");
  assert.equal(out.verdict, "Just fits");
  assert.equal(out.say, "Just fits. Put it on the north wall, where your photos show the room.");
  assert.equal(out.spots[1].unseen, "wall");
});

test("nothing seen fits: the verdict says so; a room with no seen data is left alone", () => {
  const p = { verdict: "Fits", say: "Fits. Put it on the south wall.", spots: [S("south", [2, 0.45])] };
  assert.match(preferSeen(room, p).say, /wasn't in your photos, so check it's clear\.$/);
  const known = { walls: room.walls.map(({ seen, ...w }) => w) };
  assert.equal(preferSeen(known, p), p);
});
