// The server calls (contract/api.md). JSON in, JSON out.
async function call(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${method} ${path}: ${res.status}`);
  return data;
}

export const api = {
  room: (id) => call("GET", `/rooms/${encodeURIComponent(id)}`),
  rooms: () => call("GET", "/rooms"),                            // { rooms: [{ id, name, source }], from_plan }
  fromPhoto: (images, hint, name) => call("POST", "/rooms/from-photo", { images, hint, name }),
  fromPlan: (image, room, name) => call("POST", "/rooms/from-plan", { image, room, name }),
  resizeRoom: (id, body) => call("PATCH", `/rooms/${encodeURIComponent(id)}`, body),   // { width_m?, depth_m?, name? }
  keepRoom: (room) => call("PUT", `/rooms/${encodeURIComponent(room.id)}`, room),      // put back after a server restart
  newPiece: (image, kind = "photo", hint) => call("POST", "/pieces", { image, kind, hint }),
  fromLink: (url) => call("POST", "/pieces/from-link", { url }),
  piece: (id) => call("GET", `/pieces/${encodeURIComponent(id)}`),
  pieceLook: (id, view) => call("POST", `/pieces/${encodeURIComponent(id)}/look`, { view }),   // astra checks its model against its picture
  find: (body) => call("POST", "/agent/find", body),            // { roomId, query, wall?, room? }
  place: (body) => call("POST", "/place", body),                // { roomId, piece, room? } (scene-state.js placeBody)
  analyse: (body) => call("POST", "/analyse", body),            // { roomId, piece?, replaces?, room? } (analyseBody)
  plan: (body) => call("POST", "/plan", body),                  // { roomId, piece, room? } → plans (designer/)
  advice: (body) => call("POST", "/advice", body),              // { roomId, findings, room? } → { ranked } (designer/)
  fixes: (body) => call("POST", "/fixes", body),                // { roomId, piece?, replaces?, room?, finding } (fix-state.js fixBody)
  relayout: (body) => call("POST", "/relayout", body),          // { roomId, piece?, room?, finding? } → plans (relayout/)
  render: (roomId, view, prompt) => call("POST", "/render", { roomId, view, prompt }),
};

// poll a piece until its model is ready or failed; onTick(piece) each time
export async function untilBuilt(piece, onTick, { every = 1500, timeout = 180000 } = {}) {
  const t0 = Date.now();
  while (piece.model?.status === "building" || piece.model?.status === "pending") {
    if (Date.now() - t0 > timeout) throw new Error("The 3D model is taking too long.");
    await new Promise((r) => setTimeout(r, every));
    piece = await api.piece(piece.id);
    onTick?.(piece);
  }
  if (piece.model?.status === "failed") throw new Error("The 3D model failed to build.");
  return piece;
}

// a photo as a JPEG data URL, longest side at most max px (phone photos are 4000+ px)
export async function imageToDataURL(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k);
  c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return c.toDataURL("image/jpeg", 0.86);
}

// a file as it is, as a data URL (plans: keep every line, and the server's cache knows the same file)
export async function fileAsDataURL(file) {
  return new Promise((ok, no) => {
    const r = new FileReader();
    r.onload = () => ok(r.result);
    r.onerror = () => no(r.error);
    r.readAsDataURL(file);
  });
}
