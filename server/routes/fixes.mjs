// Tap an issue → suggested fixes (fixes/). { roomId | room, piece?, replaces?, finding } → { options, none?, decision }.
// The room and piece are the same as /api/analyse gets, so the fixes are measured on the room that was checked.
import { Router } from "express";
import { suggest } from "../../fixes/index.mjs";
import { resolveRoom } from "../rooms-store.mjs";

export function fixesRouter(opts = {}) {
  const r = Router();
  r.post("/", async (req, res, next) => {
    try {
      const body = req.body ?? {};
      if (!body.finding?.id) return res.status(400).json({ error: "finding (from /api/analyse) needed" });
      const room = resolveRoom(body);
      if (!room) return res.status(404).json({ error: `no room ${body.roomId}` });
      const ctx = { piece: body.piece?.at ? body.piece : undefined, replaces: body.replaces ?? undefined };
      res.json(await suggest(room, body.finding, ctx, opts));
    } catch (e) { next(e); }
  });
  return r;
}

export default fixesRouter();
