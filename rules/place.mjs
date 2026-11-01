// place(room, piece): every legal spot for a new piece, measured. Candidates slide along every wall
// (back to the wall, front into the room) and sit in the room's centre. Legal = inside the walls, no overlap,
// doorways and door swings clear, not over a radiator, enough room in front to use it, and no walkway
// squeezed below 0.6 m. Lane E picks among the spots; we only measure.
import { footprint, outline, outside, overlap, doorwayRect, hitsSwing, toWorld, sdRect, RAD, cm, r2 } from "./geom.mjs";
import { obstacles, buildGrid, withRect, routes, clearanceAt, label, reachable, openingLabel } from "./grid.mjs";

export const WALK_OK = 0.75, WALK_MIN = 0.6;
export const verdictFor = (w) => (w >= WALK_OK ? "Fits" : w >= WALK_MIN ? "Just fits" : "Doesn't fit");

const STEP = 0.1, GAP = 0.02, RADIATOR_GAP = 0.1;
// Space needed in front to use the piece (sit down, open doors, pull out a chair).
const FRONT = { sofa: 0.3, armchair: 0.3, bed: 0.3, desk: 0.6, wardrobe: 0.6, cupboard: 0.6, dresser: 0.6, shelf: 0.4, tv: 0.5 };
// Usually one per room: offer to put the new one in the old one's place.
const SWAP = new Set(["sofa", "bed", "desk", "tv", "wardrobe", "dresser", "lamp"]);
// A room wants one of these where the old one stood: a new floor lamp takes the old lamp's place (spots
// within a metre of it score up), it isn't added beside it.
const REPLACE_FIRST = new Set(["lamp"]);

const rotFacing = (f) => ((Math.round(Math.atan2(f[0], -f[1]) / RAD) % 360) + 360) % 360;
const key = (r) => `${r.from}>${r.to}`;
// Closed = under 60 cm, less the grid's ~1 cm sampling error (as in check.mjs).
const CLOSED = WALK_MIN - 0.01;

// Free distance in front of a rectangle, sampled across its width.
export function frontSpace(G, R, max = 2) {
  let best = max;
  for (const fx of [-0.8, -0.4, 0, 0.4, 0.8]) {
    for (let s = 0.02; s < best; s += 0.04) {
      const p = toWorld(R, fx * R.hw, -R.hd - s);
      if (clearanceAt(G, p) <= 0.01) { best = Math.max(0, s - 0.02); break; }
    }
  }
  return best;
}

export function candidates(O, piece) {
  const [w, d] = piece.size;
  const out = [];
  for (const wall of O.walls) {
    if (wall.L < w - 1e-6) continue;
    const ts = [];
    for (let t = w / 2; t <= wall.L - w / 2 + 1e-6; t += STEP) ts.push(t);
    if (ts.length && wall.L - w / 2 - ts[ts.length - 1] > 0.01) ts.push(wall.L - w / 2);
    for (const t of ts) {
      const at = [wall.a[0] + wall.dir[0] * t + wall.n[0] * (d / 2 + GAP), wall.a[1] + wall.dir[1] * t + wall.n[1] * (d / 2 + GAP)];
      out.push({ at, rot: rotFacing(wall.n), wall: wall.id, t });
    }
  }
  const rots = [...new Set(O.walls.map((wl) => rotFacing(wl.n)))];
  for (const rot of rots) out.push({ at: O.centroid, rot, wall: null });
  return out;
}

// Why a spot is illegal before any walkway is measured (null = fine so far).
function blocked(O, obs, P, h, roomH) {
  if (h > roomH) return { why: "tall" };
  if (outside(O, P) > 0.01) return { why: "wall" };
  for (const o of obs) {
    const pad = o.item.category === "radiator" ? RADIATOR_GAP : 0;
    const R = pad ? { ...o.R, hw: o.R.hw + pad, hd: o.R.hd + pad } : o.R;
    if (overlap(R, P).depth > 0.005) return { why: o.item.category === "radiator" ? "radiator" : "overlap", item: o.item };
  }
  for (const op of O.openings) {
    if (!op.passable) continue;
    if (overlap(doorwayRect(op), P).depth > 0.005) return { why: "door", op };
    if (hitsSwing(op, P)) return { why: "swing", op };
  }
  return null;
}

