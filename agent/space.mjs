// The space a new piece can take against one wall. Pure geometry, no model.
// Stand-in until lane D's rules/ lands: everything goes through freeSpace(), so swapping it is one import.
//
// A wall runs a → b; the room is on its left (walls go counter-clockwise, see contract/README.md).
// "Along" t is metres from a; "out" n is metres into the room.

export const AGAINST_WALL_M = 0.3;   // anything nearer the wall than this blocks the run
export const WALKWAY_M = 0.75;       // contract: minimum walkway
export const KNEE_ROOM_M = 0.45;     // sofa edge to coffee table
export const TIGHT_M = 0.15;         // contract: "Just fits" = walkway 0.6–0.75 m
const DOOR_SIDE_M = 0.1;             // keep clear of door frames
// Small things that get moved out of the way; they block the wall but not the room in front.
const MOVABLE = new Set(["chair", "plant", "lamp"]);

const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
const dot = (p, q) => p[0] * q[0] + p[1] * q[1];

function frame(wall) {
  const d = sub(wall.b, wall.a);
  const len = Math.hypot(...d);
  const u = [d[0] / len, d[1] / len];
  return { len, u, n: [-u[1], u[0]], a: wall.a };
}

// Plan footprint corners of an item {at, size, rot}. Width along local x, depth along local y.
export function corners({ at, size, rot = 0 }) {
  const [w, d] = size, r = (rot * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]]
    .map(([x, y]) => [at[0] + x * c - y * s, at[1] + x * s + y * c]);
}

// An item seen from a wall: its span along the wall and its nearest/farthest distance out from it.
function project(f, item) {
  const pts = corners(item).map((p) => { const v = sub(p, f.a); return [dot(v, f.u), dot(v, f.n)]; });
  const ts = pts.map((p) => p[0]), ns = pts.map((p) => p[1]);
  return { t0: Math.min(...ts), t1: Math.max(...ts), n0: Math.min(...ns), n1: Math.max(...ns) };
}

function subtract(runs, [b0, b1]) {
  return runs.flatMap(([r0, r1]) => {
    if (b1 <= r0 || b0 >= r1) return [[r0, r1]];
    return [[r0, b0], [b1, r1]].filter(([x, y]) => y - x > 1e-6);
  });
}

/**
 * Free runs along one wall.
 * @param room   contract room
 * @param wallId wall id
 * @param opts.replace category whose existing pieces are being replaced (ignored as obstacles)
 * @returns { wall, wall_length, runs: [{ from, to, length, depth, front, open, at, rot }] }, longest run first.
 *   depth = how far out a piece filling the run may come before it eats the walkway (or knee room to a
 *   coffee table) in front; front = those obstacles, so fitIn() can slide a shorter piece past them.
 *   at/rot = the centre of the run and how a piece there faces (front away from the wall).
 */
