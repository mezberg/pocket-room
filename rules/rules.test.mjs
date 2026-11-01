import { test } from "node:test";
import assert from "node:assert/strict";
import { place, analyse, outline, footprint, freeFloor, WALK_MIN, WALK_OK } from "./index.mjs";
import { corners, overlap, outside, doorwayRect, hitsSwing } from "./geom.mjs";
import { tiny, typical, crowded } from "./sample-rooms.mjs";
import { room as fixtureRoom, sofa as fixtureSofa } from "../server/fixtures.mjs";

const armchair = { id: "arm", category: "armchair", name: "Armchair", size: [0.8, 0.8, 0.9] };
const VERDICTS = ["Fits", "Just fits", "Doesn't fit"];

// Every spot place() returns must really be legal: inside, clear of furniture, doorways and swings.
function assertLegal(room, piece, spot) {
  const O = outline(room);
  const P = footprint(piece, spot.at, spot.rot);
  assert.ok(outside(O, P) <= 0.02, `spot ${spot.at} pokes out of the room`);
  for (const it of [...room.fixtures, ...room.furniture]) {
    if (it.id === spot.replaces || it.category === "rug" || (it.on_floor === false && it.category !== "radiator")) continue;
    assert.ok(overlap(footprint(it), P).depth <= 0.01, `spot ${spot.at} overlaps ${it.id}`);
  }
  for (const op of O.openings.filter((o) => o.passable)) {
    assert.ok(overlap(doorwayRect(op), P).depth <= 0.01, `spot ${spot.at} stands in ${op.id}`);
    assert.ok(!hitsSwing(op, P), `spot ${spot.at} is in ${op.id}'s swing`);
  }
  assert.ok(spot.clearance_m >= WALK_MIN);
  assert.equal(spot.verdict, spot.blocked ? "Just fits" : spot.clearance_m >= WALK_OK ? "Fits" : "Just fits");
  assert.ok(spot.score >= 0 && spot.score <= 1);
  assert.ok(spot.reasons.length >= 2);
}

function assertPlacementShape(p) {
  assert.ok(VERDICTS.includes(p.verdict));
  assert.equal(typeof p.say, "string");
  assert.ok(p.say.startsWith(p.verdict));
  assert.deepEqual(p.best, p.spots[0] ?? null);
  for (let i = 1; i < p.spots.length; i++) assert.ok(p.spots[i - 1].score >= p.spots[i].score, "spots best first");
}

function assertFindingShape(f) {
  assert.equal(f.kind, "model");
  assert.equal(typeof f.id, "string");
  assert.equal(typeof f.pass, "boolean");
  assert.ok(["info", "warn", "fail"].includes(f.severity));
  assert.equal(typeof f.say, "string");
  if (!f.pass) { assert.ok(Array.isArray(f.at) && f.at.length === 2); assert.ok(Array.isArray(f.items)); }
  if (f.fix) { assert.equal(typeof f.fix.item, "string"); assert.equal(f.fix.at.length, 2); }
}

const applyFix = (room, fix) => ({ ...room, furniture: room.furniture.map((f) => (f.id === fix.item ? { ...f, at: fix.at, rot: fix.rot ?? f.rot } : f)) });

test("geometry: footprints turn the right way and outlines face in", () => {
  const R = footprint({ size: [2, 1, 1] }, [0, 0], 90); // 2 m wide, facing east: long side runs north-south
  const xs = corners(R).map((c) => c[0]), ys = corners(R).map((c) => c[1]);
  assert.ok(Math.abs(Math.max(...xs) - 0.5) < 1e-9 && Math.abs(Math.max(...ys) - 1) < 1e-9);
  const O = outline(tiny());
  assert.deepEqual(O.walls[0].n.map((v) => Math.round(v) + 0), [0, 1]); // south wall faces north, into the room
  assert.ok(Math.abs(O.area - 1.6 * 2.3) < 1e-9);
  assert.ok(overlap(footprint({ size: [1, 1, 1] }, [0, 0], 0), footprint({ size: [1, 1, 1] }, [0.9, 0], 45)).depth > 0);
});

test("free floor: an empty room is all free, a furnished one less", () => {
  const empty = freeFloor(tiny());
  assert.ok(Math.abs(empty.floor_m2 - 1.6 * 2.3) < 0.1);
  assert.ok(empty.share > 0.97);
  const full = freeFloor(typical());
  assert.ok(full.share < 0.8 && full.share > 0.4);
});

