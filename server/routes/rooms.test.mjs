import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import rooms from "./rooms.mjs";
import { room as fixture } from "../fixtures.mjs";

let server, base;
before(async () => {
  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use("/api/rooms", rooms);
  await new Promise((ok) => (server = app.listen(0, ok)));
  base = `http://localhost:${server.address().port}/api/rooms`;
});
after(() => server.close());

test("GET /api/rooms/hoskins-living returns the exact export", async () => {
  const res = await fetch(`${base}/hoskins-living`);
  assert.equal(res.status, 200);
  const room = await res.json();
  assert.deepEqual(room, fixture());
  assert.equal(room.source, "prebuilt");
  assert.ok(room.walls.length >= 4);
});

test("unknown room is a 404", async () => {
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});

test("from-photo wants images", async () => {
  const res = await fetch(`${base}/from-photo`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(res.status, 400);
});

test("the rest of the flat is listed and served", async () => {
  const { rooms } = await (await fetch(base)).json();
  const ids = rooms.map((r) => r.id);
  for (const id of ["hoskins-living", "hoskins-bedroom", "hoskins-hall", "hoskins-kitchen", "hoskins-bathroom"]) assert.ok(ids.includes(id), id);
  const kitchen = await (await fetch(`${base}/hoskins-kitchen`)).json();
  assert.equal(kitchen.walls[3].openings[0].id, "kitchen_door");
});

test("from-plan wants an image data URL", async () => {
  const res = await fetch(`${base}/from-plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: "nope" }) });
  assert.equal(res.status, 400);
});

import { saveRoom } from "../rooms-store.mjs";
const json = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const box = (id) => ({ id, name: "Box", source: "photo", accuracy_m: 1, height: 2.5, glb: null, lights: [], fixtures: [],
  walls: [["south", [0, 0], [4, 0]], ["east", [4, 0], [4, 3]], ["north", [4, 3], [0, 3]], ["west", [0, 3], [0, 0]]].map(([id, a, b]) => ({ id, a, b, openings: [] })),
  furniture: [{ id: "sofa", name: "Sofa", category: "sofa", at: [2, 0.5], size: [2, 0.9, 0.8], rot: 0, on_floor: true }] });

test("the list says whether plans can be read here", async () => {
  const out = await (await fetch(base)).json();
  assert.equal(typeof out.from_plan, "boolean");
});

test("PATCH fixes a built room's size by hand; the flat's rooms stay exact", async () => {
  saveRoom(box("photo-t1"));
  const res = await fetch(`${base}/photo-t1`, json("PATCH", { width_m: 5, depth_m: 3.6, name: "Studio" }));
  assert.equal(res.status, 200);
  const room = await res.json();
  assert.equal(room.name, "Studio");
  assert.equal(room.accuracy_m, 0.05);
  assert.deepEqual(room.walls[2].a, [5, 3.6]);
  assert.deepEqual((await (await fetch(`${base}/photo-t1`)).json()).walls[2].a, [5, 3.6]);   // stored
  assert.equal((await fetch(`${base}/photo-t1`, json("PATCH", { width_m: 0.2 }))).status, 400);
  assert.equal((await fetch(`${base}/hoskins-living`, json("PATCH", { width_m: 4 }))).status, 400);
});

test("PUT puts back a room the app kept, checked against the schema", async () => {
  assert.equal((await fetch(`${base}/photo-t2`, json("PUT", box("photo-t2")))).status, 200);
  assert.equal((await (await fetch(`${base}/photo-t2`)).json()).name, "Box");
  assert.equal((await fetch(`${base}/photo-t3`, json("PUT", { ...box("photo-t3"), walls: "no" }))).status, 400);
  assert.equal((await fetch(`${base}/photo-t4`, json("PUT", box("photo-t5")))).status, 400);
  assert.equal((await fetch(`${base}/hoskins-living`, json("PUT", box("hoskins-living")))).status, 400);
});