export function freeSpace(room, wallId, { replace } = {}) {
  const wall = room.walls.find((w) => w.id === wallId);
  if (!wall) throw new Error(`no wall ${wallId}`);
  const f = frame(wall);
  let runs = [[0, f.len]];

  // Openings: doors and low windows block; a window with a sill above 0.9 m can have a piece under it.
  for (const o of wall.openings ?? []) {
    if (o.kind === "window" && (o.sill ?? 0) >= 0.9) continue;
    runs = subtract(runs, [o.from - DOOR_SIDE_M, o.from + o.width + DOOR_SIDE_M]);
  }

  // Doors on other walls whose swing comes near this wall.
  for (const w of room.walls) {
    if (w === wall) continue;
    const g = frame(w);
    for (const o of w.openings ?? []) {
      if (!/door/.test(o.kind)) continue;
      // The door's swing (or, for a door with none, the walkway through it) as a box in front of it.
      const reach = Math.max(o.swing ? o.width : 0, WALKWAY_M);
      const at = (t, n) => [g.a[0] + g.u[0] * t + g.n[0] * n, g.a[1] + g.u[1] * t + g.n[1] * n];
      const pr = [at(o.from, 0), at(o.from + o.width, 0), at(o.from, reach), at(o.from + o.width, reach)]
        .map((p) => { const v = sub(p, f.a); return [dot(v, f.u), dot(v, f.n)]; });
      if (Math.min(...pr.map((p) => p[1])) < AGAINST_WALL_M) {
        runs = subtract(runs, [Math.min(...pr.map((p) => p[0])), Math.max(...pr.map((p) => p[0]))]);
      }
    }
  }

  const items = [...(room.fixtures ?? []), ...(room.furniture ?? [])]
    .filter((it) => !(replace && it.category === replace))
    // Things on a table or shelf don't take floor; a radiator on the wall still keeps a sofa off it.
    .filter((it) => it.on_floor !== false || it.category === "radiator")
    .map((it) => ({ it, p: project(f, it) }))
    .filter(({ p }) => p.t1 > 0 && p.t0 < f.len && p.n1 > 0);

  const against = items.filter(({ p }) => p.n0 < AGAINST_WALL_M);
  for (const { p } of against) runs = subtract(runs, [p.t0, p.t1]);

  const roomDepth = Math.max(...room.walls.flatMap((w) => [w.a, w.b]).map((q) => dot(sub(q, f.a), f.n)));
  const rot = (((Math.atan2(f.n[1], f.n[0]) * 180) / Math.PI + 90) % 360 + 360) % 360;

  const front = items
    .filter(({ it, p }) => p.n0 >= AGAINST_WALL_M && !MOVABLE.has(it.category))
    .map(({ it, p }) => ({ id: it.id, t0: p.t0, t1: p.t1, limit: p.n0 - (it.category === "table" && it.size[2] < 0.6 ? KNEE_ROOM_M : WALKWAY_M) }));
  const open = roomDepth - WALKWAY_M;

  return {
    wall: wallId,
    wall_length: round(f.len),
    runs: runs.map(([t0, t1]) => {
      const inRun = front.filter((o) => o.t1 > t0 && o.t0 < t1);
      const tm = (t0 + t1) / 2;
      return {
        from: round(t0), to: round(t1), length: round(t1 - t0),
        depth: round(Math.max(0, Math.min(open, ...inRun.map((o) => o.limit)))),  // if the piece filled the run
        front: inRun.map((o) => ({ ...o, t0: round(o.t0), t1: round(o.t1), limit: round(Math.max(0, o.limit)) })),
        open: round(open),
        at: point(f, tm), rot: Math.round(rot),
      };
    }).sort((x, y) => y.length - x.length),
    _frame: f,
  };
}

// The wall with the longest free run, for "find me a sofa" with no wall named.
export function bestWall(room, opts) {
  return room.walls.map((w) => freeSpace(room, w.id, opts))
    .filter((s) => s.runs.length)
    .sort((x, y) => y.runs[0].length - x.runs[0].length)[0];
}

/**
 * Where a piece of size [w, d, h] goes in a run, sliding it along to find the most room in front.
 * Numbers only; reasons are written from these.
 * @returns { verdict, fits, spare_m (along the wall), depth_m (room in front allowed), depth_spare_m, at, rot }
 *   verdict: "Fits" with the full walkway, "Just fits" when the walkway is 0.6–0.75 m, else "Doesn't fit".
 */
export function fitIn(space, run, size) {
  const [w, d] = size;
  const spare = run.length - w;
  if (spare < 0) return { verdict: "Doesn't fit", fits: false, spare_m: round(spare), depth_m: 0, depth_spare_m: round(-d) };
  // Candidate left edges: the run's ends and every edge of an obstacle in front.
  const cands = [run.from, run.to - w, ...run.front.flatMap((o) => [o.t1, o.t0 - w])]
    .filter((t) => t >= run.from - 1e-9 && t + w <= run.to + 1e-9);
  let best = null;
  for (const t of cands) {
    const depth = Math.min(run.open, ...run.front.filter((o) => o.t1 > t + 1e-9 && o.t0 < t + w - 1e-9).map((o) => o.limit));
    if (!best || depth > best.depth) best = { t, depth };
  }
  const f = space._frame;
  const verdict = d <= best.depth ? "Fits" : d <= best.depth + TIGHT_M ? "Just fits" : "Doesn't fit";
  return {
    verdict, fits: verdict !== "Doesn't fit", spare_m: round(spare), depth_m: round(best.depth), depth_spare_m: round(best.depth - d),
    t: round(best.t + w / 2), at: f ? point(f, best.t + w / 2, d / 2) : null, rot: run.rot,
  };
}

const point = (f, t, n = 0) => [round(f.a[0] + f.u[0] * t + f.n[0] * n), round(f.a[1] + f.u[1] * t + f.n[1] * n)];
const round = (x) => Math.round(x * 1000) / 1000;
