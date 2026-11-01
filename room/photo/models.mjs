// The room's own furniture as 3D models. The reading says which photo shows each object, its box in that photo
// and what it looks like (_derived.objects). Code crops the photo around it and astra (furniture/astra3d.mjs)
// rebuilds it from the crop at the size code computed: a piece linked from the item (`item.piece`). The room is
// ready at once with kit stand-ins; each model swaps in when it is built (the app polls the piece).
// The photos are kept (out/) for the look check (look.mjs).
import sharp from "sharp";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "out");
// worth a model: what you'd recognise the room by. Smaller things stay kit pieces.
const MODELLED = new Set(["sofa", "armchair", "cupboard", "shelf", "bed", "table", "desk", "tv"]);
export const MAX_MODELS = 8;

const bytes = (url) => Buffer.from(url.split(",")[1], "base64");
export const photoFile = (roomId, n) => join(OUT, `${roomId}-${n}.jpg`);

export function savePhotos(roomId, images) {
  mkdirSync(OUT, { recursive: true });
  images.forEach((url, i) => { if (url.startsWith("data:")) writeFileSync(photoFile(roomId, i + 1), bytes(url)); });
}
export const photoOf = (roomId, n) => (existsSync(photoFile(roomId, n)) ? `data:image/jpeg;base64,${readFileSync(photoFile(roomId, n)).toString("base64")}` : null);

/** The object's box in its photo, padded a little, as a JPEG data URL (≤ 1024 px). */
export async function crop(image, box, pad = 0.06) {
  const img = sharp(bytes(image));
  const { width: W, height: H } = await img.metadata();
  const l = Math.max(0, Math.min(box.left, box.right) - pad), r = Math.min(1, Math.max(box.left, box.right) + pad);
  const t = Math.max(0, Math.min(box.top, box.bottom) - pad), b = Math.min(1, Math.max(box.top, box.bottom) + pad);
  const left = Math.round(l * W), top = Math.round(t * H);
  const width = Math.max(16, Math.min(W - left, Math.round((r - l) * W))), height = Math.max(16, Math.min(H - top, Math.round((b - t) * H)));
  const out = await img.extract({ left, top, width, height }).resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

/** What astra is told about one room item. */
export function notesFor(item, seen) {
  const chaise = /_chaise$/.test(item.id), L = /sectional|l-shaped|corner/i.test(item.name);
  return `This is a crop of a photo of a whole room: model only the ${item.name.toLowerCase()} (centre of the crop), nothing around it.` +
    ` It looks like: ${seen.look || "as in the photo"}.` +
    (chaise ? " Model only the chaise end of this L-shaped sofa (the part that runs forward), not the long back section." : "") +
    (L && !chaise ? " Model only the long back section of this L-shaped sofa; the chaise end is a separate model." : "") +
    (/^kitchen/i.test(item.name) ? " A fitted kitchen run: base cabinets with their doors and drawers, worktop, splashback, wall cabinets above, handles, sink and hob if visible. Width runs along the wall." : "");
}

/**
 * Start a model for each big item the photos show. images: the data URLs the room was built from.
 * createPiece: furniture/pieces.mjs createPieceForItem (injected for tests). Sets item.piece; returns the ids.
 */
export async function startRoomModels(room, images, { createPiece } = {}) {
  const seenIn = room._derived?.objects ?? {};
  const items = room.furniture.filter((i) => MODELLED.has(i.category) && seenIn[i.id.replace(/_chaise$/, "")] && images[(seenIn[i.id.replace(/_chaise$/, "")].photo || 1) - 1])
    .sort((a, b) => b.size[0] * b.size[1] - a.size[0] * a.size[1]).slice(0, MAX_MODELS);
  const started = [];
  for (const item of items) {
    const seen = seenIn[item.id.replace(/_chaise$/, "")];
    try {
      const image = await crop(images[(seen.photo || 1) - 1], seen.box);
      const piece = createPiece(item, { image, notes: notesFor(item, seen) });
      item.piece = piece.id;
      started.push(piece.id);
    } catch (e) { console.error(`room ${room.id}: no model for ${item.id}:`, e.message); }
  }
  return started;
}
