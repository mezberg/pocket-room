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
const OUTLIER = 1.5;

/**
 * One extent. Each reading measures a span that covers some share of the whole extent (its own
 * span_fraction, else the extent's seen_fraction), so it stands for reading / share of the room.
 * One photo: the median of those, and the error is half their spread plus half the unseen part.
 * Several photos (each reading says which photo it is from): each photo gives its median, the room takes
 * the median of the photos, and the error is the spread between photos plus what no photo saw.
 */
export function extentFrom(e, key, known) {
  if (known > 0) return { m: known, err: 0.05, from: ["given"] };
  const share = (r) => clamp(r.span_fraction ?? e.seen_fraction ?? 1, 0.25, 1);
  const all = (e?.measures || []).map((r) => ({ r, v: metres(r), s: share(r) })).filter((x) => x.v);
  if (!all.length) return { m: FALLBACK[key], err: FALLBACK[key] / 2, from: ["default"] };
  // A reading 1.5x off the median of three or more used the wrong reference (a coffee table read as a
  // dining table): drop it rather than let it widen the error or move the median.
  const mid = median(all.map((x) => x.v / x.s));
  const odd = (x) => all.length >= 3 && (x.v / x.s > mid * OUTLIER || x.v / x.s < mid / OUTLIER);
  const vals = all.filter((x) => !odd(x));
  const from = all.map((x) => { const { r, v, s } = x; return `${r.photo ? `photo ${r.photo}: ` : ""}${r.multiples} x ${r.ref} = ${r3(v)} m${s < 1 ? ` of ${Math.round(s * 100)}%` : ""} (${r.note})${odd(x) ? " [dropped: far from the others]" : ""}`; });
  const seen = Math.max(...vals.map((x) => x.s));
  const byPhoto = new Map();
  for (const x of vals) { const k = x.r.photo || 1; byPhoto.set(k, [...(byPhoto.get(k) || []), x]); }
  if (byPhoto.size > 1) {
    const per = [...byPhoto.values()].map((xs) => median(xs.map((x) => x.v / x.s)));
    const m = clamp(median(per), ...LIMITS[key]);
    const spread = (Math.max(...per) - Math.min(...per)) / 2 / Math.sqrt(per.length - 1);
    const err = Math.max(0.1, spread + (m * (1 - seen)) / 2);
    return { m, err, from, seen_fraction: seen, photos: per.map(r3) };
  }
  const full = vals.map((x) => x.v / x.s);
  const m = clamp(median(full), ...LIMITS[key]);
  const err = Math.max(0.15, (Math.max(...full) - Math.min(...full)) / 2 + (m * (1 - seen)) / 2);
  return { m, err, from, seen_fraction: seen };
}

/**
 * Width and depth together. A wall measured by hand wins. When only one is measured, the photo's
 * proportions carry over: the other is scaled by the same factor (the shape is read better than the size).
 */
export function planExtents(reading, known = {}) {
  let W = extentFrom(reading.width, "width", known.width_m);
  let L = extentFrom(reading.depth, "depth", known.depth_m);
  const scaleBy = (E, k, key) => ({ ...E, m: clamp(E.m * k, ...LIMITS[key]), err: Math.max(0.1, (E.err * k) / 2), from: [...E.from, `scaled x${r3(k)} by the measured wall`] });
  if (known.width_m > 0 && !(known.depth_m > 0)) {
    const raw = extentFrom(reading.width, "width");
    if (raw.from[0] !== "default") L = scaleBy(L, known.width_m / raw.m, "depth");
  } else if (known.depth_m > 0 && !(known.width_m > 0)) {
    const raw = extentFrom(reading.depth, "depth");
    if (raw.from[0] !== "default") W = scaleBy(W, known.depth_m / raw.m, "width");
  }
  return { W, L };
}

const FACING = { camera: 0, right: 90, away: 180, left: 270 };
// A cupboard with no height read is a wardrobe (2 m) unless its name says it is low.
const LOW = /\b(low|tv|television|media|sideboard|console|chest|drawers|dresser|credenza|bench)\b/i;
// Photo positions are rough, but not this rough: a piece that needs a longer step to get clear is left
// where it was read (the rules then show the overlap) rather than moved somewhere nobody saw it.
const MAX_STEP = 0.6;

