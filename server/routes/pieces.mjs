// Lane B. Stub: every picture is the fixture sofa.
import { Router } from "express";
import { sofa } from "../fixtures.mjs";
const r = Router();
r.post("/", (req, res) => res.json({ ...sofa(), source: { kind: req.body.kind ?? "photo", image: null } }));
r.get("/:id", (req, res) => res.json(sofa()));
export default r;
