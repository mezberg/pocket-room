// The shared room store and the routes that read it (rooms, place/analyse). No network: lane E's hook is faked.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { getRoom, saveRoom, listRooms, resolveRoom, _reset } from "./rooms-store.mjs";
import { placeRouter } from "./routes/place.mjs";
import rooms from "./routes/rooms.mjs";
import { room as fixture, sofa } from "./fixtures.mjs";
import { typical } from "../rules/sample-rooms.mjs";

const box = (id, w, d) => ({
  id, name: `Box ${id}`, source: "photo", height: 2.5, accuracy_m: 0.15,
  walls: [
    { id: "south", a: [0, 0], b: [w, 0], openings: [{ id: "door", kind: "door", from: 0.2, width: 0.8 }] },
    { id: "east", a: [w, 0], b: [w, d], openings: [] },
    { id: "north", a: [w, d], b: [0, d], openings: [] },
    { id: "west", a: [0, d], b: [0, 0], openings: [] },
  ],
  fixtures: [], furniture: [],
});

beforeEach(() => _reset());

test("store: prebuilt Hoskins rooms, copies not references", () => {
  const a = getRoom("hoskins-living");
  assert.deepEqual(a, fixture());
  a.furniture = [];
  assert.ok(getRoom("hoskins-living").furniture.length > 0, "a caller can't change the stored room");
  assert.ok(listRooms().some((r) => r.id === "hoskins-bedroom"));
  assert.equal(getRoom("nope"), null);
});

test("store: a room built this session is served by id", () => {
  saveRoom(box("photo-1", 4, 3));
  assert.equal(getRoom("photo-1").walls.length, 4);
  assert.ok(listRooms().some((r) => r.id === "photo-1" && r.source === "photo"));
});

test("resolveRoom: body room wins, then the store, then D's samples; unknown id is null", () => {
  saveRoom(box("photo-2", 5, 4));
  const own = box("unsaved", 2, 2);
  assert.equal(resolveRoom({ room: own, roomId: "photo-2" }).id, "unsaved");
  assert.equal(resolveRoom({ roomId: "photo-2" }).id, "photo-2");
  assert.deepEqual(resolveRoom({ roomId: "typical" }), typical());
  assert.equal(resolveRoom({}).id, "hoskins-living");
  assert.equal(resolveRoom({ roomId: "missing" }), null);
});

// ---- routes on the store ------------------------------------------------------------------------------
let server, base;
const calls = [];
const fakeE = {
  choose: async (room, piece, placement) => { calls.push({ kind: "choose", room: room.id }); return { ...placement, chosen: true }; },
  design: async (room, findings, ctx) => { calls.push({ kind: "design", room: room.id, ctx }); return [{ id: "style", kind: "design", pass: true, severity: "info", probability: 0.8, say: "ok" }]; },
};
before(async () => {
  const app = express();
  app.use(express.json({ limit: "5mb" }));
  app.use("/api/rooms", rooms);
  app.use("/api", placeRouter(fakeE));
  await new Promise((ok) => (server = app.listen(0, ok)));
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());
const post = (path, body) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("/place resolves roomId through the store (not the fixture) and calls lane E's choose", async () => {
  saveRoom(box("photo-3", 4, 3.5));
  calls.length = 0;
  const res = await post("/place", { roomId: "photo-3", piece: { category: "sofa", size: [2, 0.9, 0.8] } });
  assert.equal(res.status, 200);
  const p = await res.json();
  assert.equal(p.chosen, true);
  assert.equal(calls[0].room, "photo-3");
  for (const s of p.spots) assert.ok(s.at[0] > 0 && s.at[0] < 4 && s.at[1] > 0 && s.at[1] < 3.5, "spot inside the 4 × 3.5 box");
});

test("/place: unknown room is a 404, body room wins", async () => {
  assert.equal((await post("/place", { roomId: "nope", piece: sofa() })).status, 404);
  const res = await post("/place", { roomId: "nope", room: box("inline", 5, 4), piece: sofa() });
  assert.equal(res.status, 200);
});

test("/analyse: the new piece in its spot, the replaced sofa out, ctx passed to lane E", async () => {
  calls.length = 0;
  const piece = { ...sofa(), at: [0.58, -2.59], rot: 90 };
  const res = await post("/analyse", { roomId: "hoskins-living", piece, replaces: "sofa" });
  const { findings } = await res.json();
  // the old sofa is gone, so nothing overlaps the new one
  assert.ok(!findings.some((f) => f.id === "overlap" && f.items.includes("sofa") && f.items.includes(piece.id)), JSON.stringify(findings.map((f) => f.say)));
  assert.ok(findings.some((f) => f.kind === "model"));
  assert.ok(findings.some((f) => f.kind === "design"));
  const d = calls.find((c) => c.kind === "design");
  assert.equal(d.ctx.replaces, "sofa");
  assert.deepEqual(d.ctx.piece.at, [0.58, -2.59]);
});

test("/analyse without the replace: the old and new sofa overlap", async () => {
  const piece = { ...sofa(), at: [0.58, -2.59], rot: 90 };
  const { findings } = await (await post("/analyse", { roomId: "hoskins-living", piece })).json();
  assert.ok(findings.some((f) => f.id === "overlap" && f.items.includes("sofa")));
});

test("rooms built from photos land in the same store /place reads", async () => {
  saveRoom(box("photo-4", 3, 3));
  const r = await (await fetch(`${base}/rooms/photo-4`)).json();
  assert.equal(r.id, "photo-4");
});
