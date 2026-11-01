import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { flat } from "./flat.mjs";
import { walls } from "./build.mjs";
import { checkRoom } from "../schema-check.mjs";

const area = (pts) => pts.reduce((s, [x, y], i) => { const [u, v] = pts[(i + 1) % pts.length]; return s + x * v - u * y; }, 0) / 2;
const inside = ([x, y], pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

for (const room of flat()) {
  test(`${room.id}: written, valid, closed, CCW, contents inside, openings fit`, () => {
    const file = JSON.parse(readFileSync(new URL(`./rooms/${room.id}.room.json`, import.meta.url)));
    assert.deepEqual(file, JSON.parse(JSON.stringify(room)), "run node room/hoskins/export.mjs");
    assert.deepEqual(checkRoom(room), []);
    room.walls.forEach((w, i) => assert.deepEqual(w.b, room.walls[(i + 1) % room.walls.length].a, w.id));
    const pts = room.walls.map((w) => w.a);
    assert.ok(area(pts) > 0);
    for (const f of [...room.fixtures, ...room.furniture]) assert.ok(inside(f.at, pts), f.id);
    for (const w of room.walls) {
      const len = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
      for (const o of w.openings) assert.ok(o.from >= 0 && o.from + o.width <= len + 1e-9, `${w.id}/${o.id}`);
    }
  });
}

test("printed sizes: kitchen 2.2 x 3.1, bedroom 2.6 x 4.8 (wall centres) within the plan's tolerance", () => {
  const box = (id) => {
    const pts = flat().find((r) => r.id === id).walls.map((w) => w.a);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
  };
  const [kw, kl] = box("hoskins-kitchen");
  assert.ok(Math.abs(kw - 2.19) < 0.02 && Math.abs(kl - 3.11) < 0.02, `${kw} x ${kl}`);
  const [bw, bl] = box("hoskins-bedroom");
  assert.ok(Math.abs(bw - 2.59) < 0.02 && Math.abs(bl - 4.83) < 0.03, `${bw} x ${bl}`);
});

test("door hinge is the opening's end towards wall end a or b, not the nearest wall end", () => {
  // a long wall from py 1800 (a) to 1044 (b); a door near b, hinged on its end towards a
  const [w] = walls([[258, 1800], [258, 1044], [0, 0]], ["p", "x", "y"], {
    p: [{ id: "d", kind: "door", span: [1095, 1205], hingePx: 1205, into: true }],
  });
  assert.deepEqual(w.openings[0].swing, { hinge: "a", into: true });
});
