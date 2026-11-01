import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { roomFromReading, extentFrom, planExtents, resizeRoom } from "./build.mjs";
import { settle } from "./settle.mjs";
import { analyse } from "../../rules/check.mjs";
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
  assert.deepEqual(old.size, [1.2, 0.8, 0.74]);      // older readings: category defaults
});

// Zoopla living room, second run: "Low television unit" came with no height and was built 2 m tall, and the
// TV on it was pushed off it.
test("a low unit with no height read is low, a TV stays on its unit", () => {
  const o = (name, category, x, y) => ({ name, category, x, y, facing: "camera", length: null, depth: null, height: null, color: null, count: 1 });
  const room = roomFromReading(reading({ objects: [o("Low television unit", "cupboard", 0.5, 0.2), o("Television", "tv", 0.5, 0.2), o("Wardrobe", "cupboard", 0.9, 0.9)] }), { id: "t" });
  const [unit, tv, wardrobe] = room.furniture;
  assert.equal(unit.size[2], 0.5);
  assert.equal(wardrobe.size[2], 2);
  assert.equal(tv.on_floor, false);
  assert.deepEqual(tv.at, unit.at);
});

const BROKEN = new Set(["overlap", "door_blocked", "through_wall", "off_floor", "too_tall"]);
const broken = (room) => analyse(room).findings.filter((f) => !f.pass && BROKEN.has(f.id)).map((f) => f.say);
const obj = (name, category, x, y, len, extra = {}) => ({ name, category, x, y, facing: "camera", length: len ? m("door_width", len) : null, depth: null, height: null, color: null, count: 1, ...extra });

// Zoopla, Check my room on the rooms as built: "the sofa and the dining table overlap by 20 cm", "the kitchen
// run stands in the glazed door", a guessed 1.6 m dining table filling half a 3 m room. A room read from
// photos must be one that can exist: the rules find nothing physically impossible in it.
test("a built room passes the rules' overlap, door and wall checks", () => {
  const readings = [
    // living room: sofa along the left wall, a dining table with no length read at the near-left corner
    reading({ openings: [{ kind: "door", wall: "near", center: 0.8, width: m("door_width", 1), sill_frac: null, head_frac: null }],
      objects: [obj("Sofa", "sofa", 0.1, 0.65, 2.4, { facing: "right" }), obj("Dining table", "table", 0.15, 0.3, 0), obj("Chair", "chair", 0.25, 0.3, 0.55),
        obj("Coffee table", "table", 0.3, 0.62, 1.2), obj("Rug", "rug", 0.3, 0.6, 2.4), obj("Plant", "plant", 0.05, 0.35, 0)] }),
    // open plan: kitchen run on the right wall across a glazed door, an oven housing read at the same spot
    reading({ openings: [{ kind: "glazed_door", wall: "right", center: 0.5, width: m("door_width", 1.5), sill_frac: null, head_frac: null }],
      objects: [obj("Kitchen run", "cupboard", 0.95, 0.4, 4.5, { facing: "left", height: m("table_height", 1.2) }), obj("Oven housing", "cupboard", 0.95, 0.45, 0.75, { facing: "left" }),
        obj("Round table", "table", 0.8, 0.45, 1.1), obj("Media unit", "cupboard", 0.5, 0.95, 1.7, { height: m("chair_seat_height", 1) })] }),
  ];
  for (const r of readings) {
    const room = roomFromReading(r, { id: "t" });
    assert.deepEqual(checkRoom(room), []);
    assert.deepEqual(broken(room), [], JSON.stringify(room._derived.repairs) + JSON.stringify(room._derived.caveats));
    for (const said of room._derived.caveats.filter((c) => /left out/.test(c))) assert.match(said, /no short move clears it/);
  }
});

