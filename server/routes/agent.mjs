// Lane G. POST /api/agent/find { roomId, wall?, query } → { pieces } (each already known to fit).
import { Router } from "express";
import { openai, MODELS } from "../openai.mjs";
import { room as fixtureRoom } from "../fixtures.mjs";
import { find } from "../../agent/find.mjs";

const r = Router();
const styleCache = new Map();
const results = new Map();   // same question, same answer, for an hour: a search takes ~40 s

// Rooms come from lane A's /api/rooms/:id once it lands; until then the fixture is the only room.
const roomFor = (id) => {
  const room = fixtureRoom();
  return !id || id === room.id ? room : null;
};

r.post("/find", async (req, res) => {
  const { roomId, wall, query, fresh } = req.body ?? {};
  if (!query || typeof query !== "string") return res.status(400).json({ error: "query is required" });
  const room = roomFor(roomId);
  if (!room) return res.status(404).json({ error: `no room ${roomId}` });
  if (wall && !room.walls.some((w) => w.id === wall)) return res.status(400).json({ error: `no wall ${wall} in ${room.id}` });

  const key = JSON.stringify([room.id, wall ?? null, query.trim().toLowerCase()]);
  const hit = results.get(key);
  if (hit && !fresh && Date.now() - hit.at < 3600e3) return res.json(hit.out);
  try {
    const out = await find(room, { query, wall }, { openai, models: MODELS, styleCache, log: (m) => console.log(`[agent] ${m}`) });
    if (out.pieces.length) results.set(key, { at: Date.now(), out });
    res.json(out);
  } catch (e) {
    console.error("[agent]", e.message);
    res.status(502).json({ error: e.message, pieces: [] });
  }
});

export default r;
