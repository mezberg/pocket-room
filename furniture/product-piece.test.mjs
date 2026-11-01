// A "Find for me" piece → kept under its id, built from the product picture like a pasted link.
// No network: the picture fetch and the image-to-3D model are fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.PIECES_OUT = mkdtempSync(join(tmpdir(), "pieces-"));
const { registerProductPiece, getPiece, modelFile, imageFile } = await import("./pieces.mjs");
const { pictureData } = await import("./link.mjs");
const { partsToDocument } = await import("./glb.mjs");

const KIT = { template: "sofa", args: { w: 2.1 } };
const agentPiece = (id, size = [2.1, 0.9, 0.8]) => ({
  id, category: "sofa", name: "Test 3-seat sofa", size, size_source: "product_page",
  source: { kind: "agent", image: "https://img.example/sofa.jpg", url: "https://shop.example/sofa", shop: "IKEA" },
  model: { status: "ready", how: "parametric", glb: null, job: null, parametric: KIT },
  agent: { reason: "fits", fit: { verdict: "Fits" } },
});
const JPEG = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff]).toString("base64");
const box = () => partsToDocument([
  { name: "seat", shape: "box", size: [2, 0.4, 0.9], pos: [0, 0.2, 0], rot: [0, 0, 0], color: "#cccccc", radius: 0 },
  { name: "back", shape: "box", size: [2, 0.4, 0.2], pos: [0, 0.6, -0.35], rot: [0, 0, 0], color: "#bbbbbb", radius: 0 },
  { name: "arm", shape: "box", size: [0.2, 0.6, 0.9], pos: [0.9, 0.3, 0], rot: [0, 0, 0], color: "#aaaaaa", radius: 0 },
]);
const until = async (id, ok) => { for (let i = 0; i < 200 && !ok(getPiece(id)); i++) await new Promise((r) => setTimeout(r, 10)); return getPiece(id); };

test("an agent piece builds from its product picture: building → ready with a GLB, sizes kept", async () => {
  const seen = [];
  const make = async (image, piece) => { seen.push({ image, size: piece.size }); return box(); };
  const p = registerProductPiece(agentPiece("agent-t1"), { picture: async () => JPEG, make });
  assert.equal(p.model.status, "building");
  assert.equal(p.model.how, "image_to_3d");
  assert.deepEqual(p.model.parametric, KIT, "the kit piece stands in");
  assert.equal(getPiece("agent-t1").model.status, "building", "GET /api/pieces/:id finds it at once");
  const done = await until("agent-t1", (x) => x.model.status !== "building");
  assert.equal(done.model.status, "ready");
  assert.equal(done.model.glb, "/api/pieces/agent-t1/model.glb");
  assert.ok(existsSync(modelFile("agent-t1")) && existsSync(imageFile("agent-t1")));
  assert.deepEqual(done.size, [2.1, 0.9, 0.8], "size from the product page, never from the model");
  assert.equal(done.source.image_url, "https://img.example/sofa.jpg");
  assert.equal(done.agent.reason, "fits");
  assert.equal(seen[0].image, JPEG);
});

test("the same product at the same size reuses the model; a new size rebuilds", async () => {
  let builds = 0;
  const make = async () => { builds++; return box(); };
  registerProductPiece(agentPiece("agent-t2"), { picture: async () => JPEG, make });
  await until("agent-t2", (x) => x.model.status === "ready");
  const again = registerProductPiece(agentPiece("agent-t2"), { picture: async () => JPEG, make });
  assert.equal(again.model.status, "ready");
  assert.equal(builds, 1);
  const bigger = registerProductPiece(agentPiece("agent-t2", [2.3, 0.9, 0.8]), { picture: async () => JPEG, make });
  assert.equal(bigger.model.status, "building");
  await until("agent-t2", (x) => x.model.status === "ready");
  assert.equal(builds, 2);
});

test("no product picture: the kit piece stays, sized right", async () => {
  registerProductPiece(agentPiece("agent-t3"), { picture: async () => null, make: async () => box() });
  const p = await until("agent-t3", (x) => x.model.status !== "building");
  assert.equal(p.model.status, "ready");
  assert.equal(p.model.how, "parametric");
  assert.deepEqual(p.model.parametric, KIT);
});

test("the picture is asked for as JPEG / PNG / WebP, and AVIF is refused", async () => {
  let accept;
  const avif = async (url, opts) => { accept = opts.headers.accept; return new Response(Buffer.from([1, 2]), { headers: { "content-type": "image/avif" } }); };
  assert.equal(await pictureData("https://img.example/a", { fetch: avif }), null);
  assert.doesNotMatch(accept, /avif/);
  assert.match(accept, /image\/jpeg/);
});
