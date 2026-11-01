// Lanes D (rules/) + E (decisions/). Stub: one fixed spot along the east wall, one finding.
import { Router } from "express";
const r = Router();
r.post("/place", (req, res) => {
  const spot = { at: [3.18, -3.4], rot: 270, wall: "east", score: 0.8, clearance_m: 0.7, verdict: "Just fits", reasons: ["stub"] };
  res.json({ verdict: "Just fits", best: spot, spots: [spot], say: "Just fits. Put it on the long wall." });
});
r.post("/analyse", (req, res) => res.json({ findings: [
  { id: "walkway_tight", kind: "model", pass: false, severity: "warn", at: [2.2, -1.0], items: ["dining_chair_1"],
    say: "The walkway by the door is 55 cm. Move the chair 20 cm." },
] }));
export default r;
