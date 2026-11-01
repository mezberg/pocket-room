// Lanes D (rules/) + E (decisions/). Thin wrapper: rules/ measures every spot and model finding;
// lane E's decisions/hooks.mjs, once it exists, picks among the spots and adds design findings.
import { Router } from "express";
import { existsSync } from "node:fs";
import { place, analyse } from "../../rules/index.mjs";
import * as samples from "../../rules/sample-rooms.mjs";
import { room as fixtureRoom } from "../fixtures.mjs";

// Lane E hook. decisions/hooks.mjs may export either or both:
//   choose(room, piece, placement) -> placement   pick/reorder among placement.spots (all legal, measured)
//   design(room, findings) -> finding[]           kind "design" findings (Decisions API)
const hooks = new URL("../../decisions/hooks.mjs", import.meta.url);
const E = existsSync(hooks) ? await import(hooks) : {};

// The room: sent in the body, a sample room by id (tiny / typical / crowded), or the fixture.
// TODO lane A: look rooms up by id once rooms.mjs keeps them.
const roomFor = (body) => body.room ?? samples[body.roomId]?.() ?? fixtureRoom();

const r = Router();

r.post("/place", async (req, res) => {
  const { piece, replace } = req.body ?? {};
  if (!piece || !Array.isArray(piece.size) || piece.size.length < 2) return res.status(400).json({ error: "piece with size [w, d, h] needed" });
  const room = roomFor(req.body);
  let placement = place(room, piece, { replace });
  if (E.choose) placement = await E.choose(room, piece, placement);
  res.json(placement);
});

r.post("/analyse", async (req, res) => {
  const room = roomFor(req.body ?? {});
  const { findings } = analyse(room);
  if (E.design) findings.push(...(await E.design(room, findings)));
  res.json({ findings });
});

export default r;
