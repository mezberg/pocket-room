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

test("options: photos always; a plan only where the local pipeline is", async () => {
  const opts = await (await fetch(`${base}/options`)).json();
  assert.equal(opts.photo, true);
  assert.equal(typeof opts.plan, "boolean");
});

const put = (id, body) => fetch(`${base}/${id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

test("an edited photo room is saved and served; the prebuilt flat is not editable", async () => {
  const { readFileSync } = await import("node:fs");
  const { roomFromReading } = await import("../../room/photo/build.mjs");
  const { resizeRoom } = await import("../../app/js/room-edit.js");
  const reading = JSON.parse(readFileSync(new URL("../../room/photo/fixtures/venue-chesterfields.reading.json", import.meta.url)));
  const room = resizeRoom(roomFromReading(reading, { id: "photo-put-test" }), { width: 9, depth: 6.5 }, { measured: ["width", "depth"] });
  const res = await put(room.id, room);
  assert.equal(res.status, 200);
  const back = await (await fetch(`${base}/${room.id}`)).json();
  assert.equal(back.accuracy_m, 0.05);
  assert.ok((await (await fetch(base)).json()).rooms.some((r) => r.id === room.id));

  assert.equal((await put("hoskins-living", fixture())).status, 403);
  assert.equal((await put("hoskins-living", { ...room, id: "hoskins-living" })).status, 403);
  assert.equal((await put(room.id, { ...room, walls: "no" })).status, 400);
  assert.equal((await put("other-id", room)).status, 400);
});

test("without the local plan reader, the plan option is off and from-plan says so", async () => {
  process.env.FLOORPLAN_OFF = "1";
  try {
    assert.equal((await (await fetch(`${base}/options`)).json()).plan, false);
    const res = await fetch(`${base}/from-plan`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image: "data:image/png;base64,iVBORw0KGgo=" }) });
    assert.equal(res.status, 501);
    assert.match((await res.json()).error, /Use photos instead/);
  } finally { delete process.env.FLOORPLAN_OFF; }
});
