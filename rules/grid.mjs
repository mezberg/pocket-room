// Free-floor grid and walkways. Every floor cell holds its clearance: the distance to the nearest wall or
// piece (negative inside a piece). A walkway's width is twice the smallest clearance along the way.
// Routes are widest paths (max-min Dijkstra on an 8-connected grid): for every door and every place you
// need to reach (other doors, windows, the front of a sofa, each side of a bed...) we get the widest way
// there and the spot where it is narrowest. That answers "is there an A* path at least w wide" for every w
// at once, and the narrowest spot is where the 3D marker goes.
import { footprint, sdRect, distSeg, pointInPoly, porchRect, toWorld } from "./geom.mjs";

export const RES = 0.04;
const CAP = 1.0;      // clearance is capped here (walkways wider than 2 m all count as wide)
const INF = 9;        // start zones: the doorway itself never counts against the walkway

export const label = (item) => `the ${(item.name || item.id).toLowerCase()}`;
export const openingLabel = (op) => `the ${op.id.replace(/[_-]+/g, " ")}`;

// Things you can't walk through. Wall-hung radiators count (they stick out); rugs and things on
// tables don't.
export function blocksFloor(item) {
  if (item.category === "rug") return false;
  return item.on_floor !== false || item.category === "radiator";
}

export function obstacles(room, { exclude = new Set(), extra = [] } = {}) {
  const out = [];
  for (const it of room.fixtures ?? []) if (blocksFloor(it)) out.push({ item: it, fixed: true, R: footprint(it) });
  for (const it of room.furniture ?? []) if (!exclude.has(it.id) && blocksFloor(it)) out.push({ item: it, fixed: false, R: footprint(it) });
  for (const it of extra) out.push({ item: it, fixed: false, R: footprint(it) });
  return out;
}

// The walls-only grid depends on the outline alone, and the fix searches rebuild the grid for every
// candidate move: keep it per outline and only stamp the pieces each time.
const shells = new WeakMap();
function shell(O, res) {
  let byRes = shells.get(O);
  if (!byRes) shells.set(O, (byRes = new Map()));
  if (byRes.has(res)) return byRes.get(res);
  const m = 0.7;
  const [bx0, by0, bx1, by1] = O.bbox;
  const x0 = bx0 - m, y0 = by0 - m;
  const nx = Math.ceil((bx1 - bx0 + 2 * m) / res), ny = Math.ceil((by1 - by0 + 2 * m) / res);
  const kind = new Uint8Array(nx * ny); // 0 outside, 1 floor, 2 porch outside a door
  const clr = new Float32Array(nx * ny).fill(-CAP);
  const porches = O.openings.filter((o) => o.passable).map((o) => porchRect(o));
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const i = iy * nx + ix;
      const p = [x0 + (ix + 0.5) * res, y0 + (iy + 0.5) * res];
      if (pointInPoly(p, O.poly)) kind[i] = 1;
      else if (porches.some((R) => sdRect(R, p) <= 0)) kind[i] = 2;
      else continue;
      let d = CAP;
      for (const [a, b] of O.solid) d = Math.min(d, distSeg(p, a, b));
      clr[i] = d;
    }
  }
  const S = { res, x0, y0, nx, ny, kind, clr };
  byRes.set(res, S);
  return S;
}

export function buildGrid(O, obs, res = RES) {
  const S = shell(O, res);
  const G = { ...S, clr: Float32Array.from(S.clr) };
  for (const o of obs) stamp(G, o.R, G.clr);
  return G;
}

// Lower the clearance around one rectangle (in place on `clr`).
export function stamp(G, R, clr) {
  const ext = Math.hypot(R.hw, R.hd) + CAP;
  const ix0 = Math.max(0, Math.floor((R.c[0] - ext - G.x0) / G.res)), ix1 = Math.min(G.nx - 1, Math.ceil((R.c[0] + ext - G.x0) / G.res));
  const iy0 = Math.max(0, Math.floor((R.c[1] - ext - G.y0) / G.res)), iy1 = Math.min(G.ny - 1, Math.ceil((R.c[1] + ext - G.y0) / G.res));
  const p = [0, 0];
  for (let iy = iy0; iy <= iy1; iy++) {
    p[1] = G.y0 + (iy + 0.5) * G.res;
    for (let ix = ix0; ix <= ix1; ix++) {
      const i = iy * G.nx + ix;
      if (!G.kind[i]) continue;
      p[0] = G.x0 + (ix + 0.5) * G.res;
      const d = sdRect(R, p);
      if (d < clr[i]) clr[i] = Math.max(d, -CAP);
    }
  }
  return clr;
}

