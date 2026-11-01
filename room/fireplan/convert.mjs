// Floorplan pipeline output (graph.json + rooms.json, plan pixels) -> one room.json. All geometry in code.
// Scale: given px_per_m, else the median door opening = one door width (refs.mjs).
import { REFS } from "../photo/refs.mjs";

const r3 = (v) => Math.round(v * 1000) / 1000;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b), n = s.length;
  return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null;
};
const area = (pts) => pts.reduce((s, [x, y], i) => { const [u, v] = pts[(i + 1) % pts.length]; return s + x * v - u * y; }, 0) / 2;
const inside = ([x, y], pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};

/** Drop vertices that sit within tol px of the line through their neighbours (trace jitter). */
export function simplify(ring, tol = 5) {
  let pts = ring.slice();
  if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
  for (let changed = true; changed && pts.length > 3;) {
    changed = false;
    for (let i = 0; i < pts.length && pts.length > 3; i++) {
      const p = pts[(i - 1 + pts.length) % pts.length], q = pts[(i + 1) % pts.length];
      if (segDist(pts[i], p, q) < tol) { pts.splice(i, 1); changed = true; i--; }
    }
  }
  return pts;
}

/** px per metre from the door openings of the whole plan, with a rough relative error. */
export function doorScale(graph) {
  const widths = graph.walls.flatMap((w) => (w.openings || []).filter((o) => o.kind === "door").map((o) => Math.abs(o.t1 - o.t0)));
  if (widths.length < 2) return null;
  const m = median(widths);
  const mad = median(widths.map((x) => Math.abs(x - m)));
  return { px_per_m: m / REFS.door_width, rel_err: Math.min(0.3, Math.max(0.05, mad / m)), doors: widths.length };
}

/** The plan's rooms, matched graph id <-> traced polygon (by the graph centroid falling inside the ring). */
export function planRooms(graph, rings) {
  return graph.rooms.map((r) => {
    const ring = rings.rooms.find((x) => inside(r.centroid, x.exterior)) ?? rings.rooms[graph.rooms.indexOf(r)];
    return { id: r.id, area_px: r.area, centroid: r.centroid, ring: ring?.exterior };
  });
}

const DIRS = [["east", [1, 0]], ["north", [0, 1]], ["west", [-1, 0]], ["south", [0, -1]]];

/**
 * graph, rings: the pipeline's _graph.json and _rooms.json. opts: { room: graph room id (default: largest),
 * px_per_m, height_m, id, name }.
 */
export function roomFromPlan(graph, rings, opts = {}) {
  const rooms = planRooms(graph, rings).filter((r) => r.ring);
  const pick = opts.room ? rooms.find((r) => r.id === opts.room) : [...rooms].sort((a, b) => b.area_px - a.area_px)[0];
  if (!pick) throw new Error(`no room ${opts.room} in the plan (have ${rooms.map((r) => r.id).join(", ")})`);
  const scale = opts.px_per_m ? { px_per_m: opts.px_per_m, rel_err: 0.01, given: true } : doorScale(graph);
  if (!scale) throw new Error("no scale: the plan has fewer than two doors; pass px_per_m");
  const s = scale.px_per_m;

  // Plan up = north: x east = px / s, y north = -py / s. Shift so the room's SW corner of its box is the origin.
  let pts = simplify(pick.ring).map(([x, y]) => [x / s, -y / s]);
  if (area(pts) < 0) pts.reverse();
  const minX = Math.min(...pts.map((p) => p[0])), minY = Math.min(...pts.map((p) => p[1]));
  pts = pts.map(([x, y]) => [r3(x - minX), r3(y - minY)]);
  const toM = ([x, y]) => [x / s - minX, -y / s - minY];

  // Walls named by which way they face from inside (outward normal of a CCW ring is (dy, -dx)).
  const seen = {};
  const walls = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const n = [(b[1] - a[1]) / L, -(b[0] - a[0]) / L];
    const [dir] = DIRS.reduce((best, d) => (d[1][0] * n[0] + d[1][1] * n[1] > best[1][0] * n[0] + best[1][1] * n[1] ? d : best));
    seen[dir] = (seen[dir] || 0) + 1;
    return { id: seen[dir] > 1 ? `${dir}_${seen[dir]}` : dir, a, b, openings: [] };
  });

  // Openings of the graph walls that bound this room, projected onto the nearest ring edge.
  let n = 0;
  for (const gw of graph.walls) {
    if (!gw.sides?.some((x) => x.room === pick.id) || !gw.openings?.length) continue;
    const [ax, ay] = gw.a, [bx, by] = gw.b, gl = Math.hypot(bx - ax, by - ay) || 1, u = [(bx - ax) / gl, (by - ay) / gl];
    for (const o of gw.openings) {
      const p0 = toM([ax + u[0] * o.t0, ay + u[1] * o.t0]), p1 = toM([ax + u[0] * o.t1, ay + u[1] * o.t1]);
      const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
      const w = walls.reduce((best, x) => (segDist(mid, x.a, x.b) < segDist(mid, best.a, best.b) ? x : best));
      if (segDist(mid, w.a, w.b) > (gw.thickness / s) * 1.5 + 0.1) continue;
      const L = Math.hypot(w.b[0] - w.a[0], w.b[1] - w.a[1]), d = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
      const t = [p0, p1].map((p) => Math.max(0, Math.min(L, (p[0] - w.a[0]) * d[0] + (p[1] - w.a[1]) * d[1]))).sort((x, y) => x - y);
      if (t[1] - t[0] < 0.3) continue;
      // two graph walls (one per neighbour pair) can carry the same gap: keep the first
      if (w.openings.some((x) => Math.min(x.from + x.width, t[1]) - Math.max(x.from, t[0]) > 0.5 * (t[1] - t[0]))) continue;
      w.openings.push({ id: `${o.kind}_${++n}`, kind: o.kind === "window" ? "window" : "door", from: r3(t[0]), width: r3(t[1] - t[0]),
        head: 2.04, ...(o.kind === "window" ? { sill: 0.9, head: 2.1 } : { swing: null }) });
    }
  }

  const W = Math.max(...pts.map((p) => p[0])), Lm = Math.max(...pts.map((p) => p[1]));
  return {
    id: opts.id || `plan-${pick.id}-${Date.now().toString(36)}`,
    name: opts.name || `Room ${pick.id} (from plan)`,
    source: "floorplan",
    accuracy_m: r3(Math.max(0.05, scale.rel_err * Math.max(W, Lm) / 2)),
    height: opts.height_m || 2.4,
    glb: null,
    walls, fixtures: [], furniture: [], lights: [], style: { tags: [], colors: [] },
    _derived: {
      scale: scale.given ? `given: ${s} px/m` : `${scale.doors} doors, median ${r3(s * REFS.door_width)} px = ${REFS.door_width} m -> ${r3(s)} px/m`,
      box_m: [r3(W), r3(Lm)],
    },
    _plan_rooms: rooms.map((r) => ({ id: r.id, area_m2: r3(r.area_px / (s * s)), picked: r.id === pick.id })),
  };
}