// How much of each window the piece stands in front of, for pieces taller than the sill.
function windowCover(O, P, h) {
  const hits = [];
  for (const op of O.openings) {
    if (op.kind !== "window" || h <= (op.sill ?? 0.8) + 0.05) continue;
    let n = 0;
    for (let k = 0; k <= 10; k++) {
      const t = op.t0 + (op.width * k) / 10;
      const p = [op.w.a[0] + op.dir[0] * t + op.n[0] * 0.2, op.w.a[1] + op.dir[1] * t + op.n[1] * 0.2];
      const d = [p[0] - P.c[0], p[1] - P.c[1]];
      if (Math.abs(d[0] * P.ux[0] + d[1] * P.ux[1]) <= P.hw && Math.abs(d[0] * P.uy[0] + d[1] * P.uy[1]) <= P.hd + 0.25) n++;
    }
    if (n) hits.push({ op, share: n / 11 });
  }
  return hits;
}

export function place(room, piece, opts = {}) {
  const O = outline(room);
  const all = [...(room.fixtures ?? []), ...(room.furniture ?? [])];
  const reachItems = (exclude, extra) => [...all.filter((it) => !exclude.has(it.id) && reachable(it)), ...extra];

  // Baseline: the room as it is now.
  const G0 = buildGrid(O, obstacles(room));
  const base = new Map(routes(G0, O, reachItems(new Set(), [])).map((r) => [key(r), r]));

  let swaps = [null];
  if (opts.replace === false) swaps = [null];
  else if (opts.replace) swaps = [].concat(opts.replace).map((id) => (room.furniture ?? []).find((f) => f.id === id)).filter(Boolean);
  else if (SWAP.has(piece.category)) swaps.push(...(room.furniture ?? []).filter((f) => f.category === piece.category));

  const h = piece.size[2] ?? 0;
  const need = FRONT[piece.category] ?? 0.3;
  const spots = [];
  const misses = { tall: 0, wall: 0, overlap: 0, radiator: 0, door: 0, swing: 0, front: 0, walk: 0 };
  let nearMiss = null;
  const newItem = { ...piece, id: piece.id ?? "new", name: piece.name ?? piece.category, on_floor: true };

  for (const swap of swaps) {
    const exclude = new Set(swap ? [swap.id] : []);
    const obs = obstacles(room, { exclude });
    const Gv = swap ? buildGrid(O, obs) : G0;
    // opts.at: measure just this one candidate ({ at, rot, wall }), e.g. a spot cleared by moving furniture
    for (const c of opts.at ? [opts.at] : candidates(O, piece)) {
      const P = footprint(piece, c.at, c.rot);
      const b = blocked(O, obs, P, h, room.height);
      if (b) { misses[b.why]++; continue; }
      const front = frontSpace(Gv, P);
      if (front < need) { misses.front++; continue; }

      const G = withRect(Gv, P);
      const placed = { ...newItem, at: c.at, rot: c.rot };
      const rs = routes(G, O, reachItems(exclude, [placed]));
      let worst = null, access = 0;
      for (const r of rs) {
        if (r.item === placed.id) { if (r.width > access) access = r.width; continue; }
        const b0 = base.get(key(r));
        if (!b0 || r.width >= b0.width - 0.02) continue;
        if (!worst || r.width < worst.width) worst = { ...r, before: b0.width };
      }
      // A way that was already closed (under 60 cm) before the piece came and is still closed right beside
      // it: the piece doesn't make it worse, but the room around it doesn't work. Not a clean fit.
      let stuck = null;
      for (const r of rs) {
        if (r.item === placed.id || r.width >= CLOSED || !r.at || sdRect(P, r.at) > Math.max(r.width / 2, 0) + 0.1) continue;
        if (!stuck || r.width < stuck.width) stuck = { ...r, before: base.get(key(r))?.width ?? 0 };
      }
      const hasAccess = rs.some((r) => r.item === placed.id);
      if (!hasAccess) access = Infinity;
      const clearance = Math.min(worst ? worst.width : Infinity, access, 2);
      if (clearance < WALK_MIN) {
        misses.walk++;
        if (!nearMiss || clearance > nearMiss.clearance) nearMiss = { clearance, wall: c.wall, worst };
        continue;
      }

      const wall = c.wall ? O.walls.find((w) => w.id === c.wall) : null;
      const reasons = [];
      reasons.push(wall ? `Back to the ${wall.id} wall` : "Free-standing in the middle of the room");
      if (swap) reasons.push(`Replaces ${label(swap)}`);
      reasons.push(`${cm(Math.min(front, 2))}${front >= 2 ? "+" : ""} free in front`);
      if (worst) reasons.push(`The way from ${worst.fromLabel} to ${worst.toLabel} goes from ${cm(Math.min(worst.before, 2))} to ${cm(worst.width)}`);
      else reasons.push("Doesn't narrow any walkway");
      if (stuck) reasons.push(`The way from ${stuck.fromLabel} to ${stuck.toLabel} was already blocked (${cm(Math.min(stuck.before, 2))}); with it here it's ${cm(stuck.width)}`);
      if (hasAccess) reasons.push(access >= 2 ? "Wide way to reach it" : `${cm(access)} way to reach it`);
      const cover = windowCover(O, P, h);
      for (const w of cover) reasons.push(`Stands in front of ${openingLabel(w.op)} (${Math.round(w.share * 100)}% of it)`);
      for (const o of obs) if (o.item.category === "radiator") {
        const gap = overlap(o.R, P).depth;
        if (-gap < 0.3) reasons.push(`${cm(-gap)} from ${label(o.item)}`);
      }

      const coverShare = cover.reduce((s, w) => Math.max(s, w.share), 0);
      const score = 0.45 * Math.min(1, (clearance - WALK_MIN) / 0.6) + 0.15 * (wall ? 1 : 0) + 0.15 * Math.min(1, front / 1.0)
        + 0.15 * (1 - coverShare * (h > 1.2 ? 1 : 0.5)) + 0.1 * (worst ? 0 : 1) - (stuck ? 0.2 : 0)
        + (swap && REPLACE_FIRST.has(piece.category) ? 0.6 * Math.max(0, 1 - Math.hypot(c.at[0] - swap.at[0], c.at[1] - swap.at[1])) : 0);
      spots.push({
        at: [r2(c.at[0]), r2(c.at[1])], rot: c.rot, ...(wall ? { wall: wall.id } : {}),
        score: Math.round(score * 100) / 100, clearance_m: r2(clearance), verdict: stuck ? "Just fits" : verdictFor(clearance), reasons,
        ...(swap ? { replaces: swap.id } : {}), front_m: r2(Math.min(front, 2)),
        ...(stuck ? { blocked: { from: stuck.from, to: stuck.to, before_m: r2(Math.min(stuck.before, 2)), after_m: r2(stuck.width), at: stuck.at.map(r2), already: true } } : {}),
        ...(worst ? { narrows: { from: worst.from, to: worst.to, before_m: r2(Math.min(worst.before, 2)), after_m: r2(worst.width), at: worst.at.map(r2) } } : {}),
      });
    }
  }

  spots.sort((a, b) => b.score - a.score || b.clearance_m - a.clearance_m);
  const best = spots[0] ?? null;
  const verdict = best ? best.verdict : "Doesn't fit";
  return { verdict, best, spots, say: sayPlacement(piece, best, O, misses, nearMiss), ...(opts.at ? { misses, near_miss: nearMiss } : {}) };
}

