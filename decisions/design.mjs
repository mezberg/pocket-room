// Design grade (5b): six checks a designer would make. Code measures each one; one Decisions request
// judges them all; each answer becomes a `finding` (contract/api.md) with kind "design" and a probability.
// A check whose things aren't in the room (no TV, no coffee table, no new piece) is skipped.
import { decide, messages } from "./client.mjs";
import { r2, dist, front, footprint, frontCentre, polyDist, outline, inRoom, floorArea, openings, isGlazed, isDoor, openingDist, obstacles, byCategory } from "./geom.mjs";

const cm = (m) => `${Math.round(m * 100)} cm`;
const m1 = (m) => `${r2(m).toFixed(1)} m`;
const pct = (x) => `${Math.round(x * 100)}%`;
const centroid = (room) => outline(room).reduce((s, a) => [s[0] + a[0] / room.walls.length, s[1] + a[1] / room.walls.length], [0, 0]);
const compass = (p, room) => {
  const c = centroid(room), ns = p[1] > c[1] ? "north" : "south", ew = p[0] > c[0] ? "east" : "west";
  return `${ns}-${ew}`;
};

// The room's zones: where people sit, eat and work, by what stands there.
function zones(room, piece) {
  const sofa = sofaOf(room, piece), desk = byCategory(room, "desk")[0];
  const dining = (room.furniture ?? []).find((f) => f.category === "table" && /dining/i.test(`${f.id} ${f.name}`));
  return [sofa && { zone: "sofa", at: sofa.at, item: sofa.id }, dining && { zone: "dining table", at: dining.at, item: dining.id },
    desk && { zone: "desk", at: desk.at, item: desk.id }].filter(Boolean);
}

// The sofa the checks talk about: the new piece once it has a spot, else the room's own.
const sofaOf = (room, piece) => (piece?.category === "sofa" && piece.at ? piece : byCategory(room, "sofa")[0]);

// Floor sample points every `step` m inside the room.
function floorGrid(room, step) {
  const o = outline(room), xs = o.map((p) => p[0]), ys = o.map((p) => p[1]), pts = [];
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step)
    for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) if (inRoom([x, y], room)) pts.push([x, y]);
  return pts;
}

// ── light: daylight ──────────────────────────────────────────────────────────────────────────────
// Daylight reaches about twice the window head height into a room (BRE / CIBSE rule of thumb).
const daylight = {
  id: "daylight",
  measure(room, { piece }) {
    const glazing = openings(room).filter(isGlazed);
    if (!glazing.length) return { glazing: [], floor_share_lit: 0, zones: [] };
    const reachOf = (o) => 2 * (o.head ?? 2.1);
    const lit = (p) => glazing.some((o) => openingDist(p, o) <= reachOf(o));
    const grid = floorGrid(room, 0.1);
    const glazedArea = glazing.reduce((s, o) => s + o.width * ((o.head ?? 2.1) - (o.sill ?? 0)), 0);
    return {
      glazing: glazing.map((o) => ({ id: o.id, wall: o.wall, width_m: r2(o.width), head_m: o.head, reach_m: r2(reachOf(o)) })),
      glazing_to_floor: r2(glazedArea / floorArea(room)),
      floor_share_lit: r2(grid.filter(lit).length / grid.length),
      zones: zones(room, piece).map((z) => ({ zone: z.zone, distance_to_glass_m: r2(Math.min(...glazing.map((o) => openingDist(z.at, o)))), lit: lit(z.at) })),
    };
  },
  questions: (f) => [{ name: "daylight", type: "score", instructions: "How well does daylight serve the way this room is used, zone by zone, in the daytime?",
    levels: [{ label: "poor", description: "the zones people use most are past the daylight reach" }, { label: "fair" }, { label: "good", description: "the main zones sit in daylight" }] }],
  say(f, ok) {
    if (!f.glazing.length) return "No windows here, so every zone needs its own light.";
    const dark = f.zones.filter((z) => !z.lit);
    const head = `Daylight reaches ${pct(f.floor_share_lit)} of the floor, about ${m1(f.glazing[0].reach_m)} in from the ${f.glazing[0].wall} glass.`;
    return dark.length ? `${head} The ${dark.map((z) => `${z.zone} (${m1(z.distance_to_glass_m)} away)`).join(" and ")} ${dark.length > 1 ? "sit" : "sits"} past it.` : `${head} ${ok ? "Every zone sits in it." : "Every zone sits in it, just."}`;
  },
  at: (f, room) => { const g = openings(room).find(isGlazed); return g ? g.centre : null; },
};

