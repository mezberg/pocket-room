import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLength, formatLength, editLength, accuracyWords, nextShot, sortRooms, roomSize } from "./new-room.js";

test("lengths typed by hand, in metres or feet and inches", () => {
  assert.equal(parseLength("3.8"), 3.8);
  assert.equal(parseLength("3,8 m"), 3.8);
  assert.equal(parseLength("380 cm"), 3.8);
  assert.equal(parseLength("380"), 3.8);                 // a big bare number is centimetres
  assert.equal(parseLength("12' 6\""), 3.81);
  assert.equal(parseLength("12ft 6in"), 3.81);
  assert.equal(parseLength("12′6″"), 3.81);
  assert.equal(parseLength("12 6", "ft"), 3.81);
  assert.equal(parseLength("12", "ft"), 3.658);
  assert.equal(parseLength("3.8 m", "ft"), 3.8);          // a unit in the text wins
  assert.equal(parseLength("150 in"), 3.81);
  assert.equal(parseLength(""), null);
  assert.equal(parseLength("about four"), null);
});

test("lengths shown back", () => {
  assert.equal(formatLength(3.81, "ft"), "12′ 6″");
  assert.equal(formatLength(3.8), "3.80 m");
  assert.equal(parseLength(editLength(3.81, "ft"), "ft"), 3.81);
  assert.equal(parseLength(editLength(3.8)), 3.8);
});

test("how sure the room is, in words", () => {
  assert.equal(accuracyWords({ source: "prebuilt", accuracy_m: 0.04 }).level, "exact");
  assert.equal(accuracyWords({ source: "photo", accuracy_m: 0.05 }).say, "Measured: within about 5 cm.");
  assert.match(accuracyWords({ source: "photo", accuracy_m: 0.1 }).say, /within about 10 cm/);
  assert.match(accuracyWords({ source: "photo", accuracy_m: 0.32 }).say, /within about 30 cm.*measure two walls/i);
  const rough = accuracyWords({ source: "photo", accuracy_m: 2.96 });
  assert.equal(rough.level, "rough");
  assert.match(rough.say, /^Rough: could be 3 m out\. Measure two walls/);
});

test("the corner guide, then enough", () => {
  assert.equal(nextShot(0).title, "Photo 1 of 4");
  assert.equal(nextShot(3).corner, 3);
  assert.equal(nextShot(4).corner, null);
});

test("room switcher: the flat first, living room on top, then the newest built room", () => {
  const { flat, built } = sortRooms([
    { id: "hoskins-bedroom", name: "Bedroom", source: "prebuilt" }, { id: "photo-a1", name: "A", source: "photo" },
    { id: "hoskins-living", name: "Reception", source: "prebuilt" }, { id: "photo-b2", name: "B", source: "photo" },
  ]);
  assert.deepEqual(flat.map((r) => r.id), ["hoskins-living", "hoskins-bedroom"]);
  assert.deepEqual(built.map((r) => r.id), ["photo-b2", "photo-a1"]);
});

test("room size from any outline", () => {
  const walls = [[0, 0], [4, 0], [4, 3], [1, 3], [1, 5], [0, 5]].map((a, i, all) => ({ a, b: all[(i + 1) % all.length] }));
  assert.deepEqual(roomSize({ walls }), { width: 4, depth: 5 });
});

import { seenShare, spotUnseen } from "./new-room.js";
const box = {
  walls: [["south", [0, 0], [4, 0], []], ["east", [4, 0], [4, 3], [[1, 3]]], ["north", [4, 3], [0, 3], undefined], ["west", [0, 3], [0, 0], []]]
    .map(([id, a, b, seen]) => (seen ? { id, a, b, seen } : { id, a, b })),
  floor_seen: [[0, 1], [4, 1], [4, 3], [0, 3]],
};

test("how much the photos showed", () => {
  const s = seenShare(box);
  assert.equal(s.walls, (2 + 4) / 14);           // east 2 of 3 m, north all 4 m; south and west unseen
  assert.ok(Math.abs(s.floor - 2 / 3) < 1e-9);
  assert.equal(seenShare({ walls: box.walls.map(({ seen, ...w }) => w) }), null);   // a known room
});

test("a spot on a wall or floor nobody saw", () => {
  assert.equal(spotUnseen(box, { at: [2, 0.45], wall: "south" }), "wall");
  assert.equal(spotUnseen(box, { at: [3.55, 2], wall: "east" }), null);
  assert.equal(spotUnseen(box, { at: [3.55, 0.5], wall: "east" }), "wall");
  assert.equal(spotUnseen(box, { at: [2, 2.5], wall: "north" }), null);
  assert.equal(spotUnseen(box, { at: [2, 0.5] }), "floor");
  assert.equal(spotUnseen({ walls: [] }, { at: [1, 1] }), null);
});