test("tiny room: no findings but a pass; a 3-seat sofa doesn't fit, an armchair does", () => {
  const room = tiny();
  const { findings } = analyse(room);
  assert.deepEqual(findings.map((f) => f.id), ["walkways_ok"]);
  assert.equal(findings[0].pass, true);

  const s = place(room, fixtureSofa());
  assertPlacementShape(s);
  assert.equal(s.verdict, "Doesn't fit");
  assert.equal(s.best, null);

  const a = place(room, armchair);
  assertPlacementShape(a);
  assert.equal(a.verdict, "Fits");
  for (const spot of a.spots) assertLegal(room, armchair, spot);
  // Nothing in front of the door: the doorway runs x 0.1–0.85 along the south wall.
  assert.ok(a.spots.every((sp) => !(sp.wall === "south" && sp.at[0] < 0.85 + 0.4)));
});

test("typical room: everything passes and the fixture sofa fits", () => {
  const room = typical();
  const { findings } = analyse(room);
  assert.deepEqual(findings.map((f) => f.id), ["walkways_ok"]);
  const p = place(room, fixtureSofa());
  assertPlacementShape(p);
  assert.equal(p.verdict, "Fits");
  for (const spot of p.spots) assertLegal(room, fixtureSofa(), spot);
  assert.ok(p.spots.some((s) => s.replaces === "sofa"), "offers to swap the old sofa");
});

test("too tall for the ceiling never fits", () => {
  const p = place(typical(), { ...armchair, size: [0.8, 0.8, 2.6] });
  assert.equal(p.verdict, "Doesn't fit");
  assert.match(p.say, /taller than the ceiling/);
});

test("crowded room: every kind of model finding, with fixes that work", () => {
  const room = crowded();
  const { findings } = analyse(room);
  findings.forEach(assertFindingShape);
  const by = (id) => findings.filter((f) => f.id === id);

  const wall = by("through_wall");
  assert.equal(wall.length, 1);
  assert.deepEqual(wall[0].items, ["shelf"]);
  assert.ok(wall[0].fix);
  assert.ok(outside(outline(room), footprint(room.furniture.find((f) => f.id === "shelf"), wall[0].fix.at)) <= 0.01);

  const ov = by("overlap");
  assert.ok(ov.some((f) => f.items.includes("bedside_table") && f.items.includes("bed")));
  for (const f of ov.filter((f) => f.fix)) {
    const after = analyse(applyFix(room, f.fix)).findings.filter((g) => g.id === "overlap");
    assert.ok(!after.some((g) => g.items.join() === f.items.join()), `fix for ${f.items} clears it`);
  }

  const door = by("door_blocked");
  assert.equal(door.length, 1);
  assert.deepEqual(door[0].items, ["wardrobe"]);
  assert.match(door[0].say, /hits the wardrobe/);
  assert.ok(door[0].fix);
  assert.equal(analyse(applyFix(room, door[0].fix)).findings.filter((f) => f.id === "door_blocked").length, 0);

  const closed = by("path_blocked");
  assert.ok(closed.length >= 1);
  assert.ok(closed.some((f) => /left side of the bed/.test(f.say) && f.severity === "fail"));
  const tight = by("walkway_tight");
  assert.ok(tight.length >= 1 && tight.every((f) => f.severity === "warn" && f.width_m >= WALK_MIN && f.width_m < WALK_OK));
  // Between the bed and the wardrobe: the marker sits in that gap and names both.
  const gap = tight.find((f) => f.items.includes("wardrobe") && f.items.includes("bed"));
  assert.ok(gap && gap.at[0] > 1.7 && gap.at[0] < 2.38, `marker in the gap: ${gap?.at}`);
  assert.ok(!by("walkways_ok").length);

  assert.equal(place(room, fixtureSofa()).verdict, "Doesn't fit");
});

test("walkway fix: moving the piece the finding names opens the way to 75 cm", () => {
  // The typical room with the armchair pulled in near the door, 66 cm from the sofa.
  const room = typical();
  room.furniture.find((f) => f.id === "armchair").at = [2.0, 0.9];
  const { findings } = analyse(room);
  const f = findings.find((x) => x.id === "walkway_tight" && x.items.includes("armchair"));
  assert.ok(f, "the armchair squeezes a walkway");
  assert.ok(f.fix, "and there is a fix");
  assert.match(f.say, /Move the armchair \d+ cm/);
  const after = analyse(applyFix(room, f.fix)).findings;
  assert.ok(!after.some((x) => x.id === f.id && Math.hypot(x.at[0] - f.at[0], x.at[1] - f.at[1]) < 0.35), "that walkway is clear now");
  assert.ok(after.filter((x) => !x.pass).length <= findings.filter((x) => !x.pass).length, "and nothing new broke");
});

