import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { crop, startRoomModels, notesFor } from "./models.mjs";

const photo = "data:image/jpeg;base64," + readFileSync(new URL("../../docs/test-inputs/zoopla/room-a-openplan-4.jpg", import.meta.url)).toString("base64");

test("crop: the object's box in its photo, padded, ≤ 1024 px", async () => {
  const c = await crop(photo, { left: 0, top: 0.3, right: 0.5, bottom: 0.9 });
  const m = await sharp(Buffer.from(c.split(",")[1], "base64")).metadata();
  assert.ok(m.width <= 1024 && m.height <= 1024 && m.width > m.height * 0.8, `${m.width}x${m.height}`);
});

test("the room's big items get a model from their crop; small or unseen ones stay kit pieces", async () => {
  const room = {
    id: "t", furniture: [
      { id: "kitchen", name: "Kitchen run", category: "cupboard", size: [4.2, 0.6, 2.2], at: [1, 1], rot: 0 },
      { id: "sofa", name: "L-shaped sofa", category: "sofa", size: [2.4, 0.95, 0.8], at: [2, 2], rot: 0 },
      { id: "sofa_chaise", name: "L-shaped sofa (chaise end)", category: "sofa", size: [0.95, 1.2, 0.8], at: [3, 2], rot: 0 },
      { id: "chair", name: "Chair", category: "chair", size: [0.45, 0.5, 0.85], at: [1, 3], rot: 0 },
      { id: "shelf", name: "Shelf", category: "shelf", size: [0.8, 0.35, 1.8], at: [1, 3], rot: 0 },
    ],
    _derived: { objects: {
      kitchen: { photo: 1, box: { left: 0, top: 0.3, right: 0.5, bottom: 0.9 }, look: "pale oak fronts, green tiles" },
      sofa: { photo: 1, box: { left: 0.6, top: 0.5, right: 1, bottom: 0.9 }, look: "dark grey" },
      chair: { photo: 1, box: { left: 0.4, top: 0.5, right: 0.5, bottom: 0.7 }, look: "" },
    } },
  };
  const made = [];
  const ids = await startRoomModels(room, [photo], { createPiece: (item, x) => { made.push({ item: item.id, ...x }); return { id: `p-${item.id}` }; } });
  assert.deepEqual(made.map((m) => m.item), ["kitchen", "sofa", "sofa_chaise"]);   // biggest first; the chair is small, the shelf unseen
  assert.deepEqual(ids, ["p-kitchen", "p-sofa", "p-sofa_chaise"]);
  assert.equal(room.furniture[0].piece, "p-kitchen");
  assert.match(made[0].notes, /pale oak fronts, green tiles/);
  assert.match(made[0].notes, /wall cabinets above/);
  assert.match(made[2].notes, /only the chaise end/);
  assert.match(made[1].notes, /only the long back section/);
  assert.ok(made[0].image.startsWith("data:image/jpeg;base64,"));
});

test("notes tell astra which object in the room photo to build", () => {
  assert.match(notesFor({ id: "k", name: "Kitchen base cabinets" }, { look: "white gloss" }), /model only the kitchen base cabinets.*white gloss.*wall cabinets/s);
});