// [[a, b], ...] sorted and merged, clipped to [0, len]
function mergeSpans(spans, len) {
  const out = [];
  for (const [a, b] of spans.map(([a, b]) => [clamp(Math.min(a, b), 0, len), clamp(Math.max(a, b), 0, len)]).filter(([a, b]) => b - a > 0.05).sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 0.05) last[1] = Math.max(last[1], b); else out.push([a, b]);
  }
  return out.map(([a, b]) => [r3(a), r3(b)]);
}

/**
 * What the photos showed: the floor as a rectangle (polygon) and, per wall, the seen spans in metres from a.
 * From the reading's `seen`; an older reading without it falls back to the seen fractions (width centred,
 * depth running back from the far wall, the near wall unseen). Openings were seen, so their spans count.
 * A wall seen end to end gets no `seen` (null here); the floor seen whole gets no floor_seen (undefined).
 */
export function seenParts(reading, walls, w, l, W = {}, L = {}) {
  const f = reading.seen?.floor;
  const sw = clamp(W.seen_fraction ?? reading.width?.seen_fraction ?? 1, 0, 1), sd = clamp(L.seen_fraction ?? reading.depth?.seen_fraction ?? 1, 0, 1);
  const x0 = f ? clamp(Math.min(f.left, f.right), 0, 1) : (1 - sw) / 2, x1 = f ? clamp(Math.max(f.left, f.right), 0, 1) : (1 + sw) / 2;
  const y0 = f ? clamp(Math.min(f.near, f.far), 0, 1) : 1 - sd, y1 = f ? clamp(Math.max(f.near, f.far), 0, 1) : 1;
  const byView = { near: walls[0], right: walls[1], far: walls[2], left: walls[3] };
  const lenOf = (x) => Math.hypot(x.b[0] - x.a[0], x.b[1] - x.a[1]);
  // a fraction along the wall in the openings' convention -> metres from a
  const along = (view, c) => { const len = lenOf(byView[view]); return { near: c * len, right: c * len, far: (1 - c) * len, left: (1 - c) * len }[view]; };
  const raw = { south: [], east: [], north: [], west: [] };
  if (reading.seen?.walls) {
    for (const s of reading.seen.walls) if (byView[s.wall]) raw[byView[s.wall].id].push([along(s.wall, clamp(s.from, 0, 1)), along(s.wall, clamp(s.to, 0, 1))]);
  } else {
    if (y1 >= 0.95) raw.north.push([along("far", x0), along("far", x1)]);
    if (x0 <= 0.05) raw.west.push([along("left", y0), along("left", y1)]);
    if (x1 >= 0.95) raw.east.push([along("right", y0), along("right", y1)]);
    if (y0 <= 0.05) raw.south.push([along("near", x0), along("near", x1)]);
  }
  for (const x of walls) for (const o of x.openings) raw[x.id].push([o.from, o.from + o.width]);
  const out = { walls: {}, floor: undefined };
  for (const x of walls) {
    const spans = mergeSpans(raw[x.id], lenOf(x));
    const all = spans.length === 1 && spans[0][0] <= 0.1 && spans[0][1] >= lenOf(x) - 0.1;
    out.walls[x.id] = all ? null : spans;
  }
  if (!(x0 <= 0.02 && x1 >= 0.98 && y0 <= 0.02 && y1 >= 0.98))
    out.floor = [[x0 * w, y0 * l], [x1 * w, y0 * l], [x1 * w, y1 * l], [x0 * w, y1 * l]].map((p) => p.map(r3));
  return out;
}

/**
 * reading: from read.mjs. opts: { id, name, known: { width_m, depth_m, height_m } } (measured by hand, optional).
 */