// ── light: lamps per zone, dark corners ──────────────────────────────────────────────────────────
const LAMP_REACH = 2.0, DARK = 2.5;
const lamps = {
  id: "lamps_per_zone",
  measure(room, { piece }) {
    const lights = room.lights ?? [], glazing = openings(room).filter(isGlazed);
    const zs = zones(room, piece).map((z) => {
      const near = lights.filter((l) => dist(l.at, z.at) <= LAMP_REACH);
      return { zone: z.zone, at: z.at, item: z.item, lights_within_2m: near.map((l) => l.kind), nearest_light_m: r2(Math.min(Infinity, ...lights.map((l) => dist(l.at, z.at)))) };
    });
    const corners = outline(room).map((c) => ({ corner: compass(c, room), at: c,
      nearest_light_m: r2(Math.min(Infinity, ...lights.map((l) => dist(l.at, c)))), nearest_glass_m: r2(Math.min(Infinity, ...glazing.map((o) => openingDist(c, o)))) }));
    return { lights: lights.map((l) => l.kind), zones: zs, corners, dark_corners: corners.filter((c) => c.nearest_light_m > DARK).map((c) => c.corner) };
  },
  questions: () => [{ name: "lamps_per_zone", type: "predicate",
    instructions: "In the evening, with only these lights, every zone has its own light and no corner is left dark. (A pendant lights its zone; a zone with no light within 2 m needs a lamp.)" }],
  say(f) {
    const unlit = f.zones.filter((z) => !z.lights_within_2m.length);
    const parts = [];
    if (unlit.length) parts.push(`The ${unlit.map((z) => z.zone).join(" and ")} ${unlit.length > 1 ? "have" : "has"} no light within 2 m`);
    if (f.dark_corners.length) { const c = f.corners.filter((x) => f.dark_corners.includes(x.corner)).sort((a, b) => b.nearest_light_m - a.nearest_light_m)[0];
      parts.push(`the ${c.corner} corner is ${m1(c.nearest_light_m)} from any light`); }
    if (!parts.length) return `Each zone has its own light: ${f.zones.map((z) => `${z.zone} ${z.lights_within_2m.length}`).join(", ")}.`;
    const s = parts.join(", and ");
    return s[0].toUpperCase() + s.slice(1) + ". A lamp there would help.";
  },
  at(f) {
    const unlit = f.zones.filter((z) => !z.lights_within_2m.length).sort((a, b) => b.nearest_light_m - a.nearest_light_m)[0];
    if (unlit) return unlit.at;
    const c = f.corners.filter((x) => f.dark_corners.includes(x.corner)).sort((a, b) => b.nearest_light_m - a.nearest_light_m)[0];
    return c?.at ?? null;
  },
  items: (f) => f.zones.filter((z) => !z.lights_within_2m.length).map((z) => z.item),
};

