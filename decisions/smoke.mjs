// Live smoke test of lane E against the real Decisions API, on the fixtures. Costs three small requests.
// Run: node --env-file=.env decisions/smoke.mjs
import { readFileSync } from "node:fs";
import { chooseBest, gradeDesign, routeUtterance } from "./index.mjs";

const j = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url)));
const room = j("../contract/fixtures/hoskins-living-room.room.json");
const piece = j("../contract/fixtures/sofa-84.piece.json");
let ok = true;
const check = (cond, what) => { console.log(`${cond ? "✓" : "✗"} ${what}`); ok &&= cond; };

const placed = await chooseBest(j("./fixtures/placement-sofa-84.json"), { room, piece });
check(placed.decision.by !== "rules", `best spot by ${placed.decision.by} in ${placed.decision.ms ?? "–"} ms${placed.decision.error ? `: ${placed.decision.error}` : ""}`);
console.log(`  ${placed.say}  (p ${placed.best?.decision?.probability})`);
for (const s of placed.spots) console.log(`    ${s.wall ?? "?"} ${s.verdict.padEnd(11)} p ${s.decision?.probability ?? "–"}  ${s.reasons[0] ?? ""}`);

const { findings, decision } = await gradeDesign(room, { piece: { ...piece, at: placed.best.at, rot: placed.best.rot }, replaces: "sofa" });
check(findings.length >= 4 && findings.length <= 6, `design grade: ${findings.length} findings, ${decision.questions} questions, ${decision.ms} ms, ${decision.tokens} tokens`);
for (const f of findings) console.log(`  ${f.pass ? "pass" : f.severity.padEnd(4)} ${String(f.probability).padEnd(4)} ${f.id.padEnd(14)} ${f.say}`);

for (const [s, want] of [["move the sofa under the window", "move"], ["swap the coffee table for a round one", "swap"], ["will it fit?", "ask"], ["show me it at sunset", "render"]]) {
  const v = await routeUtterance(s);
  check(v.intent === want, `"${s}" → ${v.intent} (p ${v.probability}, ${v.ms} ms)`);
}
process.exit(ok ? 0 : 1);
