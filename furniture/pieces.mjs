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

async function build(piece, image, route) {
  const t0 = Date.now();
  try {
    let doc;
    if (route === "astra") doc = (await astraBuild(image, piece)).doc;
    else doc = await fromGLB((await meshyBuild(image)).bytes);
    const glb = await writeModel(piece.id, doc, piece.size);
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