// ── flow: the widest route from the hall door to the far door ────────────────────────────────────
// A 5 cm grid; each cell's clearance is its distance to the nearest wall or floor-standing thing.
// The route maximises its narrowest point (a widest-path Dijkstra). Width = twice the clearance.
const STEP = 0.05;
export function widestRoute(room, from, to) {
  const o = outline(room), xs = o.map((p) => p[0]), ys = o.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys), nx = Math.ceil((Math.max(...xs) - x0) / STEP), ny = Math.ceil((Math.max(...ys) - y0) / STEP);
  const polys = obstacles(room).map((f) => ({ id: f.id, poly: footprint(f) }));
  const walls = room.walls.map((w) => [w.a, w.b]);
  const P = (i, j) => [x0 + (i + 0.5) * STEP, y0 + (j + 0.5) * STEP];
  const clear = new Float32Array(nx * ny);
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const p = P(i, j);
    if (!inRoom(p, room)) { clear[i * ny + j] = -1; continue; }
    let c = Math.min(...walls.map(([a, b]) => polyDist(p, [a, b])));
    for (const { poly } of polys) { c = Math.min(c, polyDist(p, poly)); if (c === 0) break; }
    clear[i * ny + j] = c;
  }
  const cell = (p) => [Math.max(0, Math.min(nx - 1, Math.floor((p[0] - x0) / STEP))), Math.max(0, Math.min(ny - 1, Math.floor((p[1] - y0) / STEP)))];
  const [si, sj] = cell(from), [ti, tj] = cell(to);
  const nearEnd = (k) => { const p = P(Math.floor(k / ny), k % ny); return dist(p, from) < 0.6 || dist(p, to) < 0.6; };
  const val = (k) => (nearEnd(k) ? 9 : clear[k]);   // the doorways themselves aren't the furniture's fault
  const best = new Float32Array(nx * ny).fill(-1), prev = new Int32Array(nx * ny).fill(-1), done = new Uint8Array(nx * ny);
  const start = si * ny + sj, goal = ti * ny + tj;
  best[start] = val(start);
  const heap = [start];   // a small binary max-heap on best[]
  const up = (h, i) => { while (i) { const q = (i - 1) >> 1; if (best[h[q]] >= best[h[i]]) break; [h[q], h[i]] = [h[i], h[q]]; i = q; } };
  const down = (h, i) => { for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < h.length && best[h[l]] > best[h[m]]) m = l; if (r < h.length && best[h[r]] > best[h[m]]) m = r; if (m === i) return; [h[m], h[i]] = [h[i], h[m]]; i = m; } };
  while (heap.length) {
    const k = heap[0]; const last = heap.pop(); if (heap.length) { heap[0] = last; down(heap, 0); }
    if (done[k]) continue; done[k] = 1; if (k === goal) break;
    const i = Math.floor(k / ny), j = k % ny;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const n = a * ny + b; if (clear[n] < 0 || done[n]) continue;
      const v = Math.min(best[k], val(n));
      if (v > best[n]) { best[n] = v; prev[n] = k; heap.push(n); up(heap, heap.length - 1); }
    }
  }
  if (!done[goal]) return null;
  // The narrowest point is fixed now; the shortest route among cells at least that wide gives the length.
  const w = best[goal], from0 = new Float64Array(nx * ny).fill(Infinity), back = new Int32Array(nx * ny).fill(-1), q = [[0, start]];
  from0[start] = 0;
  while (q.length) {
    q.sort((a, b) => b[0] - a[0]); const [g, k] = q.pop();
    if (g > from0[k]) continue; if (k === goal) break;
    const i = Math.floor(k / ny), j = k % ny;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const a = i + di, b = j + dj; if (a < 0 || b < 0 || a >= nx || b >= ny) continue;
      const n = a * ny + b; if (clear[n] < 0 || val(n) < w) continue;
      const v = g + STEP * Math.hypot(di, dj);
      if (v < from0[n]) { from0[n] = v; back[n] = k; q.push([v, n]); }
    }
  }
  const length = from0[goal];
  let pinch = goal;
  for (let k = goal; back[k] >= 0; k = back[k]) if (val(back[k]) < val(pinch)) pinch = back[k];
  const at = P(Math.floor(pinch / ny), pinch % ny);
  const named = obstacles(room).map((f) => ({ name: (f.name ?? f.id).toLowerCase(), id: f.id, d: polyDist(at, footprint(f)) }));
  const beside = named.sort((a, b) => a.d - b.d).filter((x) => x.d < clear[pinch] + 0.15).slice(0, 2);
  return { width_m: r2(2 * w), at: at.map(r2), beside: beside.map((x) => x.id), beside_names: beside.map((x) => x.name), length_m: r2(length), straight_m: r2(dist(from, to)) };
}
const flow = {
  id: "flow",
  measure(room) {
    const doors = openings(room).filter(isDoor);
    if (doors.length < 2) return null;
    const into = (o) => [o.centre[0] + o.inward[0] * 0.3, o.centre[1] + o.inward[1] * 0.3];
    const [a, b] = [doors.find((o) => o.kind === "door") ?? doors[0], doors.find((o) => o.kind !== "door") ?? doors[1]];
    const route = widestRoute(room, into(a), into(b));
    if (!route) return { from: a.id, to: b.id, blocked: true };
    return { from: a.id, to: b.id, narrowest_m: route.width_m, at: route.at, beside: route.beside_names, items: route.beside, route_m: route.length_m, straight_m: route.straight_m,
      detour: r2(route.length_m / route.straight_m), guide: "a main route is 0.9 m or more; 0.75 m is the least" };
  },
  questions: (f) => [{ name: "flow", type: "predicate",
    instructions: `Walking from the ${f.from} to the ${f.to} feels easy and direct: no squeezing sideways between furniture, no long way round.` }],
  say(f) {
    const nice = (s) => s.replace(/_/g, " ");
    if (f.blocked) return `There is no way through from the ${nice(f.from)} to the ${nice(f.to)}.`;
    const by = f.beside.length ? `, between the ${f.beside.join(" and the ")}` : "";
    const detour = f.detour > 1.25 ? `, and the way round is ${pct(f.detour - 1)} longer than a straight line` : "";
    return `From the ${nice(f.from)} to the ${nice(f.to)} the narrowest gap is ${cm(f.narrowest_m)}${by}${detour}.`;
  },
  at: (f) => f.at ?? null,
  items: (f) => f.items ?? [],
};

