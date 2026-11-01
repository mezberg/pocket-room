// Model check (5a): pass/fail rules computed on the room. Each problem becomes a `finding` with
// kind "model", a point for the 3D marker, the items involved, a plain sentence and, where one is obvious,
// a fix that moves one piece (checked: it really clears the problem and breaks nothing else).
import { footprint, outline, outside, overlap, corners, sdRect, sdRoom, doorwayRect, hitsSwing, compass, cm, r2 } from "./geom.mjs";
import { obstacles, buildGrid, routes, targets, clearanceAt, label, openingLabel, reachable, blocksFloor } from "./grid.mjs";
import { WALK_OK, WALK_MIN } from "./place.mjs";

const TUCK = new Set(["chair", "stool"]);           // chairs may tuck under these
const UNDER = new Set(["table", "desk"]);
const under = (c, t) => TUCK.has(c.category) && UNDER.has(t.category) && t.size[2] >= 0.65; // not a coffee table
const tucked = (a, b) => under(a, b) || under(b, a);
const P2 = (p) => [r2(p[0]), r2(p[1])];
const sentence = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// The grid samples clearance at 4 cm cell centres, so a corridor reads up to ~1 cm narrower than it is.
// A way that measures within that of 60 cm is tight, not closed.
const CLOSED = WALK_MIN - 0.01;

export function analyse(room) {
  const O = outline(room);
  const fixed = new Set((room.fixtures ?? []).map((f) => f.id));
  const items = [...(room.fixtures ?? []), ...(room.furniture ?? [])];
  const G = buildGrid(O, obstacles(room));
  const reach = items.filter(reachable);
  const base = routes(G, O, reach, { paths: true });
  const ctx = { room, O, G, fixed, items, base };
  const findings = [
    ...bounds(ctx),
    ...overlaps(ctx),
    ...doors(ctx),
    ...walkways(ctx),
  ];
  return { findings };
}

// --- moving a piece: is the new place legal, and the smallest move that does the job -------------------

function legal(ctx, item, at) {
  const R = footprint(item, at);
  if (outside(ctx.O, R) > 0.01) return false;
  for (const o of ctx.items) {
    if (o.id === item.id || !blocksFloor(o) || tucked(o, item)) continue;
    const before = overlap(footprint(o), footprint(item)).depth;
    if (overlap(footprint(o), R).depth > Math.max(0.01, before + 0.001)) return false;
  }
  for (const op of ctx.O.openings) {
    if (!op.passable) continue;
    if (overlap(doorwayRect(op, 0.5), R).depth > 0.005 || hitsSwing(op, R)) return false;
  }
  return true;
}

function nudge(ctx, item, prefer, ok, maxD = 0.8, maxTries = 60) {
  const dirs = [prefer, [1, 0], [-1, 0], [0, 1], [0, -1], [0.707, 0.707], [-0.707, 0.707], [0.707, -0.707], [-0.707, -0.707]].filter(Boolean);
  let tries = 0;
  for (let d = 0.05; d <= maxD + 1e-9; d += 0.05) {
    for (const v of dirs) {
      const at = [item.at[0] + v[0] * d, item.at[1] + v[1] * d];
      if (!legal(ctx, item, at)) continue;
      if (++tries > maxTries) return null;
      if (ok(at)) return { at: P2(at), d, v };
    }
  }
  return null;
}

const moved = (room, id, at) => ({
  ...room,
  furniture: room.furniture.map((f) => (f.id === id ? { ...f, at } : f)),
});
const fixSay = (item, f) => `Move ${label(item)} ${cm(f.d)} ${compass(f.v)}.`;

// --- 1. inside the walls, on the floor, under the ceiling ---------------------------------------------