test("fixture living room: the sofa gets sensible spots, analyse finds real problems", () => {
  const room = fixtureRoom();
  const p = place(room, fixtureSofa());
  assertPlacementShape(p);
  assert.notEqual(p.verdict, "Doesn't fit");
  for (const spot of p.spots) assertLegal(room, fixtureSofa(), spot);
  // Best: the west wall where the old sofa is, facing east into the room.
  assert.equal(p.best.wall, "west");
  assert.equal(p.best.rot, 90);
  assert.equal(p.best.replaces, "sofa");

  const { findings } = analyse(room);
  findings.forEach(assertFindingShape);
  assert.ok(findings.length >= 2);
  assert.ok(findings.some((f) => f.id === "overlap" && f.items.includes("coffee_table")));
});

// --- the walls-only grid is kept per outline; place() and analyse() agree on ways already blocked ----------

test("a cached grid gives the same walkways as a fresh one", async () => {
  const { buildGrid, obstacles, routes } = await import("./grid.mjs");
  const { reachable } = await import("./grid.mjs");
  const room = fixtureRoom();
  const items = [...room.fixtures, ...room.furniture].filter(reachable);
  const O1 = outline(room), O2 = outline(room);   // two outline objects: the second builds its own shell
  const a = routes(buildGrid(O1, obstacles(room)), O1, items);
  buildGrid(O1, obstacles(room));                  // the shell again, from the cache
  const b = routes(buildGrid(O1, obstacles(room)), O1, items);
  const c = routes(buildGrid(O2, obstacles(room)), O2, items);
  assert.deepEqual(b.map((r) => r.width), a.map((r) => r.width));
  assert.deepEqual(c.map((r) => r.width), a.map((r) => r.width));
});

test("a spot beside a way that was already blocked is never a clean Fits, and the sentence says so", () => {
  const room = fixtureRoom();
  const p = place(room, fixtureSofa());
  assert.ok(p.best, "the fixture sofa has a spot");
  const blocked = p.spots.filter((s) => s.blocked);
  assert.ok(blocked.length, "the fixture flat has a way that was blocked before the sofa came");
  for (const s of blocked) {
    assert.equal(s.verdict, "Just fits");
    assert.equal(s.blocked.already, true);
    assert.ok(s.blocked.after_m < WALK_MIN);
    assert.ok(s.reasons.some((r) => /already blocked/.test(r)));
  }
  if (p.best.blocked) assert.match(p.say, /already blocked/);
  // and analyse() on the same room with the sofa in reports that way closed
  const r = { ...room, furniture: [...room.furniture.filter((f) => f.id !== p.best.replaces), { ...fixtureSofa(), id: "new", at: p.best.at, rot: p.best.rot, on_floor: true }] };
  if (p.best.blocked) assert.ok(analyse(r).findings.some((f) => f.id === "path_blocked"));
});

test("analyse is well under 2 s on the flat with a new sofa in", () => {
  const room = fixtureRoom();
  const p = place(room, fixtureSofa());
  const r = { ...room, furniture: [...room.furniture.filter((f) => f.id !== p.best.replaces), { ...fixtureSofa(), id: "new", at: p.best.at, rot: p.best.rot, on_floor: true }] };
  analyse(r);   // warm
  const t0 = performance.now();
  analyse(r);
  const ms = performance.now() - t0;
  assert.ok(ms < 2000, `analyse took ${Math.round(ms)} ms`);   // ~0.5 s alone; headroom for the full suite running in parallel
});

test("a coffee table in an L-shaped sectional's crook is not an overlap; through an ordinary sofa it is", () => {
  const room = typical();
  const sofa = room.furniture.find((f) => f.category === "sofa");
  const table = { id: "ct", name: "Coffee table", category: "table", size: [0.8, 0.5, 0.42], at: [sofa.at[0], sofa.at[1]], rot: 0 };
  const plain = { ...room, furniture: [...room.furniture, table] };
  assert.ok(analyse(plain).findings.some((f) => f.id === "overlap" && f.items.includes("ct")), "through a plain sofa");
  const crook = { ...plain, furniture: plain.furniture.map((f) => (f.id === sofa.id ? { ...f, name: "L-shaped sectional" } : f)) };
  assert.ok(!analyse(crook).findings.some((f) => f.id === "overlap" && f.items.includes("ct")), "in the sectional's crook");
});

test("a new floor lamp takes the old lamp's place, not a spot beside it", () => {
  const room = fixtureRoom();
  const old = room.furniture.find((f) => f.id === "floor_lamp");
  const p = place(room, { id: "new", name: "Floor lamp", category: "lamp", size: [0.35, 0.35, 1.55] });
  assert.equal(p.best.replaces, "floor_lamp");
  assert.ok(Math.hypot(p.best.at[0] - old.at[0], p.best.at[1] - old.at[1]) < 0.5);
});