test("settle: the shorter step wins, pieces against a wall slide along it, guesses shrink before anything is left out", () => {
  const box = (id, w, l) => ({ id, walls: [
    { id: "south", a: [0, 0], b: [w, 0], openings: [] }, { id: "east", a: [w, 0], b: [w, l], openings: [] },
    { id: "north", a: [w, l], b: [0, l], openings: [] }, { id: "west", a: [0, l], b: [0, 0], openings: [] }], fixtures: [], furniture: [], height: 2.5 });
  // sofa along the west wall overlapping a table at the south wall: nudge the sofa north 16 cm, not the table 90 cm east
  const a = box("a", 3.032, 3.625);
  a.furniture = [{ id: "sofa", name: "Sofa", category: "sofa", at: [0.45, 2.465], size: [2, 0.9, 0.8], rot: 90 },
    { id: "table", name: "Table", category: "table", at: [0.537, 0.8], size: [1.6, 0.8, 0.74], rot: 90 }];
  const ra = settle(a);
  assert.deepEqual(a.furniture[1].at, [0.537, 0.8]);
  assert.match(ra.repairs[0], /^sofa moved (\d|1\d) cm/);   // under 20 cm
  // kitchen run and oven housing read at one spot on the east wall: neither leaves the wall
  const b = box("b", 5.25, 5);
  b.furniture = [{ id: "kitchen", name: "Kitchen run", category: "cupboard", at: [4.957, 1.845], size: [3.69, 0.585, 0.89], rot: 270 },
    { id: "oven", name: "Oven housing", category: "cupboard", at: [4.95, 2.1], size: [0.615, 0.6, 2.14], rot: 270 }];
  settle(b, new Set(["oven"]));
  for (const i of b.furniture) assert.ok(i.at[0] >= 4.94, `${i.id} left the wall`);
  assert.deepEqual(broken(b), []);
  // a guessed table too big for its corner shrinks first
  const c = box("c", 2.2, 2.2);
  c.furniture = [{ id: "bed", name: "Bed", category: "bed", at: [1.1, 1.2], size: [1.4, 2, 0.5], rot: 0 },
    { id: "table", name: "Table", category: "table", at: [1.1, 0.4], size: [1.2, 0.8, 0.74], rot: 0 }];
  const rc = settle(c, new Set(["table"]));
  assert.ok(rc.repairs.some((x) => /table shrunk/.test(x)) || rc.left_out.length, JSON.stringify(rc));
  assert.ok(c.furniture.some((i) => i.id === "bed"), "the measured bed stays");
  assert.deepEqual(broken(c), []);
});

// Zoopla open plan: the L-shaped sectional was one 2.5 x 2.2 m box, so the coffee table in its crook was
// "on top of" it and got left out.
test("an L-shaped sofa is two boxes, the chaise away from the coffee table in its crook", () => {
  const room = roomFromReading(reading({ objects: [
    obj("L-shaped sectional sofa", "sofa", 0.3, 0.7, 2.7, { facing: "camera", depth: m("door_width", 2.6) }),
    obj("Coffee table", "table", 0.4, 0.62, 1.2, { height: m("chair_seat_height", 0.9) }),
  ] }), { id: "t" });
  const by = Object.fromEntries(room.furniture.map((i) => [i.id, i]));
  assert.ok(by.l_shaped_sectional_sofa && by.l_shaped_sectional_sofa_chaise, Object.keys(by).join());
  assert.equal(by.l_shaped_sectional_sofa.size[1], 0.95);
  assert.ok(by.coffee_table, "the coffee table stays");
  assert.ok(by.l_shaped_sectional_sofa_chaise.at[0] < by.coffee_table.at[0], "chaise at the end away from the table");
  assert.deepEqual(broken(room), []);
});

// Zoopla open plan, third run: the reading put the entry door on the kitchen wall with the 3.7 m run reaching
// into it, and the oven housing on top of the run; both were left out. A fitted run ends at the door frame.
// The L-sofa was read 48 cm off the west wall: too close to walk past, too far to be off it.
test("a kitchen run is cut back to the door it runs into; a sofa a little off the wall goes back to it", () => {
  const box = (w, l, openings = {}) => ({ id: "t", height: 2.5, fixtures: [], furniture: [], walls: [
    { id: "south", a: [0, 0], b: [w, 0], openings: openings.south ?? [] }, { id: "east", a: [w, 0], b: [w, l], openings: openings.east ?? [] },
    { id: "north", a: [w, l], b: [0, l], openings: [] }, { id: "west", a: [0, l], b: [0, 0], openings: [] }] });
  const room = box(5.25, 5, { east: [{ id: "door_1", kind: "door", from: 3.6, width: 0.82, swing: null }] });
  room.furniture = [
    { id: "kitchen", name: "Kitchen run", category: "cupboard", at: [4.957, 2.3], size: [3.69, 0.585, 0.89], rot: 270 },
    { id: "oven", name: "Oven housing", category: "cupboard", at: [4.95, 0.6], size: [0.6, 0.6, 2.14], rot: 270 },
    { id: "sofa", name: "Sofa", category: "sofa", at: [0.93, 2.5], size: [2.3, 0.95, 0.8], rot: 90 },
  ];
  const { repairs, left_out } = settle(room, new Set());
  assert.deepEqual(left_out, []);
  const k = room.furniture.find((i) => i.id === "kitchen");
  assert.ok(k.size[0] < 3.69 && k.size[0] >= 2, `kitchen ${k.size[0]}`);
  assert.equal(k.at[0], 4.957, "still on the wall");
  assert.ok(repairs.some((r) => /kitchen cut \d+ cm shorter/.test(r)), repairs.join("; "));
  assert.deepEqual(broken(room), []);
  const sofa = room.furniture.find((i) => i.id === "sofa");
  assert.equal(sofa.at[0], 0.475, "back against the west wall");
});

