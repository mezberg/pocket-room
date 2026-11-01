import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseDimensions, resolveSize } from "./sizes.mjs";
import { kitFor } from "./parametric.mjs";
import { partsToDocument, normalise, boundsOf, toGLB, fromGLB, countTriangles } from "./glb.mjs";
import { cleanParts } from "./astra3d.mjs";
import { checkPiece } from "./check-piece.mjs";

const near = (a, b, eps = 1e-3) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]) < eps, `${a} ≉ ${b}`));

test("parses printed dimensions into metres", () => {
  near(parseDimensions("W 78 cm  D 82 cm  H 74 cm"), [0.78, 0.82, 0.74]);
  near(parseDimensions("160 × 45 × 70 cm. Link in bio"), [1.6, 0.45, 0.7]);
  near(parseDimensions('84"W x 36"D x 33"H'), [2.134, 0.914, 0.838]);
  near(parseDimensions("Width: 2130mm, Depth: 920mm, Height: 840mm"), [2.13, 0.92, 0.84]);
  near(parseDimensions("H 74 D 82 W 78 cm"), [0.78, 0.82, 0.74]);
  near(parseDimensions("1.8 x 0.9 x 0.8 m"), [1.8, 0.9, 0.8]);
  assert.equal(parseDimensions("£449"), null);
  assert.equal(parseDimensions(null), null);
});

test("the contract fixture passes the piece check; a bad piece fails", () => {
  const f = JSON.parse(readFileSync(new URL("../contract/fixtures/sofa-84.piece.json", import.meta.url), "utf8"));
  assert.deepEqual(checkPiece(f), []);
  assert.equal(checkPiece({ ...f, size_source: "guess", model: {} }).length, 2);
});

test("size_source: tag/page beat estimates, category default last", () => {
  assert.equal(resolveSize({ category: "armchair", dimension_text: "W 78 cm D 82 cm H 74 cm", dimension_where: "tag" }).size_source, "tag");
  assert.equal(resolveSize({ category: "cupboard", dimension_text: "160 × 45 × 70 cm", dimension_where: "caption" }).size_source, "product_page");
  const est = resolveSize({ category: "sofa", dimension_text: null, estimate_m: { w: 9, d: 0.9, h: 0.8 } });
  assert.equal(est.size_source, "vision_estimate");
  assert.equal(est.size[0], 3.6);   // clamped to what a sofa can be
  const def = resolveSize({ category: "sofa", dimension_text: null, estimate_m: null });
  assert.deepEqual(def, { size: [2.0, 0.9, 0.82], size_source: "category_default", size_text: null });
});

test("kit args are computed from the size", () => {
  const piece = { size: [2.2, 0.9, 0.8], style: { colors: ["#3f5e4a", "#7b5b42"] } };
  const k = kitFor(piece, { kit_template: "sofa", seats: 3, arms: "slim" });
  assert.equal(k.template, "sofa");
  assert.equal(k.args.seatW, 0.65);   // (2.2 − 2·0.12) / 3
  assert.equal(k.args.wood, "walnut");
  assert.deepEqual(k.fit, [2.2, 0.8, 0.9]);
  const c = kitFor({ size: [1.72, 0.9, 0.78], style: { colors: ["#7d2027"] } }, { kit_template: "chesterfieldLoveseat", seats: 2 });
  assert.equal(c.module, "chesterfield.js");
  assert.equal(c.args.width, 1.72);
  assert.equal(kitFor(piece, { kit_template: null }), null);
});

test("parts → GLB → normalised to size, on the floor, centred", async () => {
  const parts = cleanParts([
    { shape: "rounded_box", size: [1.7, 0.25, 0.86], pos: [0.3, 0.5, 0.1], rot: [0, 0, 0], color: "#62262c", radius: 0.05 },
    { shape: "cylinder", size: [0.08, 0.1, 0.08], pos: [0.9, 0.3, 0.4], rot: [0, 0, 0], color: "#30201c" },
    { shape: "sphere", size: [0.3, 0.3, 0.3], pos: [-0.5, 0.9, -0.3], rot: [10, 20, 30], color: "#a53743" },
    { shape: "box", size: [0, 1, 1], pos: [0, 0, 0], color: "#000000" },   // dropped: zero size
  ]);
  assert.equal(parts.length, 3);
  const doc = partsToDocument(parts);
  await normalise(doc, [1.8, 0.95, 0.82]);
  const { min, max } = boundsOf(doc);
  near(min, [-0.9, 0, -0.475]);
  near(max, [0.9, 0.82, 0.475]);
  // survives a GLB round trip
  const back = await fromGLB(await toGLB(doc));
  near(boundsOf(back).max, [0.9, 0.82, 0.475]);
  assert.equal(back.getRoot().listMaterials().length, 3);
});

