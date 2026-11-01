// Lanes D (rules/) + E (decisions/). Thin wrapper: rules/ measures every spot and model finding;
// lane E's decisions/hooks.mjs, when it exists, picks among the spots and adds design findings.
import { Router } from "express";
import { existsSync } from "node:fs";
import { place, analyse } from "../../rules/index.mjs";
import { withPiece } from "../../decisions/design.mjs";
import { resolveRoom } from "../rooms-store.mjs";

// Lane E hook. decisions/hooks.mjs may export either or both:
//   choose(room, piece, placement) -> placement   pick/reorder among placement.spots (all legal, measured)
//   design(room, findings, ctx) -> finding[]      kind "design" findings (Decisions API), ctx = { piece, replaces }
const hooks = new URL("../../decisions/hooks.mjs", import.meta.url);
const E = existsSync(hooks) ? await import(hooks) : {};

// The room: body.room (unsaved), else the room store by roomId (Hoskins rooms, rooms built this session,
// lane D's sample rooms), else the default room. An unknown roomId is a 404.
function roomOr404(body, res) {
  const room = resolveRoom(body);
  if (!room) res.status(404).json({ error: `no room ${body.roomId}` });
  return room;
}

export function placeRouter(hook = E) {
  const r = Router();

  // { roomId | room, piece, replace? } → placement
  r.post("/place", async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const { piece, replace } = body;
      if (!piece || !Array.isArray(piece.size) || piece.size.length < 2) return res.status(400).json({ error: "piece with size [w, d, h] needed" });
      const room = roomOr404(body, res);
      if (!room) return;
      let placement = place(room, piece, { replace });
      if (hook.choose) placement = await hook.choose(room, piece, placement);
      res.json(placement);
    } catch (e) { next(e); }
  });

  // { roomId | room, piece?, replaces? } → { findings }. piece (with at, rot) is the new piece in its spot;
  // replaces is the id of the item it takes the place of. Model findings are measured on the room with the
  // piece in and the old one out; design findings get the same room and piece.
  r.post("/analyse", async (req, res, next) => {
    try {
      const body = req.body ?? {};
      const room = roomOr404(body, res);
      if (!room) return;
      const ctx = { piece: body.piece?.at ? body.piece : undefined, replaces: body.replaces ?? undefined };
      // lane E's request goes out first; lane D measures while it is in flight
      const design = hook.design ? hook.design(room, [], ctx) : Promise.resolve([]);
      await new Promise((ok) => setTimeout(ok, 25));   // let the request leave before the sync measuring
      const { findings } = analyse(withPiece(room, ctx));
      findings.push(...(await design));
      res.json({ findings });
    } catch (e) { next(e); }
  });
  return r;
}

export default placeRouter();
