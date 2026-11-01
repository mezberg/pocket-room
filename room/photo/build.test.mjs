import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { roomFromReading, extentFrom } from "./build.mjs";
import { checkRoom } from "../schema-check.mjs";

// A real gpt-6.1-terra reading of room/venue/venue-chesterfields-2026-11-01.jpg
const venue = JSON.parse(readFileSync(new URL("./fixtures/venue-chesterfields.reading.json", import.meta.url)));
const m = (ref, multiples) => ({ ref, multiples, note: "" });
const reading = (over = {}) => ({
  room_type: "living room",
  width: { seen_fraction: 1, measures: [m("door_width", 5), m("chair_width", 9), m("floor_tile", 7)] },   // 4.1, 4.05, 4.2
  depth: { seen_fraction: 0.5, measures: [m("door_width", 3)] },                                         // 2.46 seen -> 4.92
  height: { seen_fraction: 1, measures: [m("door_height", 1.2)] },
  openings: [
    { kind: "door", wall: "far", center: 0.25, width: m("door_width", 1), sill_frac: null, head_frac: null },
    { kind: "window", wall: "right", center: 0.5, width: m("door_width", 2), sill_frac: 0.35, head_frac: 0.85 },
  ],
  objects: [
    { name: "Sofa", category: "sofa", x: 0.0, y: 0.5, facing: "right", length: m("three_seat_sofa_length", 1), count: 1 },
    { name: "Column", category: "column", x: 0.5, y: 0.5, facing: "camera", length: null, count: 1 },
  ],
  style: { tags: ["warm"], colors: ["#aa3322", "red"] },
  caveats: [],
  ...over,
});

test("extents: median of the readings, scaled by the share seen; code holds the metres", () => {
  assert.equal(extentFrom(reading().width, "width").m, 4.1);
  assert.ok(Math.abs(extentFrom(reading().depth, "depth").m - 4.92) < 1e-9);
  assert.equal(extentFrom({ measures: [] }, "height").m, 2.4);           // nothing read -> default
  assert.equal(extentFrom(reading().width, "width", 5.2).m, 5.2);        // measured by hand wins
  assert.equal(extentFrom({ seen_fraction: 1, measures: [m("door_width", 500)] }, "width").m, 40);   // clamped
});

test("a box room with openings on the right walls and furniture inside it", () => {
  const room = roomFromReading(reading(), { id: "t" });
  assert.deepEqual(checkRoom(room), []);
  assert.equal(room.source, "photo");
  assert.equal(room.accuracy_m, 1.23);               // half the depth was out of frame
  const full = roomFromReading(reading({ depth: { seen_fraction: 1, measures: [m("door_width", 6)] } }));
  assert.equal(full.accuracy_m, 0.15);              // wall to wall: the usual photo error
  const known = roomFromReading(reading(), { known: { width_m: 4, depth_m: 5 } });
  assert.equal(known.accuracy_m, 0.05);
  const [s, e, n, w] = room.walls;
  assert.deepEqual([s.id, e.id, n.id, w.id], ["south", "east", "north", "west"]);
  assert.deepEqual(n.a, [4.1, 4.92]);
  // far-wall door centred a quarter from the left = 3/4 along from the north wall's a end (east)
  assert.ok(Math.abs(n.openings[0].from + 0.41 - 0.75 * 4.1) < 0.002);
  assert.equal(n.openings[0].swing, null);
  const win = e.openings[0];
  assert.equal(win.sill, 0.857);
  assert.equal(win.head, 2.081);
  const sofa = room.furniture.find((f) => f.id === "sofa");
  assert.equal(sofa.rot, 90);
  assert.equal(sofa.at[0], 0.45);                       // pushed off the west wall by half its depth
  assert.equal(room.fixtures[0].category, "column");
  assert.equal(room.fixtures[0].size[2], room.height);  // floor to ceiling
  assert.deepEqual(room.style.colors, ["#aa3322"]);
});

test("the venue reading builds a usable room", () => {
  const room = roomFromReading(venue, { id: "venue" });
  assert.deepEqual(checkRoom(room), []);
  const [s, e] = room.walls;
  const W = s.b[0], L = e.b[1];
  assert.ok(W > 4 && W < 20 && L > 4 && L < 20 && room.height > 2.5 && room.height < 8, `${W} x ${L} x ${room.height}`);
  assert.ok(room.walls.some((x) => x.openings.length));
  assert.ok(room.furniture.some((f) => f.category === "sofa" || f.category === "armchair"));
  for (const f of room.furniture) assert.ok(f.at[0] >= 0 && f.at[0] <= W && f.at[1] >= 0 && f.at[1] <= L, f.id);
});
