// Picture → piece.json → model. Order for the model: a GLB we already have (library/) → a parametric kit
// piece → image-to-3D (async: model.status building → ready). Pieces and GLBs are kept under out/.
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPicture } from "./vision.mjs";
import { resolveSize } from "./sizes.mjs";
import { kitFor } from "./parametric.mjs";
import { astraBuild, model3d } from "./astra3d.mjs";
import { meshyAvailable, meshyBuild } from "./meshy.mjs";
import { normalise, toGLB, fromGLB } from "./glb.mjs";
import { pictureData } from "./link.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
export const OUT = process.env.PIECES_OUT ?? join(HERE, "out");
const LIB = join(HERE, "library");
for (const d of ["pieces", "models", "images"]) mkdirSync(join(OUT, d), { recursive: true });

const pieces = new Map();
const pieceFile = (id) => join(OUT, "pieces", `${id}.json`);
export const modelFile = (id) => join(OUT, "models", `${id}.glb`);
export const imageFile = (id) => join(OUT, "images", `${id}`);
const save = (p) => { pieces.set(p.id, p); writeFileSync(pieceFile(p.id), JSON.stringify(p, null, 2)); return p; };

export function getPiece(id) {
  if (pieces.has(id)) return pieces.get(id);
  if (/^[\w-]+$/.test(id) && existsSync(pieceFile(id))) { const p = JSON.parse(readFileSync(pieceFile(id), "utf8")); pieces.set(id, p); return p; }
  return null;
}

// Which image-to-3D route is on: astra (OpenAI) when OPENAI_MODEL_3D is set, Meshy when its key is set.
export function imageTo3dRoute() {
  const want = process.env.PIECES_IMAGE_TO_3D;
  if (want === "meshy" && meshyAvailable()) return "meshy";
  if (want === "off") return null;
  if (model3d()) return "astra";
  return meshyAvailable() ? "meshy" : null;
}

// ------------------------------------------------------------------ library match
// library/manifest.json: [{ id, category, tags: [], glb: "file.glb" }]. A match needs the same category
// and at least two style tags in common (one of them the most specific: chesterfield, boucle, ...).
export function libraryMatch(piece) {
  const file = join(LIB, "manifest.json");
  if (!existsSync(file)) return null;
  const tags = new Set((piece.style?.tags ?? []).map(t => t.toLowerCase()));
  let best = null;
  for (const e of JSON.parse(readFileSync(file, "utf8"))) {
    if (e.category !== piece.category) continue;
    const common = e.tags.filter(t => tags.has(t.toLowerCase()));
    if (common.length >= 2 && (!e.must || tags.has(e.must)) && (!best || common.length > best.common)) best = { ...e, common: common.length };
  }
  return best;
}

async function writeModel(id, doc, size, opts) {
  await normalise(doc, size, opts);
  writeFileSync(modelFile(id), await toGLB(doc));
  return `/api/pieces/${id}/model.glb`;
}