test("big meshes are decimated, nested node transforms are baked", async () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ shape: "sphere", size: [0.1, 0.1, 0.1], pos: [i * 0.01, 0.5, 0], rot: [0, 0, 0], color: "#888888" }));
  const doc = partsToDocument(many);
  const before = countTriangles(doc);
  // wrap the mesh node in a turned, scaled parent: normalise must still land the box on size
  const root = doc.getRoot(), node = root.listNodes()[0], scene = root.listScenes()[0];
  const parent = doc.createNode("parent").setScale([3, 3, 3]).setRotation([0, Math.SQRT1_2, 0, Math.SQRT1_2]);
  scene.removeChild(node); parent.addChild(node); scene.addChild(parent);
  await normalise(doc, [1, 1, 1], { triBudget: 10_000 });
  assert.ok(countTriangles(doc) <= 11_000 && countTriangles(doc) < before, `${before} → ${countTriangles(doc)}`);
  const { min, max } = boundsOf(doc);
  near(min, [-0.5, 0, -0.5], 0.02);
  near(max, [0.5, 1, 0.5], 0.02);
});

test("createPiece: tag photo → parametric piece with tag size (vision stubbed)", async () => {
  process.env.OPENAI_API_KEY ??= "test-not-used";
  process.env.PIECES_OUT = mkdtempSync(join(tmpdir(), "pieces-"));
  const { createPiece, getPiece } = await import("./pieces.mjs");
  const read = async () => ({
    is_furniture: true, category: "armchair", name: "HALDEN Armchair", style_tags: ["boucle", "curved"], colors: ["#c08a1e", "#c59c6e"],
    material: "boucle", dimension_text: "W 78 cm  D 82 cm  H 74 cm", dimension_where: "tag", estimate_m: null, price: "£449", shop: null, url: null,
    kit_template: "armchair", kit_fit: "good", seats: 1, arms: "wide", legs: "wood", doors: null, round: null,
  });
  const img = "data:image/jpeg;base64," + readFileSync(new URL("./test-images/shop-tag-armchair-2026-11-01.jpg", import.meta.url)).toString("base64");
  const p = await createPiece({ image: img, kind: "shop_tag" }, { read });
  assert.deepEqual(checkPiece(p), []);
  assert.deepEqual(p.size, [0.78, 0.82, 0.74]);
  assert.equal(p.size_source, "tag");
  assert.equal(p.source.price, "£449");
  assert.equal(p.model.status, "ready");
  assert.equal(p.model.how, "parametric");
  assert.equal(p.model.parametric.template, "sofa");
  assert.equal(getPiece(p.id).name, "HALDEN Armchair");
  await assert.rejects(createPiece({ image: "nope" }, { read }), /data URL/);
});

// Zoopla test (2026-11-01): IKEA STYRSPEL read as 0.7 x 0.7 x 1.3 m and came out 1.2 m tall, cut by the
// chair range. Office chairs with a headrest are 1.3-1.45 m.
test("an office chair with a headrest keeps its estimated height", () => {
  const r = resolveSize({ category: "chair", dimension_text: null, estimate_m: { w: 0.7, d: 0.7, h: 1.3 } });
  assert.deepEqual(r.size, [0.7, 0.7, 1.3]);
  assert.equal(r.size_source, "vision_estimate");
  assert.equal(resolveSize({ category: "chair", estimate_m: { w: 0.5, d: 0.5, h: 2.4 } }).size[2], 1.5);
});

// Astra checks its own work (look.mjs). Zoopla: a whole-room check said "not visible, can't compare" for 7 models
// and all 7 were rebuilt. Only "wrong" rebuilds, twice at most.
test("look check: only a wrong model is rebuilt, twice at most; can't-tell changes nothing", async () => {
  const { decide } = await import("./look.mjs");
  assert.deepEqual(decide({ rebuilds: 0 }, { verdict: "wrong", issues: "Add the wall cabinets.", color: "#C9A77B" }), { rebuild: "Add the wall cabinets.", color: "#c9a77b" });
  assert.deepEqual(decide({ rebuilds: 2 }, { verdict: "wrong", issues: "Add the wall cabinets.", color: null }), { rebuild: null, color: null });
  assert.deepEqual(decide({}, { verdict: "cant_tell", issues: "Not visible.", color: "#ffffff" }), { rebuild: null, color: null });
  assert.deepEqual(decide({}, { verdict: "matches", issues: "", color: null }), { rebuild: null, color: null });
});
