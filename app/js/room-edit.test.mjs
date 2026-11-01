// New-room edits: resize in code, remove an object, typed lengths, how sure.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resizeRoom, removeItem, parseLength, feetInches, plusMinus, sureWords, dims, accuracyOf, bothMeasured } from "./room-edit.js";
import { roomFromReading } from "../../room/photo/build.mjs";
import { checkRoom } from "../../room/schema-check.mjs";
import { place, analyse } from "../../rules/index.mjs";

// the venue room as the photo route builds it (a real reading of room/venue/venue-chesterfields-2026-11-01.jpg)
const reading = JSON.parse(readFileSync(new URL("../../room/photo/fixtures/venue-chesterfields.reading.json", import.meta.url)));
const venue = roomFromReading(reading, { id: "photo-test", name: "Venue" });
const sofa = JSON.parse(readFileSync(new URL("../../contract/fixtures/sofa-84.piece.json", import.meta.url)));

test("resize: walls to the new size, openings keep their width and stay on their wall", () => {
  const r = resizeRoom(venue, { width: 8, depth: 6, height: 3.5 });
  assert.deepEqual(dims(r), { width: 8, depth: 6, height: 3.5 });
  assert.deepEqual(checkRoom(r), []);
  for (const [i, w] of r.walls.entries()) {
    const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);
    for (const [j, o] of w.openings.entries()) {
      assert.equal(o.width, Math.min(venue.walls[i].openings[j].width, L));
      assert.ok(o.from >= 0 && o.from + o.width <= L + 1e-6, `${o.id} on ${w.id}`);
      assert.ok((o.head ?? 0) <= 3.5);
    }
  }
});

test("resize: furniture keeps its size and stays inside; columns stay floor to ceiling", () => {
  const r = resizeRoom(venue, { width: 5, depth: 4, height: 3 });
  for (const it of [...r.furniture, ...r.fixtures]) {
    const quarter = Math.round(it.rot / 90) % 2 !== 0;
    const [fx, fy] = quarter ? [it.size[1], it.size[0]] : [it.size[0], it.size[1]];
    if (fx <= 5) assert.ok(it.at[0] - fx / 2 >= -1e-6 && it.at[0] + fx / 2 <= 5 + 1e-6, `${it.id} x`);
    if (fy <= 4) assert.ok(it.at[1] - fy / 2 >= -1e-6 && it.at[1] + fy / 2 <= 4 + 1e-6, `${it.id} y`);
  }
  for (const c of r.fixtures.filter((f) => f.category === "column")) assert.equal(c.size[2], 3);
  const before = venue.furniture.find((f) => f.category === "sofa"), after = r.furniture.find((f) => f.id === before.id);
  assert.deepEqual(after.size, before.size);
});

test("resize: out-of-range sizes are clamped; the input room is untouched", () => {
  const copy = structuredClone(venue);
  const r = resizeRoom(venue, { width: 0.2, depth: 99, height: 1 });
  assert.deepEqual(dims(r), { width: 1.5, depth: 40, height: 2.1 });
  assert.deepEqual(venue, copy);
});

test("accuracy: adjusting keeps it, measuring both walls makes it ±5 cm", () => {
  const was = venue.accuracy_m;
  assert.ok(was > 1, "one photo of one wall is rough");
  assert.equal(resizeRoom(venue, { width: 9 }).accuracy_m, was);
  const oneMeasured = resizeRoom(venue, { width: 9.4 }, { measured: ["width"] });
  assert.equal(oneMeasured.accuracy_m, venue._derived.depth.err);
  const both = resizeRoom(venue, { width: 9.4, depth: 6.2 }, { measured: ["width", "depth"] });
  assert.equal(both.accuracy_m, 0.05);
  assert.equal(accuracyOf(both), 0.05);
  assert.equal(both._derived.width.from[0], "measured");
  assert.ok(bothMeasured(both));
  const untaped = resizeRoom(both, {}, { measured: [] });
  assert.equal(untaped.accuracy_m, was, "taking the tick off gives the photo's own error back");
  assert.ok(!bothMeasured(untaped));
});

test("remove: a wrong object goes, the rest stays", () => {
  const id = venue.furniture[0].id;
  const r = removeItem(venue, id);
  assert.equal(r.furniture.length, venue.furniture.length - 1);
  assert.ok(!r.furniture.some((f) => f.id === id));
  const col = venue.fixtures[0]?.id;
  if (col) assert.equal(removeItem(venue, col).fixtures.length, venue.fixtures.length - 1);
});

test("a resized photo room still places and analyses (lane D rules)", () => {
  const r = resizeRoom(venue, { width: 9, depth: 6.5 });
  const p = place(r, sofa);
  assert.ok(["Fits", "Just fits", "Doesn't fit"].includes(p.verdict));
  assert.ok(Array.isArray(analyse(r).findings));
});

test("typed lengths: metres, cm, feet and inches", () => {
  assert.equal(parseLength("4.2"), 4.2);
  assert.equal(parseLength("4,2"), 4.2);
  assert.equal(parseLength("420cm"), 4.2);
  assert.equal(parseLength("4200 mm"), 4.2);
  assert.equal(parseLength("13", "ft"), 3.962);
  assert.equal(parseLength("13' 6\""), 4.115);
  assert.equal(parseLength("13ft 6in", "m"), 4.115);
  assert.equal(parseLength("13 6", "ft"), 4.115);
  assert.equal(parseLength("13 14", "ft"), null);
  assert.equal(parseLength(""), null);
  assert.equal(parseLength("wide"), null);
  assert.equal(parseLength("0"), null);
});

test("words: ft/in, plus-minus, how sure", () => {
  assert.equal(feetInches(4.115), "13′6″");
  assert.equal(plusMinus(0.15), "± 15 cm");
  assert.equal(plusMinus(3.04), "± 3 m");
  assert.equal(plusMinus(1.26), "± 1.3 m");
  assert.equal(sureWords({ accuracy_m: 0.15, source: "photo" }).level, "good");
  assert.equal(sureWords({ accuracy_m: 0.4, source: "photo" }).level, "ok");
  const rough = sureWords({ accuracy_m: 3, source: "photo" });
  assert.equal(rough.level, "rough");
  assert.match(rough.nudge, /Measure two walls/);
});