// ------------------------------------------------------------------ create
// mode: "auto" (library → parametric if the kit fits well → image-to-3D), "parametric", "image_to_3d"
export async function createPiece({ image, kind = "photo", hint, mode = "auto" }, { read: readFn = readPicture } = {}) {
  if (!/^data:image\/|^https?:\/\//.test(image ?? "")) throw Object.assign(new Error("image must be a data URL or http(s) URL"), { status: 400 });
  const id = randomUUID().slice(0, 8);
  const t0 = Date.now();
  const read = await readFn(image, { kind, hint });
  if (!read.is_furniture) throw Object.assign(new Error("No furniture found in the picture"), { status: 422 });

  const { size, size_source, size_text } = resolveSize(read);
  let imageUrl = image;
  if (image.startsWith("data:")) {
    writeFileSync(imageFile(id), Buffer.from(image.split(",")[1], "base64"));
    imageUrl = `/api/pieces/${id}/image`;
  }
  const piece = {
    id, category: read.category, name: read.name, size, size_source, size_text,
    style: { tags: read.style_tags, colors: read.colors, material: read.material },
    source: { kind, image: imageUrl, url: read.url, price: read.price, shop: read.shop },
    model: { status: "pending" },
    timing: { read_ms: Date.now() - t0 },
  };

  const kit = kitFor(piece, read);
  const lib = mode === "auto" ? libraryMatch(piece) : null;
  const route = imageTo3dRoute();
  if (lib) {
    const doc = await fromGLB(readFileSync(join(LIB, lib.glb)));
    piece.model = { status: "ready", how: "db_match", glb: await writeModel(id, doc, size), parametric: kit, job: null, matched: lib.id };
  } else if (kit && mode !== "image_to_3d" && (mode === "parametric" || read.kit_fit === "good" || !route)) {
    piece.model = { status: "ready", how: "parametric", glb: null, parametric: kit, job: null };
  } else if (route) {
    // the kit piece (if any) stands in while the mesh builds
    piece.model = { status: "building", how: "image_to_3d", glb: null, parametric: kit, job: `${route}:${id}` };
    build(piece, image, route);
  } else {
    piece.model = { status: "failed", how: null, glb: null, parametric: null, job: null, error: "no kit template and no image-to-3D route" };
  }
  return save(piece);
}

// A piece whose facts are already known (a product page read by link.mjs): no picture read. The kit piece
// stands in at once; if there is a picture and an image-to-3D route, the mesh builds in the background.
export async function createPieceFromFacts(facts, { image, kitRead = {} } = {}) {
  const id = randomUUID().slice(0, 8);
  const piece = { id, ...facts, model: { status: "pending" }, timing: { read_ms: facts.timing?.read_ms ?? 0 } };
  let src = image;
  if (image?.startsWith("data:")) {
    writeFileSync(imageFile(id), Buffer.from(image.split(",")[1], "base64"));
    piece.source = { ...piece.source, image: `/api/pieces/${id}/image`, image_url: facts.source?.image ?? null };
  }
  const kit = kitFor(piece, kitRead);
  const route = src ? imageTo3dRoute() : null;
  if (route) {
    piece.model = { status: "building", how: "image_to_3d", glb: null, parametric: kit, job: `${route}:${id}` };
    build(piece, src, route);
  } else if (kit) {
    piece.model = { status: "ready", how: "parametric", glb: null, parametric: kit, job: null };
  } else {
    piece.model = { status: "failed", how: null, glb: null, parametric: null, job: null, error: "no kit template and no picture" };
  }
  return save(piece);
}

// A piece that already has its id and facts: a "Find for me" result (agent/find.mjs), sizes read off the
// product page, the kit piece in model.parametric. Same path as a pasted link: kept under its own id so
// GET /api/pieces/:id serves it, and the mesh builds from the product picture in the background (the kit
// piece stands in). The same product at the same size reuses the model built before: no second build.
// The picture is fetched as JPEG / PNG / WebP (shops send AVIF otherwise), in a build slot, so the find
// answer isn't held up by it.
const live = new Set();   // ids building in this process
export function registerProductPiece(piece, { picture = pictureData, make } = {}) {
  const old = getPiece(piece.id);
  const same = old && sameSize(old.size, piece.size);
  if (same && (live.has(piece.id) || (old.model?.status === "ready" && old.model.how === "image_to_3d" && old.model.glb))) {
    return save({ ...piece, source: old.source, model: old.model, timing: old.timing });
  }
  const route = piece.source?.image ? (make ? "test" : imageTo3dRoute()) : null;
  if (!route) return save(piece);
  const kit = piece.model?.parametric ?? null;
  const p = save({ ...piece, model: { status: "building", how: "image_to_3d", glb: null, parametric: kit, job: `${route}:${piece.id}` } });
  live.add(p.id);
  slot(async () => {
    const t0 = Date.now();
    const image = await picture(piece.source.image);
    if (!image) {
      console.error(`piece ${p.id}: no product picture from ${piece.source.image}`);
      return save({ ...p, model: kit ? { ...p.model, status: "ready", how: "parametric", error: "no product picture" } : { ...p.model, status: "failed", error: "no product picture" } });
    }
    writeFileSync(imageFile(p.id), Buffer.from(image.split(",")[1], "base64"));
    const withImage = save({ ...p, source: { ...p.source, image: `/api/pieces/${p.id}/image`, image_url: piece.source.image }, timing: { ...p.timing, picture_ms: Date.now() - t0 } });
    await build(withImage, image, route, make);
  }).catch((err) => console.error(`piece ${p.id}:`, err.message)).finally(() => live.delete(p.id));
  return p;
}
const sameSize = (a = [], b = []) => a.length === 3 && a.every((v, i) => Math.abs(v - b[i]) < 0.005);

// At most three image-to-3D builds at once (cost and rate limits); the rest wait their turn.
const BUILD_SLOTS = 3;
let running = 0;
const waiting = [];
function slot(job) {
  return new Promise((resolve, reject) => {
    const go = () => { running++; job().then(resolve, reject).finally(() => { running--; waiting.shift()?.(); }); };
    running < BUILD_SLOTS ? go() : waiting.push(go);
  });
}

async function build(piece, image, route, make) {
  const t0 = Date.now();
  try {
    let doc;
    if (make) doc = await make(image, piece);
    else if (route === "astra") doc = (await astraBuild(image, piece)).doc;
    else doc = await fromGLB((await meshyBuild(image)).bytes);
    const glb = await writeModel(piece.id, doc, piece.size);
    console.log(`piece ${piece.id}: ${route} model ready in ${((Date.now() - t0) / 1000).toFixed(1)} s (${piece.name})`);
    save({ ...piece, model: { ...piece.model, status: "ready", glb }, timing: { ...piece.timing, model_ms: Date.now() - t0 } });
  } catch (err) {
    console.error(`piece ${piece.id}: ${route} failed:`, err.message);
    const fallback = piece.model.parametric
      ? { ...piece.model, status: "ready", how: "parametric", error: err.message }
      : { ...piece.model, status: "failed", error: err.message };
    save({ ...piece, model: fallback, timing: { ...piece.timing, model_ms: Date.now() - t0 } });
  }
}

export const listPieces = () => readdirSync(join(OUT, "pieces")).filter(f => f.endsWith(".json")).map(f => getPiece(f.slice(0, -5)));