function bounds(ctx) {
  const out = [];
  for (const it of ctx.items) {
    const R = footprint(it);
    const isFixed = ctx.fixed.has(it.id);
    if (it.size[2] > ctx.room.height + 0.01) {
      out.push({ id: "too_tall", kind: "model", pass: false, severity: "fail", at: P2(it.at), items: [it.id],
        say: `${sentence(label(it))} is ${cm(it.size[2])} tall; the ceiling is ${cm(ctx.room.height)}.` });
    }
    // Things off the floor (a plant on a bench, a lamp on a table) may overhang the wall face with their
    // leaves or shade; only floor-standing pieces and wall-hung radiators are checked against the walls.
    if (it.on_floor === false && it.category !== "radiator") continue;
    const pen = outside(ctx.O, R);
    if (pen <= 0.03) continue;
    const cs = corners(R);
    if (cs.every((c) => sdRoom(ctx.O, c) < 0) && sdRoom(ctx.O, it.at) < 0) {
      out.push({ id: "off_floor", kind: "model", pass: false, severity: "fail", at: P2(it.at), items: [it.id],
        say: `${sentence(label(it))} is outside the room.` });
      continue;
    }
    // The wall it pokes through: the one nearest its worst corner. Push it back along that wall's normal.
    const worst = cs.reduce((a, c) => (sdRoom(ctx.O, c) < sdRoom(ctx.O, a) ? c : a));
    const wall = ctx.O.walls.reduce((a, w) => (dist(worst, w) < dist(worst, a) ? w : a));
    const f = { id: "through_wall", kind: "model", pass: false, severity: isFixed ? "warn" : "fail", at: P2(worst), items: [it.id],
      say: `${sentence(label(it))} goes ${cm(pen)} into the ${wall.id} wall.` };
    if (!isFixed) {
      const at = [it.at[0] + wall.n[0] * (pen + 0.01), it.at[1] + wall.n[1] * (pen + 0.01)];
      if (outside(ctx.O, footprint(it, at)) <= 0.01) { f.fix = { item: it.id, at: P2(at), rot: it.rot }; f.say += ` Move it ${cm(pen + 0.01)} ${compass(wall.n)}.`; }
    }
    out.push(f);
  }
  return out;
}
const dist = (p, w) => {
  const ab = [w.b[0] - w.a[0], w.b[1] - w.a[1]], ap = [p[0] - w.a[0], p[1] - w.a[1]];
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1]) / (ab[0] ** 2 + ab[1] ** 2)));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t);
};

// --- 2. pieces through each other ----------------------------------------------------------------------

function overlaps(ctx) {
  const out = [];
  const solid = ctx.items.filter(blocksFloor);
  for (let i = 0; i < solid.length; i++) {
    for (let j = i + 1; j < solid.length; j++) {
      const a = solid[i], b = solid[j];
      if (tucked(a, b)) continue;
      const A = footprint(a), B = footprint(b);
      const o = overlap(A, B);
      if (o.depth <= 0.03) continue;
      const pts = [...corners(A).filter((c) => sdRect(B, c) < 0), ...corners(B).filter((c) => sdRect(A, c) < 0)];
      const at = pts.length ? [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length]
        : [(a.at[0] + b.at[0]) / 2, (a.at[1] + b.at[1]) / 2];
      const radiator = a.category === "radiator" || b.category === "radiator";
      const f = { id: radiator ? "on_radiator" : "overlap", kind: "model", pass: false, severity: radiator ? "warn" : "fail", at: P2(at), items: [a.id, b.id],
        say: radiator ? `${sentence(label(ctx.fixed.has(a.id) ? b : a))} stands against ${label(ctx.fixed.has(a.id) ? a : b)}.`
          : `${sentence(label(a))} and ${label(b)} overlap by ${cm(o.depth)}.` };
      // Move the smaller movable one straight out along the shortest way.
      const movers = [[b, o.axis], [a, [-o.axis[0], -o.axis[1]]]].filter(([it]) => !ctx.fixed.has(it.id))
        .sort((p, q) => p[0].size[0] * p[0].size[1] - q[0].size[0] * q[0].size[1]);
      for (const [it, ax] of movers) {
        const other = it === a ? b : a;
        const fx = nudge(ctx, it, ax, (at) => overlap(footprint(other), footprint(it, at)).depth <= 0.01, o.depth + 0.6);
        if (fx) { f.fix = { item: it.id, at: fx.at, rot: it.rot }; f.say += ` ${fixSay(it, fx)}`; break; }
      }
      out.push(f);
    }
  }
  return out;
}

// --- 3. doors that can't open or are stood in -----------------------------------------------------------