// ── proportion: sofa to TV ───────────────────────────────────────────────────────────────────────
// Misplaced's tvdistance.js: from the front of the couch, 1½–2½ screen sizes is everyday TV, 1–1½ cinema.
const TV_SIZES = [32, 40, 43, 50, 55, 60, 65, 70, 75, 77, 83, 85];
const span = (l) => (!l.length ? "none" : l.length === 1 ? `${l[0]}″` : `${l[0]}–${l[l.length - 1]}″`);
const tvDistance = {
  id: "tv_distance",
  measure(room, { piece }) {
    const sofa = sofaOf(room, piece), tv = byCategory(room, "tv")[0];
    if (!sofa || !tv) return null;
    const fc = frontCentre(sofa), tc = frontCentre(tv), f = front(sofa.rot ?? 0);
    const d = dist(fc, tc), inch = d / 0.0254;
    const off = Math.abs((Math.atan2(tc[1] - fc[1], tc[0] - fc[0]) - Math.atan2(f[1], f[0])) * 180 / Math.PI);
    const benchFits = (s) => (s * 16) / Math.hypot(16, 9) * 0.0254 <= tv.size[0];
    return { sofa: sofa.id ?? "new sofa", tv: tv.id, sofa_to_tv_m: r2(d), off_axis_deg: Math.round(Math.min(off, 360 - off)),
      screens_for_distance: span(TV_SIZES.filter((s) => s >= inch / 2.5 - 0.5 && s <= inch / 1.5 + 0.5)),
      cinema_screens: span(TV_SIZES.filter((s) => s > inch / 1.5 + 0.5 && s <= inch + 0.5)),
      widest_screen_on_bench: span(TV_SIZES.filter(benchFits).slice(-1)), at: tc };
  },
  questions: (f) => [{ name: "tv_distance", type: "predicate",
    instructions: "Watching TV from the sofa is comfortable: the sofa faces the screen square on (within about 30°) and sits at a distance that suits the screen sizes listed." }],
  say: (f) => `The sofa is ${m1(f.sofa_to_tv_m)} from the TV, ${f.off_axis_deg <= 15 ? "square on" : `${f.off_axis_deg}° off to the side`}: a ${f.screens_for_distance} screen suits that distance.`,
  at: (f) => f.at,
  items: (f) => [f.sofa, f.tv].filter(Boolean),
};

// ── proportion: coffee table to sofa ─────────────────────────────────────────────────────────────
// Designers' rule: a coffee table about half to two-thirds the sofa's length, 35–45 cm from its front.
const coffeeTable = {
  id: "coffee_table",
  measure(room, { piece }) {
    const sofa = sofaOf(room, piece), table = (room.furniture ?? []).find((f) => /coffee/i.test(f.id + f.name));
    if (!sofa || !table) return null;
    const len = Math.max(...table.size.slice(0, 2)), sofaLen = sofa.size[0];
    return { sofa: sofa.id ?? "new sofa", table: table.id, sofa_length_m: r2(sofaLen), table_length_m: r2(len), ratio: r2(len / sofaLen),
      gap_m: r2(polyDist(frontCentre(sofa), footprint(table))), guide: "table 1/2 to 2/3 of the sofa's length, 35–45 cm from the sofa", at: table.at };
  },
  questions: () => [{ name: "coffee_table", type: "predicate",
    instructions: "The coffee table is in proportion with the sofa and within easy reach from the seat." }],
  say(f) {
    const r = f.ratio < 0.5 ? "; half to two-thirds looks right" : f.ratio > 0.7 ? "; it crowds the sofa a little" : ", which looks right";
    return `The coffee table is ${pct(f.ratio)} of the sofa's length and ${cm(f.gap_m)} from its front${r}.`;
  },
  at: (f) => f.at,
  items: (f) => [f.table, f.sofa].filter(Boolean),
};

