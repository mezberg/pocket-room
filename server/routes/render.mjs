// Lane F. Stub: echoes the view back.
import { Router } from "express";
const r = Router();
r.post("/", (req, res) => res.json({ image: req.body.view ?? null }));
export default r;
