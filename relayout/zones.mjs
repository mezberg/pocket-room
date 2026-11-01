// The room's zones, read from what stands where (code, no model): a seating group (the sofa, its coffee table,
// the side tables and lamps beside it, the rug under it), the TV it faces, a dining table with its chairs, a desk
// with its chair, and everything else on its own. A designer moves a zone as one: the coffee table goes with the
// sofa, the chairs with the table.
import { footprint, overlap, sdRect } from "../rules/geom.mjs";
import { blocksFloor, label } from "../rules/grid.mjs";

const isFixture = (room, it) => (room.fixtures ?? []).some((f) => f.id === it.id);
const gap = (a, b) => -overlap(footprint(a), footprint(b)).depth;    // > 0: apart by that much
const text = (it) => `${it.id} ${it.name ?? ""}`;
const KITCHEN = /kitchen|oven|fridge|freezer|counter|worktop|sink|hob|dishwasher|washing machine|built[- ]?in/i;

// Big built-in-like things that stay where they are: kitchen runs, wardrobes, tall cupboards, beds.
export function stays(room, it) {
  if (isFixture(room, it)) return true;
  if (KITCHEN.test(text(it))) return true;
  if (it.category === "radiator" || it.category === "wardrobe" || it.category === "bed") return true;
  if (it.category === "cupboard" && it.size[2] > 1.0) return true;
  return false;
}

export const isTv = (it) => it.category === "tv" || /\b(tv|media|television)\b/i.test(text(it).replace(/_/g, " "));
const isSofa = (it) => it.category === "sofa" || it.category === "armchair";
const lowTable = (it) => it.category === "table" && it.size[2] < 0.6;
const highTable = (it) => (it.category === "table" || it.category === "desk") && it.size[2] >= 0.65;
const isDining = (it) => it.category === "table" && it.size[2] >= 0.65;
// sofa's front direction (front is -uy)
const frontOf = (it) => { const R = footprint(it); return [-R.uy[0], -R.uy[1]]; };

// → [{ id, kind, items: [ids], lead, name, tv?: id }] (every non-fixed piece in exactly one zone)
export function zonesOf(room) {
  const furn = room.furniture ?? [];
  const used = new Set();
  const zones = [];
  const take = (it) => { used.add(it.id); return it.id; };
  // things standing on a piece (on_floor false) travel with it
  const riders = (base) => furn.filter((x) => !used.has(x.id) && x.on_floor === false && x.category !== "rug" && sdRect(footprint(base), x.at) <= 0.02);

  // seating: the sofas that touch (a sectional is two boxes), then what belongs to them
  for (const s of furn.filter((x) => x.category === "sofa" && !stays(room, x))) {
    if (used.has(s.id)) continue;
    const seats = [s];
    for (const o of furn) if (o !== s && isSofa(o) && !used.has(o.id) && !stays(room, o) && seats.some((q) => gap(q, o) < 0.15)) seats.push(o);
    seats.forEach(take);
    const near = (x, d) => seats.some((q) => gap(q, x) < d);
    const items = seats.map((x) => x.id);
    const f = frontOf(s);
    for (const x of furn) {
      if (used.has(x.id) || stays(room, x)) continue;
      // coffee table: low, in front of the sofa within 1.2 m
      const ahead = (x.at[0] - s.at[0]) * f[0] + (x.at[1] - s.at[1]) * f[1] > 0;
      if (lowTable(x) && ahead && near(x, 1.2) && !/side|bedside|night/i.test(text(x))) { items.push(take(x)); continue; }
      // side tables, lamps, a pouf, beside it
      if ((lowTable(x) || x.category === "lamp" || /pouf|ottoman|footstool/i.test(text(x))) && near(x, 0.45)) { items.push(take(x)); continue; }
      // the rug under the seating
      if (x.category === "rug" && seats.some((q) => sdRect(footprint(x), q.at) < 0.6 || overlap(footprint(x), footprint(q)).depth > 0.2)) { items.push(take(x)); continue; }
    }
    for (const id of [...items]) for (const r of riders(furn.find((x) => x.id === id))) items.push(take(r));
    zones.push({ id: `seating:${s.id}`, kind: "seating", lead: s.id, items });
  }

  // the TV each seating group faces (square on within 35°, 1–5 m), with what stands on or against it
  for (const z of zones.filter((z) => z.kind === "seating")) {
    const s = furn.find((x) => x.id === z.lead), f = frontOf(s);
    const tv = furn.filter((x) => isTv(x) && !used.has(x.id) && !stays(room, x)).map((x) => {
      const d = [x.at[0] - s.at[0], x.at[1] - s.at[1]], L = Math.hypot(...d) || 1;
      return { x, L, cos: (d[0] * f[0] + d[1] * f[1]) / L };
    }).filter((t) => t.cos > Math.cos(35 * Math.PI / 180) && t.L > 1 && t.L < 5).sort((a, b) => a.L - b.L)[0]?.x;
    if (!tv) continue;
    const items = [take(tv)];
    for (const x of furn) if (!used.has(x.id) && !stays(room, x) && (x.on_floor === false || x.category === "plant") && gap(tv, x) < 0.05) items.push(take(x));
    zones.push({ id: `tv:${tv.id}`, kind: "tv", lead: tv.id, items, faces: z.id });
    z.tv = `tv:${tv.id}`;
  }

  // dining: a table at least 65 cm high and the chairs round it
  for (const t of furn.filter((x) => isDining(x) && !used.has(x.id) && !stays(room, x) && !/coffee|side/i.test(text(x)))) {
    const items = [take(t)];
    for (const c of furn) if (!used.has(c.id) && (c.category === "chair" || c.category === "stool") && gap(t, c) < 0.35) items.push(take(c));
    for (const r of riders(t)) items.push(take(r));
    zones.push({ id: `dining:${t.id}`, kind: "dining", lead: t.id, items });
  }

  // work: a desk and its chair
  for (const d of furn.filter((x) => x.category === "desk" && !used.has(x.id) && !stays(room, x))) {
    const items = [take(d)];
    for (const c of furn) if (!used.has(c.id) && c.category === "chair" && gap(d, c) < 0.6) items.push(take(c));
    for (const r of riders(d)) items.push(take(r));
    zones.push({ id: `work:${d.id}`, kind: "work", lead: d.id, items });
  }

  // everything else that may move, on its own (with what stands on it)
  for (const x of furn) {
    if (used.has(x.id) || stays(room, x) || x.on_floor === false || !blocksFloor(x)) continue;
    const items = [take(x)];
    for (const r of riders(x)) items.push(take(r));
    zones.push({ id: `piece:${x.id}`, kind: "piece", lead: x.id, items });
  }
  for (const z of zones) z.name = zoneName(room, z);
  return zones;
}

const short = (it) => label(it).replace(/^the /, "");
// "the sofa, coffee table and side table"; "the dining table and its 4 chairs"; "the desk and its chair"
export function zoneName(room, z) {
  const furn = room.furniture ?? [];
  const its = z.items.map((id) => furn.find((x) => x.id === id)).filter((x) => x && x.on_floor !== false && x.category !== "rug");
  const lead = furn.find((x) => x.id === z.lead);
  if (z.kind === "dining" || z.kind === "work") {
    const n = its.length - 1;
    return n ? `${label(lead)} and its ${n > 1 ? `${n} chairs` : "chair"}` : label(lead);
  }
  // a sectional's boxes are one sofa
  const names = [...new Set(its.filter((x) => x.id === z.lead || !isSofa(x) || !isSofa(lead)).map(short))];
  if (names.length <= 1) return label(lead);
  return `the ${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}