// Zoopla open plan: the sofa was read 49 cm off the west wall in front of the bedroom opening (it can't go
// back to the wall there), so "no proper way from the door to the opening". At photo accuracy that's a misread.
// And with one photo the L-sofa's chaise end landed in a doorway and the whole sofa was left out.
test("a gap too narrow to walk is opened to 62 cm by a short move; a chaise in a doorway goes to the other end", () => {
  const box = (w, l, west = []) => ({ id: "t", height: 2.5, fixtures: [], furniture: [], walls: [
    { id: "south", a: [0, 0], b: [w, 0], openings: [] }, { id: "east", a: [w, 0], b: [w, l], openings: [] },
    { id: "north", a: [w, l], b: [0, l], openings: [] }, { id: "west", a: [0, l], b: [0, 0], openings: west }] });
  const a = box(5.9, 5.33, [{ id: "opening_1", kind: "opening", from: 0.947, width: 0.984 }]);
  a.furniture = [{ id: "sofa", name: "Sofa", category: "sofa", at: [0.965, 4.03], size: [2.6, 0.95, 0.8], rot: 90 }];
  const ra = settle(a);
  assert.equal(a.furniture[0].at[0], 1.095, ra.repairs.join("; "));
  assert.match(ra.repairs.join(";"), /sofa moved 13 cm to leave a 62 cm way by the west wall/);
  const b = box(3.3, 3.65, [{ id: "opening_1", kind: "opening", from: 2.4, width: 0.98 }]);
  b.furniture = [
    { id: "l_sofa", name: "L-shaped sofa", category: "sofa", at: [1.6, 3.175], size: [2.3, 0.95, 0.8], rot: 180 },
    { id: "l_sofa_chaise", name: "L-shaped sofa (chaise end)", category: "sofa", at: [0.475, 2.125], size: [0.95, 1.15, 0.8], rot: 180 },
  ];
  b.walls[3].openings = [{ id: "opening_1", kind: "opening", from: 1.2, width: 0.98 }];   // y 1.47..2.45 on the west wall
  const rb = settle(b);
  assert.equal(b.furniture.length, 2, rb.left_out.join("; "));
  assert.ok(b.furniture[1].at[0] > 1.6, "chaise at the east end");
  assert.deepEqual(broken(b), []);
});

// Zoopla open plan, fifth run: the measured sectional stood across the bedroom opening and was left out.
test("a measured sofa across an opening stays; the opening slides along its wall", () => {
  const room = { id: "t", height: 2.5, fixtures: [], furniture: [], walls: [
    { id: "south", a: [0, 0], b: [5, 0], openings: [] }, { id: "east", a: [5, 0], b: [5, 5], openings: [] },
    { id: "north", a: [5, 5], b: [0, 5], openings: [] },
    { id: "west", a: [0, 5], b: [0, 0], openings: [{ id: "opening_1", kind: "opening", from: 1.4, width: 0.98 }] }] };
  room.furniture = [{ id: "sofa", name: "Sofa", category: "sofa", at: [0.475, 2.0], size: [3.0, 0.95, 0.8], rot: 90 }];
  const { repairs, left_out } = settle(room);
  assert.deepEqual(left_out, []);
  assert.equal(room.furniture.length, 1);
  assert.match(repairs.join(";"), /opening_1 moved \d+ cm along its wall/);
  assert.deepEqual(broken(room), []);
});
