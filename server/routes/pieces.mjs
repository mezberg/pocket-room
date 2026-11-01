// Lane B. Picture → piece.json → model (furniture/README.md).
import { Router } from "express";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createPiece, createPieceFromFacts, getPiece, modelFile, imageFile, rebuildPiece, pictureOf, noteLook } from "../../furniture/pieces.mjs";
import { compareLook, decide } from "../../furniture/look.mjs";
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

// Astra checks its own work: { view: dataURL of the model rendered on its own } → { verdict, issues, color,
// rebuilding }. A "wrong" model is rebuilt with what the check said (furniture/look.mjs).
r.post("/:id/look", async (req, res, next) => {
  try {
    const p = getPiece(req.params.id);
    if (!p) return res.status(404).json({ error: "no such piece" });
    const view = req.body?.view;
    if (typeof view !== "string" || !view.startsWith("data:image/")) return res.status(400).json({ error: "view: a data URL of the model" });
    const picture = pictureOf(p.id);
    if (!picture) return res.status(409).json({ error: "this piece's picture isn't on this server" });
    if (p.model?.status === "building") return res.status(409).json({ error: "still building" });
    if (p.look && p.look.glb === p.model?.glb) return res.json({ ...p.look, color: null, rebuilding: false, rebuilds: p.rebuilds ?? 0, cached: true });
    const t0 = Date.now();
    const look = await compareLook(picture, view, p.name, p.notes);
    noteLook(p.id, look);
    const { rebuild, color } = decide(p, look);
    const piece = rebuild ? rebuildPiece(p.id, rebuild, { color }) : p;
    res.json({ ...look, rebuilding: !!rebuild, rebuilds: piece?.rebuilds ?? 0, ms: Date.now() - t0 });
  } catch (err) { next(err); }
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
