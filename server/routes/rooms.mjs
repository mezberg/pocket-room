// Lane A. Rooms: the prebuilt Hoskins Street export, and rooms built from photos.
import { Router } from "express";
import { readRoom } from "../../room/photo/read.mjs";
import { roomFromReading } from "../../room/photo/build.mjs";
import { savePlan, runPipeline } from "../../room/fireplan/run.mjs";
import { roomFromPlan } from "../../room/fireplan/convert.mjs";
import { getRoom, saveRoom, listRooms } from "../rooms-store.mjs";

const r = Router();

r.get("/", (req, res) => {
  res.json({ rooms: listRooms() });
});

r.get("/:id", (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: `no room ${req.params.id}` });
  res.json(room);
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
    const reading = await readRoom(images, text);
    const room = roomFromReading(reading, { name, known });
    saveRoom(room);
    res.json(room);
  } catch (e) { next(e); }
});

// Fire-escape / estate-agent plan -> one room. { image: dataURL, room?: "r3", px_per_m?, height_m?, name? }
// Without `room` it takes the largest; the reply's _plan_rooms lists the others to ask for.
r.post("/from-plan", async (req, res, next) => {
  try {
    const { image, room: pick, px_per_m, height_m, name } = req.body || {};
    let file;
    try { file = savePlan(image); } catch (e) { return res.status(400).json({ error: e.message }); }
    const { graph, rings } = await runPipeline(file);
    const room = roomFromPlan(graph, rings, { room: pick, px_per_m, height_m, name });
    saveRoom(room);
    res.json(room);
  } catch (e) { next(e); }
});

export default r;
