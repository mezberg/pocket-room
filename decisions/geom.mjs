// Plan geometry the design checks measure with. Metres, x east, y north, rot as contract/README.md:
// a piece's front faces −y at rot 0 and turns counter-clockwise (90 = faces east).
const rad = (d) => (d * Math.PI) / 180;
export const r2 = (v) => Math.round(v * 100) / 100;
export const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export const front = (rot) => [Math.sin(rad(rot)), -Math.cos(rad(rot))];

// Corners of a piece's footprint, counter-clockwise.
export function footprint({ at, size, rot = 0 }) {
  const [w, d] = size, c = Math.cos(rad(rot)), s = Math.sin(rad(rot));
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
    .map(([x, y]) => [at[0] + x * c - y * s, at[1] + x * s + y * c]);
}
// Middle of a piece's front edge.
export const frontCentre = (p) => { const f = front(p.rot ?? 0); return [p.at[0] + f[0] * p.size[1] / 2, p.at[1] + f[1] * p.size[1] / 2]; };

function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
  const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}
function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Distance from a point to a polygon (0 inside).
export const polyDist = (p, poly) => (inPoly(p, poly) ? 0 : Math.min(...poly.map((a, i) => segDist(p, a, poly[(i + 1) % poly.length]))));

export const outline = (room) => room.walls.map((w) => w.a);
export const inRoom = (p, room) => inPoly(p, outline(room));
export const floorArea = (room) => Math.abs(outline(room).reduce((s, a, i, o) => { const b = o[(i + 1) % o.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;

// Openings with their plan position: centre, both ends, and the inward normal of their wall.
export function openings(room) {
  const cx = outline(room).reduce((s, a) => [s[0] + a[0], s[1] + a[1]], [0, 0]).map((v) => v / room.walls.length);
  return room.walls.flatMap((w) => {
    const L = dist(w.a, w.b), u = [(w.b[0] - w.a[0]) / L, (w.b[1] - w.a[1]) / L];
    let n = [-u[1], u[0]];
    const mid = [(w.a[0] + w.b[0]) / 2, (w.a[1] + w.b[1]) / 2];
    if ((cx[0] - mid[0]) * n[0] + (cx[1] - mid[1]) * n[1] < 0) n = [-n[0], -n[1]];
    return (w.openings ?? []).map((o) => {
      const at = (t) => [w.a[0] + u[0] * t, w.a[1] + u[1] * t];
      return { ...o, wall: w.id, ends: [at(o.from), at(o.from + o.width)], centre: at(o.from + o.width / 2), inward: n };
    });
  });
}
export const isGlazed = (o) => o.kind === "window" || o.kind === "glazed_door";
export const isDoor = (o) => o.kind === "door" || o.kind === "glazed_door" || o.kind === "opening";
export const openingDist = (p, o) => segDist(p, o.ends[0], o.ends[1]);

// Everything standing on the floor that you walk around.
export const obstacles = (room) => [...(room.fixtures ?? []), ...(room.furniture ?? [])].filter((f) => f.on_floor !== false);
export const byCategory = (room, cat) => (room.furniture ?? []).filter((f) => f.category === cat);
