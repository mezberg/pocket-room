// What the app sends and hides for a placed piece. Pure functions (no DOM, no three.js), tested in node.

// The spot on show: the one the reader stepped to, else the placement's best.
export const spotOf = (placement, i = 0) => placement?.spots?.[i] ?? placement?.best ?? null;

// The new piece standing in its spot, as a room item.
export function placedPiece(piece, spot) {
  if (!piece || !spot) return null;
  return { ...piece, at: spot.at, rot: spot.rot ?? 0, on_floor: true };
}

// Room items the viewer hides while this spot is on show: the piece the spot replaces.
export const hiddenIds = (spot) => (spot?.replaces ? [spot.replaces] : []);

// The room as it would be with the piece in its spot: the replaced item taken out, the piece put in.
export function roomWithPiece(room, piece, spot) {
  const out = structuredClone(room);
  const placed = placedPiece(piece, spot);
  if (!placed) return out;
  const gone = new Set(hiddenIds(spot));
  out.furniture = (out.furniture ?? []).filter((f) => !gone.has(f.id) && f.id !== placed.id);
  out.furniture.push({ id: placed.id, name: placed.name, category: placed.category, at: placed.at, size: placed.size, rot: placed.rot, on_floor: true });
  return out;
}

// POST /api/analyse body. A stored room goes by id (the server's room store resolves it, takes the
// replaced item out and puts the piece in); a room the server doesn't keep goes whole.
export function analyseBody(room, piece, spot, { saved = true } = {}) {
  const body = { roomId: room.id };
  if (!saved) body.room = room;
  const placed = placedPiece(piece, spot);
  if (placed) {
    body.piece = { id: placed.id, name: placed.name, category: placed.category, size: placed.size, at: placed.at, rot: placed.rot,
      style: placed.style, source: placed.source?.image?.startsWith("https:") ? { image: placed.source.image } : undefined };
    if (spot.replaces) body.replaces = spot.replaces;
  }
  return body;
}

// POST /api/place body: the room id, plus the room itself when the server doesn't keep it.
export function placeBody(room, piece, { saved = true } = {}) {
  const body = { roomId: room.id, piece };
  if (!saved) body.room = room;
  return body;
}

// A design finding's probability in plain words: the chance there is a problem (p is the chance it's fine).
export function chanceWords(f) {
  if (f.kind !== "design" || f.probability == null) return "";
  const p = Math.max(0, Math.min(1, f.probability));
  if (f.pass) return `looks right, ${Math.round(p * 100)}% sure`;
  const q = 1 - p;
  return `${q >= 0.75 ? "very likely" : "likely"} a problem, ${Math.round(q * 100)}% sure`;
}

// "1.60 × 0.45 × 0.70 m" → in cm for cards: "160 × 45 × 70 cm"
export const sizeCm = (s) => `${s.map((v) => Math.round(v * 100)).join(" × ")} cm`;
