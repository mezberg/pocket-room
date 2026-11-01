// Lane B. Picture → piece.json → model (furniture/README.md).
import { Router } from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPiece, createPieceFromFacts, getPiece, modelFile, imageFile } from "../../furniture/pieces.mjs";
import { readLink } from "../../furniture/link.mjs";
import { sofa as fixtureSofa } from "../fixtures.mjs";

// Contract fixture pieces, served by id like any other (the app's "Sample sofa").
const FIXTURES = { "fixture-sofa-84": fixtureSofa };
const pieceById = (id) => getPiece(id) ?? FIXTURES[id]?.() ?? null;

const r = Router();
const SEND = { dotfiles: "allow" };   // the checkout may sit under a dot folder (.claude/worktrees)
const viewer = fileURLToPath(new URL("../../furniture/viewer.html", import.meta.url));

r.post("/", async (req, res, next) => {
  try { res.json(await createPiece(req.body ?? {})); }
  catch (err) { err.status ? res.status(err.status).json({ error: err.message }) : next(err); }
});

// A pasted product link: { url } → piece (sizes stated on the page, never guessed; the kit piece stands in
// while the mesh builds from the product picture).
r.post("/from-link", async (req, res, next) => {
  try {
    const { openai, MODELS } = await import("../openai.mjs");
    const { facts, image, kitRead } = await readLink(req.body?.url, { openai, models: MODELS });
    res.json(await createPieceFromFacts(facts, { image, kitRead }));
  } catch (err) { err.status ? res.status(err.status).json({ error: err.message }) : next(err); }
});

// a three.js page that loads a piece's model (GLB or kit piece): /api/pieces/viewer?id=…
r.get("/viewer", (req, res) => res.sendFile(viewer, SEND));

r.get("/:id", (req, res) => {
  const p = pieceById(req.params.id);
  p ? res.json(p) : res.status(404).json({ error: "no such piece" });
});
r.get("/:id/model.glb", (req, res) => {
  const f = getPiece(req.params.id) && modelFile(req.params.id);
  f && existsSync(f) ? res.type("model/gltf-binary").sendFile(f, SEND) : res.status(404).end();
});
r.get("/:id/image", (req, res) => {
  const f = getPiece(req.params.id) && imageFile(req.params.id);
  f && existsSync(f) ? res.sendFile(f, SEND) : res.status(404).end();
});
export default r;
