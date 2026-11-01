// Lane A. Stub: returns the fixture.
import { Router } from "express";
import { room } from "../fixtures.mjs";
const r = Router();
r.get("/:id", (req, res) => res.json(room()));
r.post("/from-photo", (req, res) => res.json({ ...room(), id: "from-photo-stub", source: "photo", accuracy_m: 0.15 }));
export default r;
