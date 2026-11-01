// Lane A. Rooms: the prebuilt Hoskins Street export, and rooms built from photos.
import { Router } from "express";
import { readRoom } from "../../room/photo/read.mjs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { roomFromReading, resizeRoom } from "../../room/photo/build.mjs";
import { savePlan, runPipeline, PIPELINE } from "../../room/fireplan/run.mjs";
import { checkRoom } from "../../room/schema-check.mjs";
import { roomFromPlan } from "../../room/fireplan/convert.mjs";
import { getRoom, saveRoom, listRooms } from "../rooms-store.mjs";
import { savePhotos, startRoomModels } from "../../room/photo/models.mjs";
import { createPieceForItem } from "../../furniture/pieces.mjs";

const r = Router();

// Plans need the local Python pipeline (Kate's laptop); a hosted server says so and the app offers photos.
const planReader = () => existsSync(join(PIPELINE, "run_pipeline.py"));

r.get("/", (req, res) => {
  res.json({ rooms: listRooms(), from_plan: planReader() });
});

r.get("/:id", (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: `no room ${req.params.id}` });
  res.json(room);
});

const PREBUILT = /^hoskins-/;
const size = (v) => (v == null || v === "" ? undefined : Number(v));

// Fix a built room's size by hand: { width_m?, depth_m?, height_m?, name? } -> the room, rescaled by code.
r.patch("/:id", (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: `no room ${req.params.id}` });
  if (PREBUILT.test(room.id)) return res.status(400).json({ error: "the flat's rooms are exact; build a new room to change one" });
  const { name } = req.body || {};
  const want = { width_m: size(req.body?.width_m), depth_m: size(req.body?.depth_m), height_m: size(req.body?.height_m) };
  for (const [k, v] of Object.entries(want)) {
    const [lo, hi] = k === "height_m" ? [1.8, 10] : [1, 40];
    if (v !== undefined && !(v >= lo && v <= hi)) return res.status(400).json({ error: `${k}: ${lo}-${hi} m` });
  }
  const out = Object.values(want).some((v) => v) ? resizeRoom(room, want) : room;
  if (typeof name === "string" && name.trim()) out.name = name.trim().slice(0, 60);
  saveRoom(out);
  res.json(out);
});

// Put back a room the app kept (the server forgets built rooms when it restarts). Not the flat's rooms.
r.put("/:id", (req, res) => {
  const room = req.body;
  if (room?.id !== req.params.id) return res.status(400).json({ error: "the room's id must match the URL" });
  if (PREBUILT.test(room.id)) return res.status(400).json({ error: "the flat's rooms can't be replaced" });
  const errors = checkRoom(room);
  if (errors.length) return res.status(400).json({ error: `not a room: ${errors.slice(0, 3).join("; ")}` });
  saveRoom(room);
  res.json({ id: room.id });
});

// { images: [dataURL|url, ...], hint?: string | { text?, width_m?, depth_m?, height_m? }, name? }
r.post("/from-photo", async (req, res, next) => {
  try {
    const { images, hint, name } = req.body || {};
    if (!Array.isArray(images) || !images.length || images.some((i) => typeof i !== "string"))
      return res.status(400).json({ error: "images: a non-empty array of data URLs or URLs" });
    if (images.length > 8) return res.status(400).json({ error: "images: at most 8 (pick frames from a video)" });
    const text = typeof hint === "string" ? hint : hint?.text;
    const known = typeof hint === "object" && hint ? hint : {};
    const t0 = Date.now();
    const reading = await readRoom(images, text);
    const room = roomFromReading(reading, { name, known });
    room._derived.ms = Date.now() - t0;
    room._derived.photos = images.length;
    // the room's own furniture rebuilt in 3D from the photos, in the background (item.piece; the app swaps them in)
    savePhotos(room.id, images);
    await startRoomModels(room, images, { createPiece: createPieceForItem });
    saveRoom(room);
    res.json(room);
  } catch (e) { next(e); }
});

// Fire-escape / estate-agent plan -> one room. { image: dataURL, room?: "r3", px_per_m?, height_m?, name? }
// Without `room` it takes the largest; the reply's _plan_rooms lists the others to ask for.
r.post("/from-plan", async (req, res, next) => {
  try {
    const { image, room: pick, px_per_m, height_m, name } = req.body || {};
    if (!planReader()) return res.status(501).json({ error: "Floor plans are read by a local tool that isn't on this server. Use photos of the room instead.", from_plan: false });
    let file;
    try { file = savePlan(image); } catch (e) { return res.status(400).json({ error: e.message }); }
    const { graph, rings } = await runPipeline(file);
    const room = roomFromPlan(graph, rings, { room: pick, px_per_m, height_m, name });
    saveRoom(room);
    res.json(room);
  } catch (e) { next(e); }
});

export default r;