export function roomFromReading(reading, { id = `photo-${Date.now().toString(36)}`, name, known = {} } = {}) {
  const { W, L } = planExtents(reading, known);
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

  const seen = seenParts(reading, walls, w, l, W, L);
  for (const x of walls) {
    const spans = seen.walls[x.id];
    if (spans) x.seen = spans; else delete x.seen;   // absent = the whole wall was seen
  }

  const ids = {};
  const items = (reading.objects || []).slice(0, 30).map((o) => {
    const cat = DEFAULT_SIZE[o.category] ? o.category : "other";
    const [dw, dd, dh0] = DEFAULT_SIZE[cat];
    const dh = dh0 ?? h;
    const width = clamp(metres(o.length) ?? dw, 0.2, Math.max(w, l));
    const depth = clamp(metres(o.depth) ?? dd, 0.05, Math.max(w, l));
    const height = clamp(metres(o.height) ?? (cat === "cupboard" && LOW.test(o.name || "") ? 0.5 : dh), 0.01, h);
    const rot = FACING[o.facing] ?? 0;
    // keep the footprint inside the walls
    const [fx, fy] = rot % 180 === 0 ? [width, depth] : [depth, width];
    const at = [clamp(o.x * w, fx / 2, Math.max(fx / 2, w - fx / 2)), clamp(o.y * l, fy / 2, Math.max(fy / 2, l - fy / 2))];
    const base = (o.name || cat).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || cat;
    ids[base] = (ids[base] || 0) + 1;
    return {
      id: ids[base] > 1 ? `${base}_${ids[base]}` : base, name: (o.name || cat) + (o.count > 1 ? ` x${o.count}` : ""), category: cat,
      at: at.map(r3), size: [width, depth, height].map(r3), rot, on_floor: cat !== "rug" && cat !== "tv",   // a TV stands on a unit or the wall
      ...(/^#[0-9a-f]{6}$/i.test(o.color ?? "") ? { color: o.color.toLowerCase() } : {}),
    };
  });
  const moved = separate(items, w, l);

  return {
    id, name: name || `${reading.room_type || "Room"} (from photo)`,
    source: "photo",
    accuracy_m: r3(Math.max(W.err, L.err)),   // 0.15 when the photos show the room wall to wall
    height: r3(h), glb: null,
    walls: walls.map((x) => ({ ...x, a: x.a.map(r3), b: x.b.map(r3) })),
    floor_seen: seen.floor,
    fixtures: items.filter((i) => i.category === "column"),
    furniture: items.filter((i) => i.category !== "column"),
    lights: [],
    style: { tags: reading.style?.tags || [], colors: (reading.style?.colors || []).filter((c) => /^#[0-9a-f]{6}$/i.test(c)) },
    _derived: { width: { ...W, m: r3(w), err: r3(W.err) }, depth: { ...L, m: r3(l), err: r3(L.err) }, height: { ...Hh, m: r3(h), err: r3(Hh.err) }, caveats: reading.caveats || [], ...(moved.length ? { moved } : {}) },
  };
}

// The footprint [x0, y0, x1, y1] of an item, turned by its rot.
const box = (i) => {
  const [fx, fy] = (((i.rot ?? 0) % 180) + 180) % 180 === 90 ? [i.size[1], i.size[0]] : [i.size[0], i.size[1]];
  return [i.at[0] - fx / 2, i.at[1] - fy / 2, i.at[0] + fx / 2, i.at[1] + fy / 2];
};
const TUCKS = { chair: ["table", "desk"], table: ["chair"], desk: ["chair"] };

/**
 * Positions read from photos are rough, so pieces can come out overlapping, which no real room has.
 * Of each overlapping pair, move whichever piece gets clear by the shortest step, inside the walls. Rugs lie under
 * things and chairs tuck under tables, so those pairs are left. Returns what moved, for _derived.
 */
export function separate(items, w, l, gap = 0.02) {
  const moved = new Map();
  const solid = items.filter((i) => i.on_floor !== false && i.category !== "rug");
  for (let pass = 0; pass < 8; pass++) {
    let any = false;
    for (let a = 0; a < solid.length; a++) for (let b = a + 1; b < solid.length; b++) {
      const A = solid[a], B = solid[b];
      if (TUCKS[A.category]?.includes(B.category)) continue;
      const p = box(A), q = box(B);
      const ox = Math.min(p[2], q[2]) - Math.max(p[0], q[0]), oy = Math.min(p[3], q[3]) - Math.max(p[1], q[1]);
      if (ox <= 0.005 || oy <= 0.005) continue;
      // the ways out for either piece, keeping it inside the walls; the shortest wins (the smaller piece on a tie)
      const ways = [];
      for (const [mover, still] of [[A, B], [B, A]]) {
        const mb = box(mover), sb = box(still), f = [mb[2] - mb[0], mb[3] - mb[1]];
        const inside = (axis, d) => mover.at[axis] + d - f[axis] / 2 >= -1e-6 && mover.at[axis] + d + f[axis] / 2 <= [w, l][axis] + 1e-6;
        const small = mover.size[0] * mover.size[1] <= still.size[0] * still.size[1] ? 0 : 0.001;
        for (const [axis, d] of [[0, sb[2] - mb[0] + gap], [0, sb[0] - mb[2] - gap], [1, sb[3] - mb[1] + gap], [1, sb[1] - mb[3] - gap]])
          if (Math.abs(d) <= MAX_STEP && inside(axis, d)) ways.push({ mover, still, axis, d, cost: Math.abs(d) + small });
      }
      if (!ways.length) continue;
      const { mover, still, axis, d } = ways.sort((u, v) => u.cost - v.cost)[0];
      const from = moved.get(mover)?.from ?? [...mover.at];
      mover.at = mover.at.map((v, i) => (i === axis ? r3(v + d) : v));
      moved.set(mover, { from, by: still.id });
      any = true;
    }
    if (!any) break;
  }
  return [...moved].map(([i, x]) => `${i.id} moved ${Math.round(Math.hypot(i.at[0] - x.from[0], i.at[1] - x.from[1]) * 100)} cm off the ${x.by}`);
}

/**
 * A room with its size fixed by hand: { width_m?, depth_m?, height_m? } (the plan's x and y extents).
 * Walls stretch, door and window centres move with them (their widths stay), furniture centres move,
 * its sizes stay. Any outline, not only boxes. Both walls given -> accuracy 0.05.
 */
export function resizeRoom(room, { width_m, depth_m, height_m } = {}) {
  const out = structuredClone(room);
  const xs = room.walls.flatMap((w) => [w.a[0], w.b[0]]), ys = room.walls.flatMap((w) => [w.a[1], w.b[1]]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), W = Math.max(...xs) - x0, D = Math.max(...ys) - y0;
  const kx = width_m > 0 ? width_m / W : 1, ky = depth_m > 0 ? depth_m / D : 1;
  const P = ([x, y]) => [r3(x0 + (x - x0) * kx), r3(y0 + (y - y0) * ky)];
  const H = height_m > 0 ? height_m : room.height ?? 2.4;
  out.walls = room.walls.map((w) => {
    const a = P(w.a), b = P(w.b);
    const len0 = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const openings = (w.openings || []).map((o) => {
      const width = Math.min(o.width, len);
      const mid = len0 > 0 ? ((o.from + o.width / 2) / len0) * len : len / 2;
      const op = { ...o, width: r3(width), from: r3(clamp(mid - width / 2, 0, len - width)) };
      if (o.head != null) op.head = r3(Math.min(o.head, H));
      return op;
    });
    const out = { ...w, a, b, openings };
    if (w.seen) out.seen = w.seen.map(([s0, s1]) => [r3((s0 / len0) * len), r3((s1 / len0) * len)]);
    return out;
  });
  if (room.floor_seen) out.floor_seen = room.floor_seen.map(P);
  const move = (i) => {
    const rot = ((i.rot ?? 0) % 180 + 180) % 180;
    const [fx, fy] = rot === 90 ? [i.size[1], i.size[0]] : [i.size[0], i.size[1]];
    const [x, y] = P(i.at);
    const nx = x0 + W * kx, ny = y0 + D * ky;
    const size = i.category === "column" && room.height && i.size[2] >= room.height - 0.01 ? [i.size[0], i.size[1], r3(H)] : i.size;
    return { ...i, size, at: [r3(clamp(x, x0 + fx / 2, Math.max(x0 + fx / 2, nx - fx / 2))), r3(clamp(y, y0 + fy / 2, Math.max(y0 + fy / 2, ny - fy / 2)))] };
  };
  out.furniture = (room.furniture || []).map(move);
  out.fixtures = (room.fixtures || []).map(move);
  out.height = r3(H);
  const both = width_m > 0 && depth_m > 0;
  if (both) out.accuracy_m = 0.05;
  else if (width_m > 0 || depth_m > 0) out.accuracy_m = r3(Math.max(0.1, (room.accuracy_m ?? 0.15) / 2));
  out._derived = { ...(room._derived || {}), resized: { width_m: width_m ?? null, depth_m: depth_m ?? null, height_m: height_m ?? null, from: [r3(W), r3(D)] } };
  return out;
}
