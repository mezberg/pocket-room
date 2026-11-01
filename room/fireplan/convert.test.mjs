import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { roomFromPlan, doorScale, simplify } from "./convert.mjs";
import { checkRoom } from "../schema-check.mjs";

// Pipeline output for a London estate-agent plan with printed sizes (bedroom 3.67 x 3.45, bedroom 4.82 x 3.00)
const load = (f) => JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url)));
const graph = load("sample.graph.json"), rings = load("sample.rooms.json");

test("scale from the median door, honest error", () => {
  const s = doorScale(graph);
  assert.equal(s.doors, 19);
  assert.ok(s.px_per_m > 35 && s.px_per_m < 45);
});

test("simplify drops trace jitter, keeps corners", () => {
  assert.deepEqual(simplify([[0, 0], [50, 1], [100, 0], [100, 100], [0, 100], [0, 0]]), [[0, 0], [100, 0], [100, 100], [0, 100]]);
});

test("a bedroom comes out near its printed size, valid, CCW, doors on its walls", () => {
  const room = roomFromPlan(graph, rings, { room: "r3", id: "t" });
  assert.deepEqual(checkRoom(room), []);
  assert.equal(room.source, "floorplan");
  const [w, l] = room._derived.box_m;
  assert.ok(Math.abs(w - 3.67) < 0.4 && Math.abs(l - 3.45) < 0.4, `${w} x ${l}`);
  room.walls.forEach((x, i) => assert.deepEqual(x.b, room.walls[(i + 1) % room.walls.length].a));
  const doors = room.walls.flatMap((x) => x.openings);
  assert.ok(doors.length >= 1);
  for (const x of room.walls) {
    const len = Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]);
    for (const o of x.openings) assert.ok(o.from >= 0 && o.from + o.width <= len + 1e-9);
  }
  assert.ok(room.accuracy_m > 0.15, "door-scaled plans are about ±10%");
});

test("no doubled openings; given px_per_m wins", () => {
  const room = roomFromPlan(graph, rings, { room: "r2", px_per_m: 40 });
  for (const w of room.walls) {
    const keys = w.openings.map((o) => `${o.from}+${o.width}`);
    assert.equal(new Set(keys).size, keys.length, w.id);
  }
  assert.equal(room.accuracy_m, 0.05);
  assert.match(room._derived.scale, /given/);
});
