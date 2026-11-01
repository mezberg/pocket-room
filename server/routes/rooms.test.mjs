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
