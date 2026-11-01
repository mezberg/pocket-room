// Lane A. Rooms: the prebuilt Hoskins Street export, and rooms built from photos.
import { Router } from "express";
import { readRoom } from "../../room/photo/read.mjs";
import { roomFromReading } from "../../room/photo/build.mjs";
import { savePlan, runPipeline, pipelineReady } from "../../room/fireplan/run.mjs";
import { roomFromPlan } from "../../room/fireplan/convert.mjs";
import { getRoom, saveRoom, listRooms } from "../rooms-store.mjs";
import { checkRoom } from "../../room/schema-check.mjs";

const r = Router();

r.get("/", (req, res) => {
  res.json({ rooms: listRooms() });
});

// What the New room screen may offer: photos always; a plan only where the local pipeline runs.
r.get("/options", (req, res) => {
  res.json({ photo: true, plan: pipelineReady() });
});

r.get("/:id", (req, res) => {
  const room = getRoom(req.params.id);
  if (!room) return res.status(404).json({ error: `no room ${req.params.id}` });
  res.json(room);
});

// A built room after the reader fixed it in the app (resized in code, a wrong object taken out).
// Only rooms built from photos or plans; the prebuilt flat stays as exported.
r.put("/:id", (req, res) => {
  const room = req.body;
  if (!room || room.id !== req.params.id) return res.status(400).json({ error: "body: the room, with the same id" });
  if (!["photo", "floorplan"].includes(room.source)) return res.status(403).json({ error: "only rooms built from photos or plans can be edited" });
  const prior = getRoom(room.id);
  if (prior && !["photo", "floorplan"].includes(prior.source)) return res.status(403).json({ error: `${room.id} is prebuilt` });
  const errors = checkRoom(room);
  if (errors.length) return res.status(400).json({ error: `not a room: ${errors.slice(0, 3).join("; ")}` });
  saveRoom(room);
  res.json({ ok: true, id: room.id });
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
    if (!/^data:image\/(png|jpe?g|webp);base64,/.test(image || "")) return res.status(400).json({ error: "image: a png, jpeg or webp data URL" });
    if (!pipelineReady()) return res.status(501).json({ error: "Floor plans need the local plan reader, which isn't on this server. Use photos instead." });
    try { file = savePlan(image); } catch (e) { return res.status(400).json({ error: e.message }); }
    const { graph, rings } = await runPipeline(file);
    const room = roomFromPlan(graph, rings, { room: pick, px_per_m, height_m, name });
    saveRoom(room);
    res.json(room);
  } catch (e) { next(e); }
});

export default r;
