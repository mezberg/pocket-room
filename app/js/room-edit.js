// New-room edits in code, no model call: resize a built room, take out a wrong object, read a typed length,
// say how sure the size is. Pure functions (no DOM, no three.js), tested in node.

const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export const LIMITS = { width: [1.5, 40], depth: [1.5, 40], height: [2.1, 10] };

// the plan's bounding box: x0..x1 (west → east), y0..y1 (south → north)
export function bounds(room) {
  const xs = room.walls.flatMap((w) => [w.a[0], w.b[0]]), ys = room.walls.flatMap((w) => [w.a[1], w.b[1]]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return { x0, y0, W: x1 - x0, D: y1 - y0 };
}

export function dims(room) {
  const { W, D } = bounds(room);
  return { width: r3(W), depth: r3(D), height: r3(room.height ?? 2.4) };
}

const len = (w) => Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]);

/**
 * The room stretched to a new width (x), depth (y) and height. Walls scale about the south-west corner;
 * doors and windows keep their own width and slide with their wall's centre; furniture keeps its size and its
 * place as a share of the room, kept inside the walls. Columns stay floor to ceiling.
 * `measured`: which of width / depth were taped (accuracy then tightens, see accuracyOf).
 */
export function resizeRoom(room, { width, depth, height } = {}, { measured } = {}) {
  const out = structuredClone(room);
  const b = bounds(room);
  const W = clamp(width ?? b.W, ...LIMITS.width), D = clamp(depth ?? b.D, ...LIMITS.depth);
  const H0 = room.height ?? 2.4, H = clamp(height ?? H0, ...LIMITS.height);
  const sx = W / b.W, sy = D / b.D, sh = H / H0;
  const px = (p) => [r3(b.x0 + (p[0] - b.x0) * sx), r3(b.y0 + (p[1] - b.y0) * sy)];

  out.walls = room.walls.map((w) => {
    const L0 = len(w);
    const nw = { ...w, a: px(w.a), b: px(w.b) };
    const L = len(nw), k = L0 > 0 ? L / L0 : 1;
    nw.openings = (w.openings ?? []).map((o) => {
      const width = Math.min(o.width, L);
      const c = (o.from + o.width / 2) * k;
      const op = { ...o, width: r3(width), from: r3(clamp(c - width / 2, 0, L - width)) };
      // windows were read as shares of the wall's height; doors are door height, under the ceiling
      if (o.kind === "window") {
        if (o.sill != null) op.sill = r3(o.sill * sh);
        if (o.head != null) op.head = r3(Math.min(o.head * sh, H));
      } else if (o.head != null) op.head = r3(Math.min(o.head, H));
      return op;
    });
    return nw;
  });

  const move = (it) => {
    const quarter = Math.round((it.rot ?? 0) / 90) % 2 !== 0;
    const [fx, fy] = quarter ? [it.size[1], it.size[0]] : [it.size[0], it.size[1]];
    const [x, y] = px(it.at);
    const at = [r3(clamp(x, b.x0 + fx / 2, Math.max(b.x0 + fx / 2, b.x0 + W - fx / 2))),
                r3(clamp(y, b.y0 + fy / 2, Math.max(b.y0 + fy / 2, b.y0 + D - fy / 2)))];
    const tall = Math.abs(it.size[2] - H0) < 0.01;   // floor to ceiling (columns, full-height cupboards)
    return { ...it, at, size: tall ? [it.size[0], it.size[1], r3(H)] : it.size };
  };
  out.furniture = (room.furniture ?? []).map(move);
  out.fixtures = (room.fixtures ?? []).map(move);
  out.height = r3(H);

  // the arithmetic behind the size, with what the reader changed. `measured` (when given) is the full list of
  // taped sides now: a side taken off it goes back to the photo's own error.
  const d = structuredClone(room._derived ?? {});
  const was = { width: b.W, depth: b.D, height: H0 }, now = { width: W, depth: D, height: H };
  for (const key of ["width", "depth", "height"]) {
    const e = (d[key] = { ...(d[key] ?? {}) });
    if (Math.abs(now[key] - was[key]) > 1e-6) Object.assign(e, { m: r3(now[key]), adjusted: true });
    if (!measured) continue;
    const taped = isMeasured(e);
    if (measured.includes(key) && !taped) Object.assign(e, { read_err: e.err, err: 0.05, from: ["measured"] });
    else if (!measured.includes(key) && taped && e.read_err != null) Object.assign(e, { err: e.read_err, from: ["photo"] });
  }
  out._derived = d;
  out.accuracy_m = accuracyOf(out);
  return out;
}

