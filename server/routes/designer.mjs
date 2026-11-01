// The interior designer (designer/): POST /api/plan { roomId | room, piece } → plans (place / move then place /
// replace, the Decisions pick first); POST /api/advice { roomId | room, findings } → the problems ranked.
import { Router } from "express";
import { plan, advise } from "../../designer/index.mjs";
import { resolveRoom } from "../rooms-store.mjs";

export function designerRouter(opts = {}) {
  const r = Router();
  r.post("/plan", async (req, res, next) => {
    try {
      const body = req.body ?? {};
      if (!body.piece || !Array.isArray(body.piece.size) || body.piece.size.length < 2) return res.status(400).json({ error: "piece with size [w, d, h] needed" });
      const room = resolveRoom(body);
      if (!room) return res.status(404).json({ error: `no room ${body.roomId}` });
      res.json(await plan(room, body.piece, opts));
    } catch (e) { next(e); }
  });
  r.post("/advice", async (req, res, next) => {
    try {
      const body = req.body ?? {};
      if (!Array.isArray(body.findings)) return res.status(400).json({ error: "findings (from /api/analyse) needed" });
      const room = resolveRoom(body);
      if (!room) return res.status(404).json({ error: `no room ${body.roomId}` });
      res.json(opts.decide === false ? { ranked: [], by: "rules" } : await advise(room, body.findings));
    } catch (e) { next(e); }
  });
  return r;
}

export default designerRouter();
