// Lane G. Stub: suggests the fixture sofa.
import { Router } from "express";
import { sofa } from "../fixtures.mjs";
const r = Router();
r.post("/find", (req, res) => res.json({ pieces: [{ ...sofa(), source: { kind: "agent", url: null } }] }));
export default r;
