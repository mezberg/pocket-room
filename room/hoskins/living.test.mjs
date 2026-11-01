import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { livingRoom } from "./living.mjs";
import { checkRoom } from "../schema-check.mjs";

const fixture = JSON.parse(readFileSync(new URL("../../contract/fixtures/hoskins-living-room.room.json", import.meta.url)));
const room = livingRoom();
const area = (pts) => pts.reduce((s, [x, y], i) => { const [u, v] = pts[(i + 1) % pts.length]; return s + x * v - u * y; }, 0) / 2;
const inside = ([x, y], pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

test("the fixture is the current export (run node room/hoskins/export.mjs)", () => {
  assert.deepEqual(fixture, JSON.parse(JSON.stringify(room)));
});

test("matches room.schema.json", () => assert.deepEqual(checkRoom(room), []));

test("walls close, run counter-clockwise, and measure 3.44 x 6.74 m as drawn", () => {
  room.walls.forEach((w, i) => assert.deepEqual(w.b, room.walls[(i + 1) % room.walls.length].a, w.id));
  const pts = room.walls.map((w) => w.a);
  assert.ok(area(pts) > 0, "CCW");
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 3.44) < 0.01);
  assert.ok(Math.abs(Math.max(...ys) - Math.min(...ys) - 6.74) < 0.01);
});

test("keeps the ids the approximate fixture had", () => {
  const ids = new Set([...room.walls, ...room.fixtures, ...room.furniture, ...room.lights].map((x) => x.id));
  room.walls.forEach((w) => w.openings.forEach((o) => ids.add(o.id)));
  for (const id of ["south", "east", "north", "west", "balcony_door", "glazing", "hall_door", "living_room_heater",
    "built-in_cupboards", "sofa", "coffee_table", "tv_bench", "dining_table", "dining_chair_1", "dining_chair_4", "desk",
    "office_chair", "clothes_airer", "ladder_bookshelf", "floor_lamp", "side_table", "bamboo", "fern", "ficus",
    "storage_box_and_cushion", "dining_pendant", "living_pendant"]) assert.ok(ids.has(id), id);
});

test("everything stands inside the walls, openings fit their walls", () => {
  const pts = room.walls.map((w) => w.a);
  for (const f of [...room.fixtures, ...room.furniture]) assert.ok(inside(f.at, pts), f.id);
  for (const w of room.walls) {
    const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    for (const o of w.openings) assert.ok(o.from >= 0 && o.from + o.width <= len + 1e-9, `${w.id}/${o.id}`);
  }
});

test("true facing: sofa faces east off the west wall, TV bench faces west, chairs face the table", () => {
  const f = Object.fromEntries(room.furniture.map((x) => [x.id, x]));
  assert.equal(f.sofa.rot, 90);
  assert.equal(f.tv_bench.rot, 270);
  assert.equal(f.desk.rot, 180);
  for (let n = 1; n <= 4; n++) {
    const c = f[`dining_chair_${n}`], t = f.dining_table.at;
    const a = (c.rot * Math.PI) / 180, front = [Math.sin(a), -Math.cos(a)];   // rot 0 = faces -y
    const to = [t[0] - c.at[0], t[1] - c.at[1]], d = Math.hypot(...to);
    assert.ok((front[0] * to[0] + front[1] * to[1]) / d > 0.99, `chair ${n}`);
  }
  const door = room.walls.find((w) => w.id === "north").openings[0];
  assert.deepEqual(door.swing, { hinge: "b", into: true });   // hinge at the west end, opens into the room
});
