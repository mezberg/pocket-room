// A vision reading -> a rectangular room.json. All the arithmetic is here.
// Frame: the first photo's camera stands at the south wall looking north. x east (right), y north (away).
import { REFS, DEFAULT_SIZE } from "./refs.mjs";

const r3 = (v) => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
};
const metres = (m) => (m && REFS[m.ref] && m.multiples > 0 ? REFS[m.ref] * m.multiples : null);

const LIMITS = { width: [1.5, 40], depth: [1.5, 40], height: [2.1, 10] };
const FALLBACK = { width: 4, depth: 4, height: 2.4 };

/** One extent: median of the readings of the seen span, scaled up by how much of the room was seen. */
export function extentFrom(e, key, known) {
  if (known > 0) return { m: known, err: 0.05, from: ["given"] };
  const vals = (e?.measures || []).map((m) => ({ m, v: metres(m) })).filter((x) => x.v);
  if (!vals.length) return { m: FALLBACK[key], err: FALLBACK[key] / 2, from: ["default"] };
  const seen = clamp(e.seen_fraction || 1, 0.25, 1);
  const vs = vals.map((x) => x.v);
  const m = clamp(median(vs) / seen, ...LIMITS[key]);
  // rough error: half the spread of the readings, plus half of the part of the room nobody saw
  const err = Math.max(0.15, (Math.max(...vs) - Math.min(...vs)) / 2 / seen + (m * (1 - seen)) / 2);
  return { m, err, from: vals.map(({ m: r, v }) => `${r.multiples} x ${r.ref} = ${r3(v)} m (${r.note})`), seen_fraction: seen };
}

const FACING = { camera: 0, right: 90, away: 180, left: 270 };

/**
 * reading: from read.mjs. opts: { id, name, known: { width_m, depth_m, height_m } } (measured by hand, optional).
 */
export function roomFromReading(reading, { id = `photo-${Date.now().toString(36)}`, name, known = {} } = {}) {
  const W = extentFrom(reading.width, "width", known.width_m);
  const L = extentFrom(reading.depth, "depth", known.depth_m);
  const Hh = extentFrom(reading.height, "height", known.height_m);
  const w = W.m, l = L.m, h = Hh.m;

  // CCW from above: south (near), east (right), north (far), west (left)
  const walls = [
    { id: "south", a: [0, 0], b: [w, 0], openings: [] },
    { id: "east", a: [w, 0], b: [w, l], openings: [] },
    { id: "north", a: [w, l], b: [0, l], openings: [] },
    { id: "west", a: [0, l], b: [0, 0], openings: [] },
  ];
  const byView = { near: walls[0], right: walls[1], far: walls[2], left: walls[3] };
  const count = {};
  for (const o of reading.openings || []) {
    const wall = byView[o.wall];
    if (!wall) continue;
    const len = Math.hypot(wall.b[0] - wall.a[0], wall.b[1] - wall.a[1]);
    const width = clamp(metres(o.width) ?? (o.kind === "window" ? 1.2 : 0.82), 0.4, len);
    // centre as a distance from wall end a. "center" runs left->right on near/far, camera->far on left/right.
    const c = clamp(o.center, 0, 1);
    const fromA = { near: c * len, right: c * len, far: (1 - c) * len, left: (1 - c) * len }[o.wall];
    const n = (count[o.kind] = (count[o.kind] || 0) + 1);
    const op = { id: `${o.kind}_${n}`, kind: o.kind, from: r3(clamp(fromA - width / 2, 0, len - width)), width: r3(width) };
    const head = o.head_frac != null ? clamp(o.head_frac, 0.3, 1) * h : o.kind === "window" ? Math.min(2.1, h) : Math.min(2.04, h);
    op.head = r3(head);
    if (o.kind === "window") op.sill = r3(o.sill_frac != null ? clamp(o.sill_frac, 0, 0.9) * h : 0.9);
    if (o.kind === "door" || o.kind === "glazed_door") op.swing = null;   // a photo can't tell which way it opens
    wall.openings.push(op);
  }

  const ids = {};
  const items = (reading.objects || []).slice(0, 30).map((o) => {
    const cat = DEFAULT_SIZE[o.category] ? o.category : "other";
    const [dw, dd, dh0] = DEFAULT_SIZE[cat];
    const dh = dh0 ?? h;
    const width = clamp(metres(o.length) ?? dw, 0.2, Math.max(w, l));
    const rot = FACING[o.facing] ?? 0;
    // keep the footprint inside the walls
    const [fx, fy] = rot % 180 === 0 ? [width, dd] : [dd, width];
    const at = [clamp(o.x * w, fx / 2, Math.max(fx / 2, w - fx / 2)), clamp(o.y * l, fy / 2, Math.max(fy / 2, l - fy / 2))];
    const base = (o.name || cat).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || cat;
    ids[base] = (ids[base] || 0) + 1;
    return {
      id: ids[base] > 1 ? `${base}_${ids[base]}` : base, name: (o.name || cat) + (o.count > 1 ? ` x${o.count}` : ""), category: cat,
      at: at.map(r3), size: [width, dd, dh].map(r3), rot, on_floor: cat !== "rug",
    };
  });

  return {
    id, name: name || `${reading.room_type || "Room"} (from photo)`,
    source: "photo",
    accuracy_m: r3(Math.max(W.err, L.err)),   // 0.15 when the photos show the room wall to wall
    height: r3(h), glb: null,
    walls: walls.map((x) => ({ ...x, a: x.a.map(r3), b: x.b.map(r3) })),
    fixtures: items.filter((i) => i.category === "column"),
    furniture: items.filter((i) => i.category !== "column"),
    lights: [],
    style: { tags: reading.style?.tags || [], colors: (reading.style?.colors || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)) },
    _derived: { width: { ...W, m: r3(w), err: r3(W.err) }, depth: { ...L, m: r3(l), err: r3(L.err) }, height: { ...Hh, m: r3(h), err: r3(Hh.err) }, caveats: reading.caveats || [] },
  };
}
