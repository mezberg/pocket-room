import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { roomFromReading, extentFrom, planExtents, resizeRoom, separate } from "./build.mjs";
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

const p = (photo, ref, multiples, span_fraction = 1) => ({ photo, span_fraction, ref, multiples, note: "" });

test("several photos: each photo gives its own value, the room takes their median", () => {
  const e = { seen_fraction: 1, measures: [
    p(1, "door_width", 5), p(1, "chair_width", 9),   // 4.10, 4.05 -> 4.075
    p(2, "floor_tile", 7),                           // 4.2
    p(3, "door_width", 2.5, 0.5),                    // 2.05 of half the wall -> 4.1
  ] };
  const x = extentFrom(e, "width");
  assert.deepEqual(x.photos, [4.075, 4.2, 4.1]);
  assert.equal(x.m, 4.1);
  assert.ok(x.err >= 0.1 && x.err < 0.15, `err ${x.err}`);   // photos agree within ~6 cm
  // a photo that disagrees widens the error
  const off = extentFrom({ seen_fraction: 1, measures: [...e.measures, p(4, "door_width", 7)] }, "width");
  assert.ok(off.err > x.err);
});

test("one measured wall scales the other by the photo's proportions", () => {
  const r = reading({ depth: { seen_fraction: 1, measures: [m("door_width", 6)] } });   // 4.1 x 4.92 read
  const { W, L } = planExtents(r, { width_m: 3.28 });                                    // the real width is 80%
  assert.equal(W.m, 3.28);
  assert.ok(Math.abs(L.m - 4.92 * 0.8) < 1e-9);
  const both = planExtents(r, { width_m: 3, depth_m: 4 });
  assert.deepEqual([both.W.m, both.L.m], [3, 4]);
});

test("resizeRoom stretches walls, keeps opening widths and keeps furniture inside", () => {
  const room = roomFromReading(reading(), { id: "t" });
  const out = resizeRoom(room, { width_m: 5, depth_m: 6 });
  assert.deepEqual(checkRoom(out), []);
  assert.equal(out.accuracy_m, 0.05);
  const n = out.walls.find((w) => w.id === "north");
  assert.deepEqual(n.a, [5, 6]);
  const d0 = room.walls.find((w) => w.id === "north").openings[0], d1 = n.openings[0];
  assert.equal(d1.width, d0.width);
  assert.ok(Math.abs((d1.from + d1.width / 2) / 5 - (d0.from + d0.width / 2) / 4.1) < 0.002);   // same share along
  for (const f of out.furniture) assert.ok(f.at[0] > 0 && f.at[0] < 5 && f.at[1] > 0 && f.at[1] < 6);
  const one = resizeRoom(room, { width_m: 5 });
  assert.equal(one.walls.find((w) => w.id === "north").a[1], room.walls.find((w) => w.id === "north").a[1]);
  assert.ok(one.accuracy_m < room.accuracy_m);
  assert.equal(resizeRoom(room, { height_m: 3 }).fixtures[0].size[2], 3);   // columns stay floor to ceiling
});

test("what the photos showed: seen wall spans and floor; the rest is marked, not made up", () => {
  const seen = { floor: { left: 0.2, right: 1, near: 0.3, far: 1 }, walls: [{ wall: "far", from: 0.2, to: 1 }, { wall: "right", from: 0.3, to: 1 }] };
  const room = roomFromReading(reading({ seen, depth: { seen_fraction: 1, measures: [m("door_width", 6)] } }), { id: "t" });
  assert.deepEqual(checkRoom(room), []);
  const by = Object.fromEntries(room.walls.map((x) => [x.id, x]));
  // far wall = north, a at the east end: seen from the right end to 20% from the left (0 .. 3.28 m from a),
  // and its door (2.665 .. 3.485) was seen too, so the span runs on to the door's far edge
  assert.deepEqual(by.north.seen, [[0, 3.485]]);
  assert.deepEqual(by.east.seen, [[1.476, 4.92]]);   // right wall: from 30% of the way to the far end
  assert.deepEqual(by.south.seen, []);               // behind the camera: nobody saw it
  assert.deepEqual(by.west.seen, []);
  assert.deepEqual(room.floor_seen, [[0.82, 1.476], [4.1, 1.476], [4.1, 4.92], [0.82, 4.92]]);
});

test("an older reading without `seen` falls back to the seen fractions", () => {
  const room = roomFromReading(venue, { id: "v" });
  assert.deepEqual(checkRoom(room), []);
  const by = Object.fromEntries(room.walls.map((x) => [x.id, x]));
  assert.ok(by.north.seen.length >= 1);              // the far wall, partly
  assert.deepEqual(by.south.seen, []);
  assert.equal(room.floor_seen.length, 4);
});