function sayPlacement(piece, best, O, misses, nearMiss) {
  if (best) {
    const where = best.wall ? `on the ${best.wall} wall` : "in the middle of the room";
    const swap = best.replaces ? `, replacing the old one,` : "";
    if (best.blocked) {
      const b = best.blocked;
      const nice = (id) => `the ${id.replace(/[_-]+/g, " ").replace(/:front$/, "")}`;
      return `Just fits ${where}${swap.replace(/,$/, "")}, but the way from ${nice(b.from)} to ${nice(b.to)} was already blocked: ${cm(b.after_m)} there. Check my room shows what to move.`;
    }
    return best.verdict === "Fits"
      ? `Fits. Best ${where}${swap || ","} with ${cm(best.clearance_m)} to walk past.`
      : `Just fits. Put it ${where}${swap.replace(/,$/, "")}; the walkway there is ${cm(best.clearance_m)}.`;
  }
  const longest = Math.max(...O.walls.map((w) => w.L));
  if (misses.tall && !misses.wall && !misses.overlap) return `Doesn't fit. It's ${cm(piece.size[2])} tall, taller than the ceiling.`;
  if (piece.size[0] > longest) return `Doesn't fit. It's ${piece.size[0].toFixed(2)} m wide and the longest wall is ${longest.toFixed(2)} m.`;
  if (nearMiss) {
    const w = nearMiss.wall ? `on the ${nearMiss.wall} wall` : "in the middle";
    const by = nearMiss.worst ? ` between ${nearMiss.worst.fromLabel} and ${nearMiss.worst.toLabel}` : "";
    return `Doesn't fit. The best place, ${w}, leaves only ${cm(nearMiss.clearance)} to walk${by}.`;
  }
  const why = {
    overlap: "it would run into other furniture", door: "it would stand in a doorway", swing: "a door would hit it",
    radiator: "it would stand against a radiator", front: "there's no room in front to use it", wall: "the walls are too short",
  };
  const top = Object.entries(misses).filter(([k, n]) => n && why[k]).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => why[k]);
  if (top.length) return `Doesn't fit. Everywhere it could go, ${top.join(" or ")}.`;
  return `Doesn't fit. There's no clear stretch of wall ${piece.size[0].toFixed(2)} m long that keeps the doors and walkways free.`;
}