// ── style: does the new piece match ──────────────────────────────────────────────────────────────
const style = {
  id: "style",
  measure(room, { piece }) {
    if (!piece) return null;
    return { piece: { name: piece.name, category: piece.category, style: piece.style },
      room: { style: room.style, furniture: (room.furniture ?? []).map((f) => f.name) }, at: piece.at ?? null, item: piece.id };
  },
  questions: () => [{ name: "style", type: "score", instructions: "How well does the new piece match the room it is going into, in style, colour and material?",
    levels: [{ label: "clashes" }, { label: "neutral" }, { label: "matches" }] }],
  image: (room, { piece }) => (/^(data:image|https:)/.test(piece?.source?.image ?? "") ? [{ type: "input_image", image_url: piece.source.image, detail: "low" }] : []),
  say(f, ok, a) {
    const what = f.piece.name ?? `new ${f.piece.category}`;
    const word = a.level === "matches" ? "matches the room" : a.level === "clashes" ? "may clash with the room" : "sits quietly in the room without adding much";
    return `The ${what.toLowerCase()} ${word}.`;
  },
  at: (f) => f.at,
  items: (f) => [f.item].filter(Boolean),
};

export const CHECKS = [daylight, lamps, flow, tvDistance, coffeeTable, style];

// Probability → pass and severity. 0.5 is the line; under 0.25 is a clear problem.
const grade = (p) => (p == null ? { pass: true, severity: "info" } : p >= 0.5 ? { pass: true, severity: "info" } : p >= 0.25 ? { pass: false, severity: "warn" } : { pass: false, severity: "fail" });

export function measureAll(room, ctx = {}, checks = CHECKS) {
  room = withPiece(room, ctx);
  return checks.map((c) => ({ c, facts: c.measure(room, ctx) })).filter((x) => x.facts);
}

// A placed new piece stands in the room like the rest; ctx.replaces (an item id) takes the old one out.
export function withPiece(room, { piece, replaces } = {}) {
  if (!piece?.at || (room.furniture ?? []).some((f) => f.id === piece.id)) return room;
  const furniture = (room.furniture ?? []).filter((f) => f.id !== replaces);
  return { ...room, furniture: [...furniture, { id: piece.id, name: piece.name, category: piece.category, at: piece.at, size: piece.size, rot: piece.rot ?? 0, on_floor: true }] };
}

// room (contract room.schema.json) in; { findings, decision } out. ctx.piece is the new piece, with `at`/`rot`
// once placed; ctx.replaces is the id of the item it swaps out.
export async function gradeDesign(room, ctx = {}, checks = CHECKS) {
  room = withPiece(room, ctx);
  const measured = measureAll(room, ctx, checks);
  if (!measured.length) return { findings: [], decision: null };
  const facts = Object.fromEntries(measured.map(({ c, facts }) => [c.id, strip(facts)]));
  const images = measured.flatMap(({ c }) => c.image?.(room, ctx) ?? []);
  const input = messages(`Room "${room.name ?? room.id}" (${m1(floorArea(room))}², ceiling ${room.height ?? "?"} m). Measured facts per check:`, facts, images);
  const questions = measured.flatMap(({ c, facts }) => c.questions(facts));
  const d = await decide({ input, questions, cacheKey: `design:${room.id}` });
  const findings = measured.map(({ c, facts }) => {
    const a = d.answers[c.id];
    const p = a?.p == null ? null : r2(a.p);
    const g = grade(p);
    const f = { id: c.id, kind: "design", pass: g.pass, severity: g.severity, probability: p, say: c.say(facts, g.pass, a ?? {}) };
    const at = c.at?.(facts, room); if (at) f.at = at.map(r2);
    const items = c.items?.(facts); if (items?.length) f.items = items;
    return f;
  });
  return { findings, decision: { by: d.model, ms: d.ms, questions: questions.length, tokens: d.usage?.total_tokens } };
}
// Positions are for the 3D marker; the model doesn't need them.
const strip = (facts) => JSON.parse(JSON.stringify(facts, (k, v) => (k === "at" || k === "item" || k === "items" ? undefined : v)));