function doors(ctx) {
  const out = [];
  for (const op of ctx.O.openings.filter((o) => o.passable)) {
    for (const it of ctx.items.filter(blocksFloor)) {
      const R = footprint(it);
      const swing = hitsSwing(op, R);
      const inWay = overlap(doorwayRect(op, 0.5), R).depth > 0.03;
      if (!swing && !inWay) continue;
      const f = { id: "door_blocked", kind: "model", pass: false, severity: "fail", at: P2(op.mid), items: [it.id],
        say: swing ? `${sentence(openingLabel(op))} hits ${label(it)} when it opens.` : `${sentence(label(it))} stands in ${openingLabel(op)}.` };
      if (!ctx.fixed.has(it.id)) {
        const fx = nudge(ctx, it, op.n, () => true, 1.2); // legal() already keeps doors clear
        if (fx) { f.fix = { item: it.id, at: fx.at, rot: it.rot }; f.say += ` ${fixSay(it, fx)}`; }
      }
      out.push(f);
    }
  }
  return out;
}

// --- 4. walkways: every door to every other door, window and piece you need to reach -------------------

// Floor you can cross at least 60 cm wide falls into connected parts. Ways between different parts are
// closed; all the closed ways between the same two parts are one problem (one wall of furniture).
function parts(G) {
  const comp = new Int32Array(G.kind.length).fill(-1);
  const ok = (i) => G.kind[i] === 2 || (G.kind[i] === 1 && G.clr[i] >= WALK_MIN / 2 - G.res / 4);
  let n = 0;
  for (let s = 0; s < comp.length; s++) {
    if (comp[s] >= 0 || !ok(s)) continue;
    const stack = [s]; comp[s] = n;
    while (stack.length) {
      const c = stack.pop(), x = c % G.nx;
      for (const d of [-1, 1, -G.nx, G.nx]) {
        const j = c + d;
        if (j < 0 || j >= comp.length || comp[j] >= 0 || Math.abs((j % G.nx) - x) > 1 || !ok(j)) continue;
        comp[j] = n; stack.push(j);
      }
    }
    n++;
  }
  return comp;
}