export const withRect = (G, R) => ({ ...G, clr: stamp(G, R, Float32Array.from(G.clr)) });
export const cellAt = (G, p) => {
  const ix = Math.floor((p[0] - G.x0) / G.res), iy = Math.floor((p[1] - G.y0) / G.res);
  return ix < 0 || iy < 0 || ix >= G.nx || iy >= G.ny ? -1 : iy * G.nx + ix;
};
export const centre = (G, i) => [G.x0 + ((i % G.nx) + 0.5) * G.res, G.y0 + (Math.floor(i / G.nx) + 0.5) * G.res];
export const clearanceAt = (G, p) => { const i = cellAt(G, p); return i < 0 || !G.kind[i] ? -CAP : G.clr[i]; };

// Free floor area (m²) and the share of the room it is.
export function freeArea(G) {
  let free = 0, floor = 0;
  for (let i = 0; i < G.kind.length; i++) if (G.kind[i] === 1) { floor++; if (G.clr[i] > 0) free++; }
  const a = G.res * G.res;
  return { free_m2: free * a, floor_m2: floor * a, share: floor ? free / floor : 0 };
}

// Cells matching a predicate within a box around a point (for zones).
function cellsNear(G, c, r, pred) {
  const out = [];
  const ix0 = Math.max(0, Math.floor((c[0] - r - G.x0) / G.res)), ix1 = Math.min(G.nx - 1, Math.ceil((c[0] + r - G.x0) / G.res));
  const iy0 = Math.max(0, Math.floor((c[1] - r - G.y0) / G.res)), iy1 = Math.min(G.ny - 1, Math.ceil((c[1] + r - G.y0) / G.res));
  for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
    const i = iy * G.nx + ix;
    if (G.kind[i] && pred(i, [G.x0 + (ix + 0.5) * G.res, G.y0 + (iy + 0.5) * G.res])) out.push(i);
  }
  return out;
}

// Where people need to get to, per category: anchors in the piece's own frame (front is -y).
const REACH = {
  sofa: [["front", 0, -1]], armchair: [["front", 0, -1]],
  bed: [["left side", -1, 0], ["right side", 1, 0]],
  desk: [["front", 0, -1]], shelf: [["front", 0, -1]], cupboard: [["front", 0, -1]],
  wardrobe: [["front", 0, -1]], tv: [["front", 0, -1]], dresser: [["front", 0, -1]],
};
const USE = 0.9; // depth of the use area in front of a sofa, beside a bed...
export const reachable = (item) => !!REACH[item.category];

const doorZone = (G, op) => {
  const P = porchRect(op);
  return cellsNear(G, op.mid, op.width / 2 + 0.7, (i, p) =>
    (G.kind[i] === 2 && sdRect(P, p) <= 0) || (G.kind[i] === 1 && G.clr[i] > 0 && distSeg(p, op.a, op.b) <= 0.45)); // deeper than half a 75 cm walkway, so door jambs never count
};

export function targets(G, O, items) {
  const out = [];
  for (const op of O.openings) {
    if (op.passable) out.push({ id: op.id, label: openingLabel(op), type: "door", op, zone: doorZone(G, op) });
    else if (op.kind === "window") {
      out.push({ id: op.id, label: openingLabel(op), type: "window", op,
        zone: cellsNear(G, op.mid, op.width / 2 + 0.6, (i, p) => G.kind[i] === 1 && distSeg(p, op.a, op.b) <= 0.6) });
    }
  }
  for (const it of items) {
    for (const [side, sx, sy] of REACH[it.category] ?? []) {
      // The use area: a band 0.9 m deep along that face. Getting into it is what counts.
      const R = footprint(it);
      const a = toWorld(R, sx * (R.hw + 0.05), sy * (R.hd + 0.05));
      const zone = cellsNear(G, a, Math.hypot(R.hw, R.hd) + 1, (i, p) => {
        if (G.kind[i] !== 1 || G.clr[i] <= 0.02) return false;
        const d = [p[0] - R.c[0], p[1] - R.c[1]];
        const lx = d[0] * R.ux[0] + d[1] * R.ux[1], ly = d[0] * R.uy[0] + d[1] * R.uy[1];
        if (sy) { const out = sy * ly - R.hd; return Math.abs(lx) <= R.hw && out > 0 && out <= USE; }
        const out = sx * lx - R.hw; return Math.abs(ly) <= R.hd && out > 0 && out <= USE;
      });
      const name = REACH[it.category].length > 1 ? `the ${side} of ${label(it)}` : label(it);
      out.push({ id: `${it.id}:${side.replace(" ", "_")}`, item: it.id, label: name, type: "item", anchor: a, zone });
    }
  }
  return out;
}

