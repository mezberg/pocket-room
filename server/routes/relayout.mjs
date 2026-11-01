// Rearrange my room (relayout/). { roomId | room, piece?, replaces?, finding?, pinned? } → { plans, none?, before, decision }.
// The room and piece are the same as /api/analyse gets. A placed new piece stays where it is (pinned); `finding`
// (from /api/analyse) puts the plans that clear it first.
import { Router } from "express";
import { relayout } from "../../relayout/index.mjs";
import { withPiece } from "../../decisions/design.mjs";
import { resolveRoom } from "../rooms-store.mjs";

export function relayoutRouter(opts = {}) {
  const r = Router();
  r.post("/", async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const room0 = resolveRoom(body);
      if (!room0) return res.status(404).json({ error: `no room ${body.roomId}` });
      const piece = body.piece?.at ? body.piece : undefined;
      const room = withPiece(room0, { piece, replaces: body.replaces ?? undefined });
      const pinned = [...(body.pinned ?? []), ...(piece ? [piece.id] : [])];
      res.json(await relayout(room, { focus: body.finding ?? null, pinned, ...opts }));
    } catch (e) { next(e); }
  });
  return r;
}

export default relayoutRouter();
