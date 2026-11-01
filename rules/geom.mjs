// Plan geometry: footprints, the room outline, openings and door swings. Metres, x east / y north,
// rot = turn of the front away from south, counter-clockwise (contract/README.md).

export const RAD = Math.PI / 180;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const len = (a) => Math.hypot(a[0], a[1]);

// Oriented rectangle of an item's footprint. ux = local x (width), uy = local y (depth); front is -uy.
export function footprint(item, at = item.at, rot = item.rot ?? 0) {
  const r = rot * RAD;
  const ux = [Math.cos(r), Math.sin(r)];
  const uy = [-Math.sin(r), Math.cos(r)];
  return { c: [at[0], at[1]], hw: item.size[0] / 2, hd: item.size[1] / 2, ux, uy };
}

export const toWorld = (R, lx, ly) => [R.c[0] + R.ux[0] * lx + R.uy[0] * ly, R.c[1] + R.ux[1] * lx + R.uy[1] * ly];
export const frontDir = (R) => [-R.uy[0], -R.uy[1]];

export function corners(R) {
  return [toWorld(R, -R.hw, -R.hd), toWorld(R, R.hw, -R.hd), toWorld(R, R.hw, R.hd), toWorld(R, -R.hw, R.hd)];
}

// Signed distance from a point to a rectangle: negative inside.
export function sdRect(R, p) {
  const d = sub(p, R.c);
  const qx = Math.abs(dot(d, R.ux)) - R.hw;
  const qy = Math.abs(dot(d, R.uy)) - R.hd;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0);
}

// How far two rectangles overlap (separating axis test): > 0 is the depth, with the axis to push B out
// of A along (pointing from A to B). <= 0 means apart by that much along the best axis.
export function overlap(A, B) {
  let best = { depth: Infinity, axis: null };
  const d = sub(B.c, A.c);
  for (const ax of [A.ux, A.uy, B.ux, B.uy]) {
    const ra = A.hw * Math.abs(dot(A.ux, ax)) + A.hd * Math.abs(dot(A.uy, ax));
    const rb = B.hw * Math.abs(dot(B.ux, ax)) + B.hd * Math.abs(dot(B.uy, ax));
    const s = dot(d, ax);
    const depth = ra + rb - Math.abs(s);
    if (depth < best.depth) best = { depth, axis: s >= 0 ? ax : [-ax[0], -ax[1]] };
  }
  return best;
}

export function distSeg(p, a, b) {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  const t = L2 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / L2)) : 0;
  return len(sub(p, [a[0] + ab[0] * t, a[1] + ab[1] * t]));
}

export function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

const PASSABLE = new Set(["door", "glazed_door", "opening"]);

// Everything about the room outline that the rules need, worked out once.
export function outline(room) {
  const poly = room.walls.map((w) => w.a);
  let area2 = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    area2 += p[0] * q[1] - q[0] * p[1];
  }
  const ccw = area2 >= 0;
  const walls = room.walls.map((w) => {
    const v = sub(w.b, w.a);
    const L = len(v);
    const dir = [v[0] / L, v[1] / L];
    const n = ccw ? [-dir[1], dir[0]] : [dir[1], -dir[0]]; // into the room
    return { id: w.id, a: w.a, b: w.b, L, dir, n, openings: w.openings ?? [] };
  });
  const at = (w, t) => [w.a[0] + w.dir[0] * t, w.a[1] + w.dir[1] * t];

  const openings = [];
  const solid = []; // wall segments you can't walk through
  for (const w of walls) {
    const cuts = [];
    for (const o of w.openings) {
      const t0 = o.from, t1 = o.from + o.width;
      const op = {
        id: o.id, kind: o.kind, wall: w.id, w, t0, t1, width: o.width, sill: o.sill ?? null,
        a: at(w, t0), b: at(w, t1), mid: at(w, (t0 + t1) / 2), n: w.n, dir: w.dir,
        passable: PASSABLE.has(o.kind), swing: null,
      };
      if (o.swing && o.swing.into !== false) {
        const hinge = o.swing.hinge === "a" ? op.a : op.b;
        const toward = o.swing.hinge === "a" ? w.dir : [-w.dir[0], -w.dir[1]];
        op.swing = { hinge, toward, r: o.width };
      }
      openings.push(op);
      if (op.passable) cuts.push([t0, t1]);
    }
    cuts.sort((p, q) => p[0] - q[0]);
    let t = 0;
    for (const [t0, t1] of cuts) {
      if (t0 > t) solid.push([at(w, t), at(w, t0)]);
      t = Math.max(t, t1);
    }
    if (t < w.L) solid.push([at(w, t), w.b]);
  }

  const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const k = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * k; cy += (p[1] + q[1]) * k;
  }
  const centroid = area2 ? [cx / (3 * area2), cy / (3 * area2)] : [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  return {
    poly, walls, openings, solid, centroid, area: Math.abs(area2) / 2,
    bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)],
  };
}

// Distance from a point to the room outline (positive inside the room, negative outside).
export function sdRoom(O, p) {
  let d = Infinity;
  for (const w of O.walls) d = Math.min(d, distSeg(p, w.a, w.b));
  return pointInPoly(p, O.poly) ? d : -d;
}

// How far a rectangle pokes out of the room (0 = fully inside).
export function outside(O, R) {
  let worst = 0;
  for (const c of corners(R)) worst = Math.max(worst, -sdRoom(O, c));
  for (const v of O.poly) worst = Math.max(worst, -sdRect(R, v)); // a room corner poking into the piece
  return worst;
}

// Door swing (quarter circle) and the doorway's standing area in front of an opening.
export function inSwing(op, p) {
  if (!op.swing) return false;
  const d = sub(p, op.swing.hinge);
  return len(d) <= op.swing.r && dot(d, op.swing.toward) >= -0.01 && dot(d, op.n) >= -0.01;
}
export function doorwayRect(op, depth = 0.6) {
  const c = [op.mid[0] + op.n[0] * depth / 2, op.mid[1] + op.n[1] * depth / 2];
  return { c, hw: op.width / 2, hd: depth / 2, ux: op.dir, uy: op.n };
}
export function porchRect(op, depth = 0.6) {
  const c = [op.mid[0] - op.n[0] * depth / 2, op.mid[1] - op.n[1] * depth / 2];
  return { c, hw: op.width / 2, hd: depth / 2, ux: op.dir, uy: op.n };
}

// Does the rectangle reach into the door's swing? Sampled on the quarter circle.
export function hitsSwing(op, R) {
  if (!op.swing) return false;
  const { hinge, toward, r } = op.swing;
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    const dx = Math.cos(a), dy = Math.sin(a);
    for (let k = 1; k <= 6; k++) {
      const s = (k / 6) * r;
      const p = [hinge[0] + (toward[0] * dx + op.n[0] * dy) * s, hinge[1] + (toward[1] * dx + op.n[1] * dy) * s];
      if (sdRect(R, p) < -0.01) return true;
    }
  }
  return false;
}

export function compass(v) {
  const names = ["east", "north-east", "north", "north-west", "west", "south-west", "south", "south-east"];
  const a = Math.atan2(v[1], v[0]);
  return names[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}

export const cm = (m) => `${Math.round(m * 100)} cm`;
export const r2 = (m) => Math.round(m * 100) / 100;
