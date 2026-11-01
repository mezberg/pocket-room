// Lane A. Rooms: the prebuilt Hoskins Street export, and rooms built from photos.
import { Router } from "express";
import { readFileSync, readdirSync } from "node:fs";
import { room as livingFixture } from "../fixtures.mjs";
import { readRoom } from "../../room/photo/read.mjs";
import { roomFromReading } from "../../room/photo/build.mjs";

const HOSKINS = new URL("../../room/hoskins/rooms/", import.meta.url);
const prebuilt = () => {
  const out = { "hoskins-living": livingFixture() };
  let files = [];
  try { files = readdirSync(HOSKINS).filter((f) => f.endsWith(".room.json")); } catch {}
  for (const f of files) {
    const room = JSON.parse(readFileSync(new URL(f, HOSKINS)));
    out[room.id] ??= room;
  }
  return out;
};
const built = new Map();   // rooms made from photos this session

const r = Router();

r.get("/", (req, res) => {
  const all = { ...prebuilt(), ...Object.fromEntries(built) };
  res.json({ rooms: Object.values(all).map(({ id, name, source }) => ({ id, name, source })) });
});

r.get("/:id", (req, res) => {
  const room = built.get(req.params.id) ?? prebuilt()[req.params.id];
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
    built.set(room.id, room);
    res.json(room);
  } catch (e) { next(e); }
});

export default r;