test("resizeRoom carries what was seen along", () => {
  const seen = { floor: { left: 0, right: 0.5, near: 0, far: 1 }, walls: [{ wall: "far", from: 0, to: 0.5 }] };
  const room = roomFromReading(reading({ seen, openings: [] }), { id: "t" });
  const out = resizeRoom(room, { width_m: 8.2 });
  assert.deepEqual(out.walls.find((x) => x.id === "north").seen, [[4.1, 8.2]]);
  assert.equal(out.floor_seen[1][0], 4.1);
});

// Zoopla test (2026-11-01, docs/test-inputs/zoopla): one photo read a coffee table against table_height,
// so one width reading was 5.55 m against 2.9 and 3.1; the room's error came out 1.3 m.
test("a reading far from the others is dropped, and says so", () => {
  const e = { seen_fraction: 1, measures: [m("three_seat_sofa_length", 1.45), m("door_width", 3.8), m("table_height", 7.5)] };
  const x = extentFrom(e, "width");
  assert.equal(x.m, (2.9 + 3.116) / 2);
  assert.ok(x.err < 0.2, `err ${x.err}`);
  assert.match(x.from[2], /dropped/);
  // two readings that disagree are both kept: nothing says which one is wrong
  assert.equal(extentFrom({ seen_fraction: 1, measures: [m("door_width", 4), m("door_width", 8)] }, "width").m, (3.28 + 6.56) / 2);
});

test("objects keep their colour, depth and height (a low TV unit is not 2 m tall)", () => {
  const room = roomFromReading(reading({ objects: [
    { name: "Red chesterfield", category: "sofa", x: 0.5, y: 0.3, facing: "camera", length: m("three_seat_sofa_length", 1), depth: null, height: null, color: "#7D2027", count: 1 },
    { name: "Low media cabinet", category: "cupboard", x: 0.5, y: 0.9, facing: "camera", length: m("door_width", 2), depth: m("chair_width", 1), height: m("chair_seat_height", 1.1), color: "white", count: 1 },
    { name: "Old reading", category: "table", x: 0.2, y: 0.6, facing: "camera", length: null, count: 1 },
  ] }), { id: "t" });
  assert.deepEqual(checkRoom(room), []);
  const [sofa, cab, old] = room.furniture;
  assert.equal(sofa.color, "#7d2027");
  assert.deepEqual(cab.size, [1.64, 0.45, 0.495]);
  assert.equal(cab.color, undefined);                // not a hex: left out, the app picks one
  assert.deepEqual(old.size, [1.6, 0.8, 0.74]);      // older readings: category defaults
});

test("pieces read on top of each other are pushed apart, inside the walls; chairs may tuck under tables", () => {
  const o = (name, category, x, y, len, extra = {}) => ({ name, category, x, y, facing: "camera", length: m("door_width", len), depth: null, height: null, color: null, count: 1, ...extra });
  const room = roomFromReading(reading({ objects: [
    o("Sofa", "sofa", 0.3, 0.5, 2.4), o("Coffee table", "table", 0.3, 0.55, 1.2),
    o("Dining table", "table", 0.8, 0.2, 1.5), o("Chair", "chair", 0.8, 0.2, 0.55), o("Rug", "rug", 0.3, 0.5, 2.4),
  ] }), { id: "t" });
  const by = Object.fromEntries(room.furniture.map((i) => [i.id, i]));
  const box = (i) => [i.at[0] - i.size[0] / 2, i.at[1] - i.size[1] / 2, i.at[0] + i.size[0] / 2, i.at[1] + i.size[1] / 2];
  const overlap = (a, b) => { const p = box(a), q = box(b); return Math.min(p[2], q[2]) > Math.max(p[0], q[0]) + 1e-6 && Math.min(p[3], q[3]) > Math.max(p[1], q[1]) + 1e-6; };
  assert.ok(!overlap(by.sofa, by.coffee_table), "sofa and coffee table apart");
  assert.ok(overlap(by.dining_table, by.chair), "the chair stays tucked in");
  assert.ok(overlap(by.rug, by.sofa), "the rug stays under the sofa");
  const [w, l] = [room.walls[0].b[0], room.walls[1].b[1]];
  for (const i of room.furniture) { const b = box(i); assert.ok(b[0] >= -1e-6 && b[1] >= -1e-6 && b[2] <= w + 1e-6 && b[3] <= l + 1e-6, i.id); }
  assert.match(room._derived.moved.join(";"), /(coffee_table|sofa) moved \d+ cm off the (sofa|coffee_table)/);
});

// Zoopla living room: the table sat against the south wall, the sofa along the west wall overlapped it by
// 14 cm. Pushing the table out sideways took 91 cm; nudging the sofa north takes 16.
test("the shorter step wins, whichever piece it moves", () => {
  const items = [
    { id: "sofa", category: "sofa", at: [0.476, 2.465], size: [2, 0.9, 0.8], rot: 90 },
    { id: "table", category: "table", at: [0.537, 0.8], size: [1.6, 0.8, 0.74], rot: 90 },
  ];
  const moved = separate(items, 3.032, 3.625);
  assert.deepEqual(moved, ["sofa moved 16 cm off the table"]);
  assert.deepEqual(items[1].at, [0.537, 0.8]);
});