// Widest-path tree from one start zone. Values are clearances; a bucket queue on whole centimetres.
function widest(G, start) {
  const n = G.kind.length, nx = G.nx;
  const val = new Float32Array(n).fill(-Infinity);
  const parent = new Int32Array(n).fill(-1);
  const isStart = new Uint8Array(n);
  const B = (v) => Math.max(0, Math.min(202, Math.round(v * 100) + 101));
  const buckets = Array.from({ length: 203 }, () => []);
  for (const i of start) { isStart[i] = 1; val[i] = INF; buckets[202].push(i); }
  const done = new Uint8Array(n);
  const nb = [-1, 1, -nx, nx, -nx - 1, -nx + 1, nx - 1, nx + 1];
  for (let b = 202; b >= 0; b--) {
    const q = buckets[b];
    while (q.length) {
      const c = q.pop();
      if (done[c]) continue;
      done[c] = 1;
      const x = c % nx;
      for (let k = 0; k < 8; k++) {
        const j = c + nb[k];
        if (j < 0 || j >= n || !G.kind[j] || done[j]) continue;
        const jx = j % nx;
        if (Math.abs(jx - x) > 1) continue;
        const eff = isStart[j] ? INF : G.clr[j];
        const v = Math.min(val[c], eff);
        if (v > val[j]) { val[j] = v; parent[j] = c; buckets[Math.min(b, B(v))].push(j); }
      }
    }
  }
  return { val, parent, isStart };
}

// Shortest path from the start zone into the target zone over cells at least `min` clear (A*-style
// Dijkstra, 8-connected). Returns the cells from the door side, or [] if there is none.
function shortest(G, isStart, inZone, min) {
  const n = G.kind.length, nx = G.nx;
  const dist = new Float64Array(n).fill(Infinity), parent = new Int32Array(n).fill(-1);
  const heap = [];
  const push = (c, d) => { heap.push([d, c]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  for (let i = 0; i < n; i++) if (isStart[i]) { dist[i] = 0; push(i, 0); }
  const nb = [[-1, 1], [1, 1], [-nx, 1], [nx, 1], [-nx - 1, Math.SQRT2], [-nx + 1, Math.SQRT2], [nx - 1, Math.SQRT2], [nx + 1, Math.SQRT2]];
  while (heap.length) {
    const [d, c] = pop();
    if (d > dist[c]) continue;
    if (inZone[c] && !isStart[c]) {
      const cells = [];
      for (let k = c; k >= 0 && !isStart[k]; k = parent[k]) cells.unshift(k);
      return cells;
    }
    const x = c % nx;
    for (const [o, w] of nb) {
      const j = c + o;
      if (j < 0 || j >= n || !G.kind[j] || Math.abs((j % nx) - x) > 1) continue;
      if (!isStart[j] && !inZone[j] && G.clr[j] < min) continue;
      const nd = d + w;
      if (nd < dist[j]) { dist[j] = nd; parent[j] = c; push(j, nd); }
    }
  }
  return [];
}

// All routes: from every door to every target. width in metres (0 = blocked), `at` = narrowest point.
export function routes(G, O, items, { paths = false } = {}) {
  const T = targets(G, O, items);
  const out = [];
  const nx = G.nx, n = G.kind.length;
  for (const src of T.filter((t) => t.type === "door")) {
    const W = widest(G, src.zone);
    for (const t of T) {
      if (t === src) continue;
      // Best way in: from a cell just outside the zone (inside it, nothing counts any more).
      const inZone = new Uint8Array(n);
      for (const z of t.zone) inZone[z] = 1;
      let best = -Infinity, bq = -1;
      for (const z of t.zone) {
        if (W.isStart[z]) { best = INF; bq = z; break; }
        for (const d of [-1, 1, -nx, nx, -nx - 1, -nx + 1, nx - 1, nx + 1]) {
          const q = z + d;
          if (q >= 0 && q < n && !inZone[q] && W.val[q] > best) { best = W.val[q]; bq = q; }
        }
      }
      const r = { from: src.id, fromLabel: src.label, to: t.id, toLabel: t.label, type: t.type, item: t.item ?? null };
      if (bq < 0) { out.push({ ...r, width: 0, at: t.anchor ?? null, open: false }); continue; }
      const width = best >= INF ? Infinity : best <= 0 ? 0 : 2 * best + G.res / 2;
      r.width = width;
      r.open = best > 0;
      if (best >= INF) { r.at = null; out.push(r); continue; }
      // The widest-path tree wanders once past the narrowest point. With `paths`, re-trace the shortest way
      // that is still this wide (A* on the cells at least that clear) for the marker and the drawing.
      let cells = [];
      if (paths) cells = shortest(G, W.isStart, inZone, best - 0.006);
      if (!cells.length) for (let c = bq; c >= 0 && !W.isStart[c]; c = W.parent[c]) cells.unshift(c);
      // Narrowest point: the first cell (from the door) at the bottleneck.
      let low = INF;
      for (const c of cells) if (!inZone[c]) low = Math.min(low, G.clr[c]);
      const lowCell = cells.find((c) => !inZone[c] && G.clr[c] <= low + 0.005) ?? bq;
      r.at = centre(G, lowCell);
      if (paths) r.path = cells.filter((_, k, a) => k % 4 === 0 || k === a.length - 1).map((c) => centre(G, c).map((v) => Math.round(v * 100) / 100));
      out.push(r);
    }
  }
  return out;
}
