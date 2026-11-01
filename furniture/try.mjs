// Live run of the three test pictures through the pipeline (costs API calls; not part of npm test).
// node --env-file=.env furniture/try.mjs [auto|parametric|image_to_3d]
import { readFileSync } from "node:fs";
import { createPiece, getPiece, modelFile } from "./pieces.mjs";
import { fromGLB, boundsOf, countTriangles } from "./glb.mjs";
import { checkPiece } from "./check-piece.mjs";

const mode = process.argv[2] ?? "auto";
const IMAGES = [
  ["chesterfield-2-seat-2026-11-01.jpg", "photo"],
  ["shop-tag-armchair-2026-11-01.jpg", "shop_tag"],
  ["instagram-screenshot-sideboard-2026-11-01.jpg", "screenshot"],
];
const dataUrl = (f) => "data:image/jpeg;base64," + readFileSync(new URL(`./test-images/${f}`, import.meta.url)).toString("base64");

const results = await Promise.all(IMAGES.map(async ([file, kind]) => {
  const t0 = Date.now();
  let p = await createPiece({ image: dataUrl(file), kind, mode });
  while (p.model.status === "building") { await new Promise(r => setTimeout(r, 2000)); p = getPiece(p.id); }
  const total = Date.now() - t0;
  let glb = null;
  if (p.model.glb) {
    const doc = await fromGLB(readFileSync(modelFile(p.id)));
    const { min, max } = boundsOf(doc);
    glb = { tris: countTriangles(doc), min: min.map(v => +v.toFixed(3)), max: max.map(v => +v.toFixed(3)) };
  }
  return { file, id: p.id, errors: checkPiece(p), total_ms: total, piece: { ...p, source: { ...p.source, image: p.source.image?.slice(0, 40) } }, glb };
}));
for (const r of results) {
  console.log(`\n== ${r.file}  id=${r.id}  ${r.total_ms} ms  schema: ${r.errors.length ? r.errors.join("; ") : "valid"}`);
  console.log(JSON.stringify(r.piece, null, 1));
  if (r.glb) console.log("glb", JSON.stringify(r.glb));
  console.log(`viewer: http://localhost:${process.env.PORT || 8790}/api/pieces/viewer?id=${r.id}`);
}
