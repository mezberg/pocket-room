// Lane G. POST /api/agent/find { roomId, wall?, query } → { pieces } (each already known to fit).
import { Router } from "express";
import { openai, MODELS } from "../openai.mjs";
import { resolveRoom } from "../rooms-store.mjs";
import { find } from "../../agent/find.mjs";
import { getPiece, registerProductPiece } from "../../furniture/pieces.mjs";

const r = Router();
const styleCache = new Map();
const results = new Map();   // same question, same answer, for an hour: a search takes ~40 s


r.post("/find", async (req, res) => {
  const { roomId, room: bodyRoom, wall, query, fresh, designer, replace } = req.body ?? {};
  if (!query || typeof query !== "string") return res.status(400).json({ error: "query is required" });
  const room = resolveRoom({ room: bodyRoom, roomId });   // the shared store; a body room wins
  if (!room) return res.status(404).json({ error: `no room ${roomId}` });
  if (wall && !room.walls.some((w) => w.id === wall)) return res.status(400).json({ error: `no wall ${wall} in ${room.id}` });

  const key = JSON.stringify([room.id, wall ?? null, query.trim().toLowerCase()]);
  const hit = results.get(key);
  if (hit && !fresh && Date.now() - hit.at < 3600e3) return res.json({ ...hit.out, pieces: hit.out.pieces.map((p) => getPiece(p.id) ?? p) });
  try {
    const out = await find(room, { query, wall, designer: !!designer, replace: replace ?? null }, { openai, models: MODELS, styleCache, log: (m) => console.log(`[agent] ${m}`) });
    // Like a pasted link: each piece is kept by lane B under its id (GET /api/pieces/:id) and its 3D model
    // builds from the product picture now, so the one you tap is ready sooner; the kit piece stands in.
    out.pieces = out.pieces.map((p) => registerProductPiece(p));
    console.log(`[agent] ${out.pieces.length} pieces: ${out.pieces.map((p) => `${p.id} ${p.model.status}`).join(", ")}`);
    if (out.pieces.length) results.set(key, { at: Date.now(), out });
    res.json(out);
  } catch (e) {
    console.error("[agent]", e.message);
    res.status(502).json({ error: e.message, pieces: [] });
  }
});

export default r;