// a side someone taped: typed in the app, or sent to the photo route as a hint
export const isMeasured = (e) => ["measured", "given"].includes(e?.from?.[0]);

/** Are both floor sides taped? */
export const bothMeasured = (room) => isMeasured(room._derived?.width) && isMeasured(room._derived?.depth);

// How sure the floor size is: the larger of the width and depth errors. A taped wall is ±5 cm.
// Rooms without the arithmetic (prebuilt, plans) keep their own figure.
export function accuracyOf(room) {
  const d = room._derived;
  if (!d?.width?.err && !d?.depth?.err) return room.accuracy_m;
  return r3(Math.max(d.width?.err ?? room.accuracy_m ?? 0.15, d.depth?.err ?? room.accuracy_m ?? 0.15));
}

/** The room without one object (a chair the photo read wrong). */
export function removeItem(room, id) {
  const out = structuredClone(room);
  out.furniture = (out.furniture ?? []).filter((f) => f.id !== id);
  out.fixtures = (out.fixtures ?? []).filter((f) => f.id !== id);
  return out;
}

/**
 * A typed length in metres, or null. unit "m": "4.2", "4,2", "420cm". unit "ft": "13", "13.5", "13' 6\"",
 * "13ft 6in", "13 6" (feet then inches). An explicit unit in the text wins.
 */
export function parseLength(text, unit = "m") {
  const s = String(text ?? "").trim().toLowerCase().replace(",", ".");
  if (!s) return null;
  let m;
  if ((m = /^(\d+(?:\.\d+)?)\s*cm$/.exec(s))) return pos(+m[1] / 100);
  if ((m = /^(\d+(?:\.\d+)?)\s*mm$/.exec(s))) return pos(+m[1] / 1000);
  if ((m = /^(\d+(?:\.\d+)?)\s*m$/.exec(s))) return pos(+m[1]);
  const ft = /^(\d+(?:\.\d+)?)\s*(?:'|′|ft|feet|foot)?\s*(?:(\d+(?:\.\d+)?)\s*(?:"|″|in|inch|inches)?)?$/.exec(s);
  const explicitFt = /'|′|ft|feet|foot|"|″|in\b|inch/.test(s);
  if (ft && (unit === "ft" || explicitFt)) {
    const inches = ft[2] != null ? +ft[2] : 0;
    if (inches >= 12) return null;
    return pos((+ft[1] * 12 + inches) * 0.0254);
  }
  if ((m = /^(\d+(?:\.\d+)?)$/.exec(s))) return pos(+m[1]);
  return null;
}
const pos = (v) => (v > 0 && Number.isFinite(v) ? r3(v) : null);

// 3.81 → "12′6″"
export function feetInches(m) {
  const total = Math.round(m / 0.0254);
  return `${Math.floor(total / 12)}′${total % 12}″`;
}

// ±0.15 → "± 15 cm", ±3.2 → "± 3.2 m"
export function plusMinus(acc) {
  if (acc == null) return "";
  return acc < 1 ? `± ${Math.max(1, Math.round(acc * 100))} cm` : `± ${(Math.round(acc * 10) / 10).toFixed(1).replace(/\.0$/, "")} m`;
}

/** How sure, in words, and what would make it surer. level: good | ok | rough. */
export function sureWords(room) {
  const acc = room.accuracy_m;
  if (acc == null) return { level: "good", text: "", nudge: "" };
  const pm = plusMinus(acc);
  if (room.source === "prebuilt") return { level: "good", text: `${pm}, from the plan`, nudge: "" };
  if (acc <= 0.2) return { level: "good", text: `${pm}: good enough to place furniture`, nudge: "" };
  const fromPlan = room.source === "floorplan";
  if (acc <= 0.5) return { level: "ok", text: `${pm}: close`, nudge: fromPlan ? "Type one wall you measured to pin the scale." : "Measure one long wall, or add a photo from another corner, to tighten it." };
  return { level: "rough", text: `${pm}: a rough guess`, nudge: fromPlan ? "Type one wall you measured to pin the scale." : "Most of the room was out of frame. Measure two walls, or add photos from the corners." };
}