function walkways(ctx) {
  const { O, G, base } = ctx;
  const comp = parts(G);
  const T = new Map(targets(G, O, ctx.items.filter(reachable)).map((t) => [t.id, t]));
  const partOf = (id) => { // the part most of its zone is in
    const count = new Map();
    for (const z of T.get(id)?.zone ?? []) if (comp[z] >= 0) count.set(comp[z], (count.get(comp[z]) ?? 0) + 1);
    let best = `none:${id}`, n = 0;
    for (const [c, k] of count) if (k > n) { best = String(c); n = k; }
    return best;
  };

  // A closed place counts once: from the door that gets closest to it (door to door either way round).
  const closed = new Map();
  for (const r of base.filter((r) => r.width < CLOSED && r.at)) {
    const k = r.type === "door" ? [r.from, r.to].sort().join("|") : r.to;
    if (!closed.has(k) || closed.get(k).width < r.width) closed.set(k, r);
  }
  const groups = [];
  for (const r of [...closed.values(), ...base.filter((r) => r.width >= CLOSED && r.width < WALK_OK && r.at)]) {
    if (r.width < CLOSED) {
      const k = [partOf(r.from), partOf(r.to)].sort().join("|");
      const g = groups.find((g) => g.closed && (g.key === k || g.routes.some((x) => Math.hypot(x.at[0] - r.at[0], x.at[1] - r.at[1]) < 0.35)));
      if (g) g.routes.push(r); else groups.push({ key: k, closed: true, routes: [r] });
    } else {
      const g = groups.find((g) => !g.closed && g.routes.some((x) => Math.hypot(x.at[0] - r.at[0], x.at[1] - r.at[1]) < 0.35));
      if (g) g.routes.push(r); else groups.push({ closed: false, routes: [r] });
    }
  }

  // Closed groups that squeeze through the same place are one problem too.
  const close = (g, h) => g.routes.some((x) => h.routes.some((y) => Math.hypot(x.at[0] - y.at[0], x.at[1] - y.at[1]) < 0.35));
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (groups[i].closed && groups[j].closed && close(groups[i], groups[j])) {
        groups[i].routes.push(...groups[j].routes); groups.splice(j, 1); j = i;
      }
    }
  }

  // Where along the narrowest stretch two things pinch the way (rather than one corner on an open side).
  const solid = ctx.items.filter(blocksFloor).map((it) => footprint(it));
  const pinch = (p, c) => solid.filter((R) => sdRect(R, p) < c + 0.06).length + O.walls.filter((w) => dist(p, w) < c + 0.06).length;
  for (const g of groups) for (const r of g.routes) {
    if (!r.path || r.width <= 0) continue;
    const half = Math.max(0, (r.width - G.res / 2) / 2);
    // Only points at the bottleneck itself (within a quarter cell): a wider stretch elsewhere on the way,
    // say a 60 cm corridor before a 49 cm gap, must not take the marker away from the real pinch.
    const pts = r.path.filter((p) => clearanceAt(G, p) <= half + G.res / 4);
    const two = pts.find((p) => pinch(p, clearanceAt(G, p)) >= 2);
    if (two) r.at = two;
  }

  const before = new Map(base.map((x) => [`${x.from}>${x.to}`, x.width]));
  const out = [];
  for (const g of groups) {
    // The best way through is where to open it up.
    g.routes.sort((a, b) => b.width - a.width);
    const r = g.closed ? g.routes[0] : g.routes[g.routes.length - 1];
    const onlyWindows = g.routes.every((x) => x.type === "window");
    const near = ctx.items.filter(blocksFloor).map((it) => ({ it, d: sdRect(footprint(it), r.at) }))
      .filter((x) => x.d < Math.max(r.width / 2, 0) + 0.1).sort((a, b) => a.d - b.d);
    const walls = O.walls.filter((w) => dist(r.at, w) < Math.max(r.width / 2, 0) + 0.1).map((w) => `the ${w.id.replace(/_/g, " ")} wall`);
    const names = [...near.slice(0, 2).map((x) => label(x.it)), ...walls].slice(0, 2);
    const by = names.length ? `, by ${names.join(" and ")}` : "";
    let say;
    if (g.closed) {
      // Name the places on the far side, as seen from this door.
      const near0 = partOf(r.from);
      const tos = [...new Set(g.routes.map((x) => (partOf(x.to) === near0 ? x.fromLabel : x.toLabel)))];
      const list = tos.length > 3 ? `${tos.slice(0, 3).join(", ")} and ${tos.length - 3} more` : tos.join(", ").replace(/, ([^,]*)$/, " and $1");
      say = r.width <= 0.05
        ? `There's no way from ${r.fromLabel} to ${list}${by}.`
        : `There's no proper way from ${r.fromLabel} to ${list}: the widest gap is ${cm(r.width)}${by}.`;
    } else {
      const others = g.routes.length - 1;
      // within the grid's sampling error of 60 cm: say 60, the floor of "just fits"
      say = `The walkway from ${r.fromLabel} to ${r.toLabel}${others ? ` (and ${others} other way${others > 1 ? "s" : ""})` : ""} is ${cm(Math.max(r.width, WALK_MIN))}${by}.`;
    }
    const f = {
      id: g.closed ? "path_blocked" : "walkway_tight", kind: "model", pass: false,
      severity: g.closed && !onlyWindows ? "fail" : "warn",
      at: P2(r.at), items: near.slice(0, 3).map((x) => x.it.id), say, width_m: r2(g.closed ? r.width : Math.max(r.width, WALK_MIN)), path: r.path,
    };
    // Fix: move one movable piece at the narrow spot until this way is 75 cm and no other way gets worse.
    const need = WALK_OK - r.width;
    for (const { it } of need <= 0.6 ? near.filter((x) => !ctx.fixed.has(x.it.id)).slice(0, 2) : []) {
      const away = [it.at[0] - r.at[0], it.at[1] - r.at[1]];
      const L = Math.hypot(...away) || 1;
      const fx = nudge(ctx, it, [away[0] / L, away[1] / L], (at) => {
        const room2 = moved(ctx.room, it.id, at);
        const rs = routes(buildGrid(O, obstacles(room2)), O, ctx.items.filter(reachable).map((x) => (x.id === it.id ? { ...x, at } : x)));
        return rs.every((x) => {
          const b = before.get(`${x.from}>${x.to}`) ?? 0;
          if (x.from === r.from && x.to === r.to) return x.width >= WALK_OK;
          return x.width >= Math.min(b, WALK_OK) - 0.03;
        });
      }, need + 0.25, 25);
      if (fx) { f.fix = { item: it.id, at: fx.at, rot: it.rot }; f.say += ` ${fixSay(it, fx)}`; break; }
    }
    out.push(f);
  }
  if (!groups.length) {
    out.push({ id: "walkways_ok", kind: "model", pass: true, severity: "info", say: `Every walkway is at least ${cm(WALK_OK)}.` });
  }
  return out;
}
