// Misplaced — parametric furniture kit in the low-poly realism look (reference: style-3d-real.html).
// Same builders and parameters as kit.js, so a scene can switch looks by swapping the import.
// What changes is the form: every edge is chamfered, upholstery is puffed, wood legs taper,
// round things have few, visible facets. Materials come from real.js.
// Metres, y-up, origin at the centre of the footprint on the floor, front faces +z.
// Wall pieces (windowFrame, curtains, fireplace, a tv on a bracket) have their origin on the wall's room
// face at floor level, centred: shell.js place(obj, F.back, t) hangs them on a wall.
// Pieces that a control moves get set(params): it moves or reshapes them in place, no rebuild, so a page
// can ease the numbers every frame. real.js sees the change and redraws the shadow map by itself.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { paint } from "./real.js";

const EDGE = 0.004;    // chamfer on hard edges (wood, metal, stone)
const IN = 0.0254;

function place(g, geo, color, x, y, z, double = false) {
  const m = new THREE.Mesh(geo, paint(color, 1, { double }));
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  g.add(m);
  return m;
}

// box sitting on y, centred on x/z; hard edges get a 4 mm chamfer, r > 0 a bigger one
function box(g, color, w, h, d, x = 0, y = 0, z = 0, r = 0) {
  const rr = Math.min(Math.max(r, EDGE), w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  return place(g, new RoundedBoxGeometry(w, h, d, r > 0.02 ? 2 : 1, rr), color, x, y + h / 2, z);
}

// upholstery: a chamfered box whose top and bottom bulge in the middle
function cushion(g, color, w, h, d, x = 0, y = 0, z = 0, { r = 0.03, puff = 0.25 } = {}) {
  const rr = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const geo = new RoundedBoxGeometry(w, h, d, 2, rr);
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const fx = 1 - (2 * v.x / w) ** 2, fz = 1 - (2 * v.z / d) ** 2;
    v.y *= 1 + puff * Math.max(0, fx) * Math.max(0, fz);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return place(g, geo, color, x, y + h / 2, z);
}

function cyl(g, color, r, h, x = 0, y = 0, z = 0, { top = r, seg = 12 } = {}) {
  return place(g, new THREE.CylinderGeometry(top, r, h, seg), color, x, y + h / 2, z);
}

// four legs inset from the footprint corners; wood legs taper towards the floor
function legs(g, color, w, d, h, t, inset, { round = false, taper = 1 } = {}) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = sx * (w / 2 - inset), z = sz * (d / 2 - inset);
    if (round || taper < 1) cyl(g, color, (t / 2) * taper, h, x, 0, z, { top: t / 2, seg: round ? 8 : 4 });
    else box(g, color, t, h, t, x, 0, z);
  }
}
const isWood = c => c === "oak" || c === "walnut";

// ------------------------------------------------------------------ seating
export function sofa({ seats = 3, seatW = 0.62, depth = 0.9, arms = "slim", legs: legType = "block",
  chaise = false, pillows = 0, color = "linen", pillow = "moss", wood = "oak" } = {}) {
  const g = new THREE.Group();
  const armW = { none: 0, slim: 0.12, wide: 0.24 }[arms];
  const legH = { block: 0.05, metal: 0.15, frame: 0.12 }[legType];
  const W = seats * seatW + 2 * armW;
  const seatH = 0.13, baseH = 0.44 - seatH - legH, backT = 0.16, top = legH + baseH;

  const body = new THREE.Group();
  g.add(body);
  box(body, color, W - 2 * armW + 0.02, baseH, depth, 0, legH, 0, 0.02);
  box(body, color, W - 2 * armW + 0.02, 0.8 - top, backT, 0, top, -depth / 2 + backT / 2, 0.03);
  if (armW) for (const s of [-1, 1]) cushion(body, color, armW, 0.6 - legH, depth, s * (W / 2 - armW / 2), legH, 0, { r: arms === "wide" ? 0.06 : 0.03, puff: 0.04 });
  for (let i = 0; i < seats; i++) {
    const x = -W / 2 + armW + seatW * (i + 0.5);
    cushion(body, color, seatW - 0.012, seatH, depth - backT - 0.02, x, top, backT / 2 + 0.005, { r: 0.035, puff: 0.22 });
    const back = cushion(body, color, seatW - 0.012, 0.34, 0.14, x, top + seatH - 0.02, -depth / 2 + backT + 0.06, { r: 0.045, puff: 0 });
    back.rotation.x = -0.08;
  }

  if (chaise) {
    const cw = seatW + armW, cd = 0.7, cx = W / 2 - cw / 2, cz = depth / 2 + cd / 2;
    box(body, color, cw, baseH, cd, cx, legH, cz, 0.02);
    cushion(body, color, cw - 0.012, seatH, cd - 0.012, cx, top, cz, { r: 0.035, puff: 0.22 });
    addLegs(cw, cd, cx, cz);
  }

  function addLegs(w, d, ox, oz) {
    const lg = new THREE.Group();
    lg.position.set(ox, 0, oz);
    if (legType === "block") legs(lg, "walnut", w, d, legH, 0.05, 0.06, { taper: 0.8 });
    if (legType === "metal") legs(lg, "black", w, d, legH, 0.022, 0.05, { round: true });
    if (legType === "frame") {
      legs(lg, wood, w, d, legH, 0.04, 0.03);
      box(lg, wood, w + 0.02, 0.035, d + 0.02, 0, legH - 0.035, 0);
    }
    g.add(lg);
  }
  addLegs(W, depth, 0, 0);

  for (let i = 0; i < pillows; i++) {
    const s = i % 2 ? 1 : -1;
    const p = cushion(g, pillow, 0.42, 0.42, 0.1, s * (W / 2 - armW - 0.28), top + seatH - 0.02, -depth / 2 + backT + 0.2, { r: 0.05, puff: 0 });
    p.geometry = puffZ(p.geometry, 0.42, 0.42, 0.9);
    p.rotation.set(-0.3, 0, s * -0.12);
  }
  return g;
}

// throw pillow: bulge front and back instead of top and bottom
function puffZ(geo, w, h, puff) {
  const p = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const f = Math.max(0, 1 - (2 * v.x / w) ** 2) * Math.max(0, 1 - (2 * v.y / h) ** 2);
    v.z *= 1 + puff * f;
    v.x *= 1 - 0.06 * (1 - Math.abs(2 * v.y / h));     // corners pinch in a little
    p.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

export const armchair = (o = {}) => sofa({ seats: 1, seatW: 0.64, arms: "wide", ...o });

export function diningChair({ color = "moss", wood = "oak" } = {}) {
  const g = new THREE.Group();
  legs(g, wood, 0.44, 0.44, 0.42, 0.034, 0.04, { taper: 0.7 });
  box(g, wood, 0.42, 0.03, 0.42, 0, 0.39, 0);
  cushion(g, color, 0.46, 0.05, 0.46, 0, 0.42, 0, { r: 0.02, puff: 0.35 });
  const back = cushion(g, color, 0.44, 0.34, 0.05, 0, 0.54, -0.2, { r: 0.02, puff: 0 });
  back.rotation.x = -0.1;
  for (const s of [-1, 1]) box(g, wood, 0.032, 0.16, 0.032, s * 0.18, 0.42, -0.19);
  return g;
}

// ------------------------------------------------------------------ tables
export function coffeeTable({ w = 1.1, d = 0.6, h = 0.42, top = "oak", base = "legs", round = false } = {}) {
  const g = new THREE.Group();
  if (round) {
    cyl(g, top, w / 2, 0.035, 0, h - 0.035, 0, { seg: 20 });
    const ring = place(g, new THREE.TorusGeometry(w / 2 - 0.03, 0.012, 4, 20), "black", 0, 0.012, 0);
    ring.rotation.x = Math.PI / 2;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4, r = w / 2 - 0.03;
      cyl(g, "black", 0.012, h - 0.035, Math.cos(a) * r, 0, Math.sin(a) * r, { seg: 6 });
    }
    return g;
  }
  if (base === "box") { box(g, top, w, h, d, 0, 0, 0, 0.015); return g; }
  box(g, top, w, 0.04, d, 0, h - 0.04, 0, 0.008);
  if (base === "legs") {
    const c = isWood(top) ? top : "black";
    legs(g, c, w, d, h - 0.04, 0.05, 0.05, isWood(c) ? { taper: 0.7 } : {});
  }
  if (base === "frame") {
    legs(g, "black", w, d, h - 0.04, 0.025, 0.03);
    for (const s of [-1, 1]) {
      box(g, "black", w - 0.06, 0.025, 0.025, 0, 0, s * (d / 2 - 0.03));
      box(g, "black", 0.025, 0.025, d - 0.06, s * (w / 2 - 0.03), 0, 0);
    }
  }
  return g;
}

export function diningTable({ w = 1.6, d = 0.85, h = 0.75, top = "oak", base = "wood", round = false } = {}) {
  const g = new THREE.Group();
  const leg = base === "wood" ? top : "black", t = base === "wood" ? 0.06 : 0.04;
  const opt = base === "wood" ? { taper: 0.7 } : { round: true };
  if (round) {
    cyl(g, top, w / 2, 0.04, 0, h - 0.04, 0, { seg: 24 });
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4, r = w / 2 - 0.16;
      cyl(g, leg, (t / 2) * (opt.taper ?? 1), h - 0.04, Math.cos(a) * r, 0, Math.sin(a) * r, { top: t / 2, seg: opt.round ? 8 : 4 });
    }
    return g;
  }
  box(g, top, w, 0.04, d, 0, h - 0.04, 0, 0.008);
  box(g, leg, w - 0.2, 0.07, d - 0.2, 0, h - 0.11, 0);   // apron under the top
  legs(g, leg, w, d, h - 0.04, t, 0.07, opt);
  return g;
}

export function desk({ w = 1.2, d = 0.6, top = "oak", base = "frame" } = {}) {
  const g = diningTable({ w, d, h: 0.74, top, base: base === "frame" ? "metal" : "wood" });
  if (base === "frame") for (const s of [-1, 1]) box(g, "black", 0.04, 0.04, d - 0.14, s * (w / 2 - 0.07), 0.04, 0);
  return g;
}

// ------------------------------------------------------------------ bedroom
export function bed({ w = 1.6, l = 2.0, frame = "oak", headboard = "panel", duvet = "linen", throwColor = null } = {}) {
  const g = new THREE.Group();
  legs(g, frame, w + 0.06, l + 0.04, 0.08, 0.06, 0.06);
  box(g, frame, w + 0.08, 0.24, l + 0.04, 0, 0.08, 0, headboard === "upholstered" ? 0.03 : 0.01);
  cushion(g, "cream", w - 0.02, 0.2, l - 0.04, 0, 0.26, 0.01, { r: 0.04, puff: 0.08 });
  cushion(g, duvet, w + 0.04, 0.08, l * 0.68, 0, 0.42, l / 2 - l * 0.34 + 0.01, { r: 0.035, puff: 0.6 });
  if (throwColor) cushion(g, throwColor, w + 0.06, 0.06, 0.36, 0, 0.47, l / 2 - 0.3, { r: 0.025, puff: 0.3 });
  for (const s of [-1, 1]) {
    const p = cushion(g, "cream", w / 2 - 0.1, 0.12, 0.4, s * (w / 4 - 0.01), 0.44, -l / 2 + 0.28, { r: 0.05, puff: 0.7 });
    p.rotation.x = -0.18;
  }
  const hb = headboard === "upholstered" ? duvet === "linen" ? "slate" : duvet : frame;
  if (headboard === "upholstered") {
    const h = cushion(g, hb, w + 0.1, 1.0, 0.09, 0, 0.08, -l / 2 - 0.045, { r: 0.04, puff: 0 });
    h.geometry = puffZ(h.geometry, w + 0.1, 1.0, 0.5);
  } else box(g, hb, w + 0.1, 1.0, 0.04, 0, 0.08, -l / 2 - 0.04, 0.01);
  return g;
}

export function nightstand({ color = "oak", w = 0.45, d = 0.4 } = {}) {
  const g = new THREE.Group();
  legs(g, color, w, d, 0.08, 0.04, 0.04, isWood(color) ? { taper: 0.7 } : {});
  box(g, color, w, 0.44, d, 0, 0.08, 0, 0.008);
  box(g, color, w - 0.04, 0.17, 0.012, 0, 0.32, d / 2 + 0.005);
  box(g, "black", 0.1, 0.012, 0.012, 0, 0.4, d / 2 + 0.017);
  return g;
}

// ------------------------------------------------------------------ storage
export function wardrobe({ w = 1.0, h = 2.0, d = 0.6, doors = 2, color = "oak" } = {}) {
  const g = new THREE.Group();
  box(g, color, w, h - 0.06, d, 0, 0.06, 0);
  box(g, "black", w - 0.06, 0.06, d - 0.06, 0, 0, 0);
  const dw = (w - 0.02) / doors;
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + 0.01 + dw * (i + 0.5);
    box(g, color, dw - 0.008, h - 0.1, 0.016, x, 0.08, d / 2 + 0.008);
    const hx = x + (i % 2 ? -1 : 1) * (dw / 2 - 0.05);
    cyl(g, "black", 0.008, 0.32, hx, 0.85, d / 2 + 0.03, { seg: 6 });
  }
  return g;
}

export function shelf({ w = 0.9, h = 1.8, d = 0.35, shelves = 5, frame = "black", board = "oak" } = {}) {
  const g = new THREE.Group();
  legs(g, frame, w, d, h, 0.025, 0.0125);
  for (let i = 0; i < shelves; i++) box(g, board, w - 0.025, 0.025, d - 0.01, 0, 0.06 + i * (h - 0.1) / (shelves - 1), 0);
  return g;
}

export function sideboard({ w = 1.6, h = 0.62, d = 0.45, doors = 3, color = "clay", base = "black" } = {}) {
  const g = new THREE.Group();
  legs(g, base, w - 0.04, d - 0.04, 0.16, 0.03, 0.03, isWood(base) ? { taper: 0.7 } : { round: true });
  box(g, color, w, h - 0.16, d, 0, 0.16, 0, 0.01);
  const dw = (w - 0.02) / doors;
  for (let i = 0; i < doors; i++) {
    const x = -w / 2 + 0.01 + dw * (i + 0.5);
    box(g, color, dw - 0.01, h - 0.2, 0.014, x, 0.18, d / 2 + 0.007);
    box(g, "black", 0.012, 0.012, 0.012, x + dw / 2 - 0.05, 0.18 + h - 0.27, d / 2 + 0.018);
  }
  return g;
}

// a chest of drawers: rows × 2 drawer fronts with bar pulls
export function dresser({ w = 1.52, h = 0.8, d = 0.46, rows = 3, color = "oak", base = "oak" } = {}) {
  const g = new THREE.Group();
  legs(g, base, w - 0.04, d - 0.04, 0.1, 0.035, 0.03, isWood(base) ? { taper: 0.7 } : { round: true });
  box(g, color, w, h - 0.1, d, 0, 0.1, 0, 0.01);
  const rh = (h - 0.14) / rows, dw = (w - 0.03) / 2;
  for (let r = 0; r < rows; r++) for (const s of [-1, 1]) {
    const y = 0.12 + r * rh, x = s * (dw / 2 + 0.005);
    box(g, color, dw - 0.01, rh - 0.012, 0.014, x, y, d / 2 + 0.007);
    box(g, "black", 0.12, 0.012, 0.012, x, y + rh / 2 - 0.012, d / 2 + 0.02);
  }
  return g;
}

// ------------------------------------------------------------------ screens
// a 16:9 flat TV; size = diagonal in inches. mount "wall": screen centre at `centre` m;
// "stand": on feet on a surface at `base` m. Front faces +z. userData.screen = { w, h, y, z } (m):
// size, centre height, and the glass's distance in front of the origin (the wall face, or the stand's middle).
// bracket (wall mount): a flat mount behind it, origin on the wall face (the TV stands out 11 cm).
// set({ size, centre }) resizes the TV around its centre (on a stand: on its feet) and, on the wall,
// moves it to a new centre height; the bracket keeps its size and follows.
export function tv({ size = 65, mount = "wall", base = 0, centre = 1.07, bracket = false } = {}) {
  const g = new THREE.Group(), body = new THREE.Group();
  g.add(body);
  const diag = size * 0.0254, w = diag * 16 / Math.hypot(16, 9), h = diag * 9 / Math.hypot(16, 9);
  const bez = 0.008, t = 0.028;
  const cy = mount === "stand" ? base + 0.07 + bez + h / 2 : centre;
  const wall = bracket && mount !== "stand", dz = wall ? TV_MOUNT.d + t / 2 + 0.045 : 0;
  box(body, "black", w + 2 * bez, h + 2 * bez, t, 0, cy - h / 2 - bez, dz);
  box(body, "charcoal", w, h, 0.004, 0, cy - h / 2, dz + t / 2 + 0.001);
  box(body, "black", w * 0.6, h * 0.55, 0.05, 0, cy - h * 0.3, dz - t / 2 - 0.02, 0.01);
  if (mount === "stand") for (const s of [-1, 1]) box(body, "black", 0.05, 0.07, 0.24, s * (w / 2 - 0.12), base, 0);
  const plate = new THREE.Group();
  if (wall) {
    // flat mount: two rails on the wall, two arms hooked on them and screwed to the TV's back
    plate.position.y = cy;
    const pw = Math.min(TV_MOUNT.w, w * 0.5), ah = Math.min(0.46, h * 0.6);
    for (const s of [-1, 1]) {
      box(plate, "black", pw, 0.035, 0.016, 0, s * 0.11 - 0.0175, 0.008);
      box(plate, "black", 0.03, ah, 0.019, s * pw * 0.32, -ah / 2 - 0.03, TV_MOUNT.d - 0.0095);
    }
    g.add(plate);
  }
  const screen = g.userData.screen = { w, h, y: cy, z: dz + t / 2 + 0.003 };
  const pivot = mount === "stand" ? base : cy;
  g.set = ({ size: s1 = size, centre: c1 = centre } = {}) => {
    const k = s1 / size, at = mount === "stand" ? base : c1;
    body.scale.set(k, k, 1);
    body.position.y = at - pivot * k;
    plate.position.y = c1;
    Object.assign(screen, { w: w * k, h: h * k, y: at + (cy - pivot) * k });
    return g;
  };
  return g;
}
export const TV_MOUNT = { w: 0.6, d: 0.035 };   // flat mount: rail width, wall to the TV's back (m)

// ------------------------------------------------------------------ walls: window, curtains, fireplace
// A window for a shell.js opening { t0, t1, y0, y1 } (w = t1 - t0): frame and glass in the wall,
// casing (trim) round it on the room side, a stool (inside sill) and an apron under it.
// rails: horizontal bars (1 = a double-hung window's meeting rail); bars: vertical ones.
// userData: { trimTop (top of the casing above the floor), trimW (casing, outside to outside) }
export function windowFrame({ w = 1.2, y0 = 0.9, y1 = 2.1, trim = 0.09, wall = 0.1, rails = 1, bars = 0, color = "cap" } = {}) {
  const g = new THREE.Group();
  const h = y1 - y0, f = 0.045, fd = 0.06, z = -wall / 2;
  for (const s of [-1, 1]) box(g, color, f, h, fd, s * (w / 2 - f / 2), y0, z);
  for (const y of [y0, y1 - f]) box(g, color, w - 2 * f, f, fd, 0, y, z);
  const gw = w - 2 * f, gh = h - 2 * f;
  box(g, "glass", gw, gh, 0.006, 0, y0 + f, z).castShadow = false;
  for (let i = 1; i <= rails; i++) box(g, color, gw, 0.035, 0.045, 0, y0 + f + gh * i / (rails + 1) - 0.0175, z);
  for (let i = 1; i <= bars; i++) box(g, color, 0.025, gh, 0.035, -gw / 2 + gw * i / (bars + 1), y0 + f, z);
  const ct = 0.018, sill = 0.028;
  for (const s of [-1, 1]) box(g, color, trim, h, ct, s * (w / 2 + trim / 2), y0, ct / 2);
  box(g, color, w + 2 * trim + 0.02, trim, ct + 0.006, 0, y1, (ct + 0.006) / 2);
  box(g, color, w + 2 * trim + 0.05, sill, 0.085, 0, y0 - sill, 0.0025);
  box(g, color, w + 2 * trim, 0.075, ct, 0, y0 - sill - 0.075, ct / 2);
  g.userData.trimTop = y1 + trim;
  g.userData.trimW = w + 2 * trim;
  return g;
}

// Curtains on a rod. The rod runs `past` beyond each side of the window (w: the window outside its
// casing; past defaults to a sixth of w, at least 4 in), with a bracket near each end and a finial on
// each. `panels` grommet panels (2: one pushed open to each end; 1: one, at the left) hang from it.
// rod: floor to the top of the rod. length: the panel's length on the tag. rise: fabric above the top
// of the rod (grommets: about 1 in). stack: the width one open panel takes on the rod. out: rod
// centre from the wall. folds: folds per panel.
// The hem lands at rod + rise - length (userData.hem, m; below 0 = that much fabric on the floor).
// Above the floor it floats; at 0 it kisses; up to about 2 in on the floor it breaks (the last inches
// bend forward onto the floor); past that it puddles: the extra lies forward in one soft run that
// rolls back over itself, a second and third layer as the length grows, so 6, 13 and 25 in look
// different. The folds flatten where the fabric meets the floor and the panel spreads about 10%.
// set({ rod, length }) moves the rod and reshapes the panels in place.
// (The hem's shape is drawn, not simulated: the kit shows the state, the page's solver gives the numbers.)
export function curtains({ w = 1.6, past = null, rod = 2.3, length = 96 * IN, rise = IN, panels = 2, stack = 0.34,
  folds = 5, out = 0.1, color = "linen", metal = "black" } = {}) {
  const g = new THREE.Group(), hw = new THREE.Group();
  g.add(hw);
  past ??= Math.max(4 * IN, w / 6);
  const rodW = w + 2 * past, R = 0.0143, cy = -R;          // rod radius; hw's origin is the top of the rod
  const bar = place(hw, new THREE.CylinderGeometry(R, R, rodW, 10), metal, 0, cy, out);
  bar.rotation.z = Math.PI / 2;
  const brackets = rodW > 2.4 ? [-1, 0, 1] : [-1, 1];
  for (const s of brackets) {
    const bx = s * (rodW / 2 - 0.05);
    box(hw, metal, 0.03, 0.075, 0.008, bx, cy - R - 0.055, 0.004);                 // wall plate
    box(hw, metal, 0.016, 0.016, out + 0.01, bx, cy - R - 0.016, (out + 0.01) / 2);  // arm under the rod
    box(hw, metal, 0.016, 0.034, 0.006, bx, cy - R - 0.016, out + R + 0.003);        // lip in front of it
    if (!s) continue;
    const neck = place(hw, new THREE.CylinderGeometry(R * 0.75, R * 0.75, 0.03, 8), metal, s * (rodW / 2 + 0.015), cy, out);
    neck.rotation.z = Math.PI / 2;
    place(hw, new THREE.IcosahedronGeometry(0.03, 1), metal, s * (rodW / 2 + 0.055), cy, out);
  }

  // the fabric: its own copy of the palette's linen, casting its shadow from the back face only, so
  // the thin double-sided cloth doesn't shadow itself into speckles
  const mat = paint(color, 1, { double: true }).clone();
  mat.shadowSide = THREE.BackSide;
  const P = CURTAIN, C = 2 * folds * P.per + 1;
  const list = [];
  for (let i = 0; i < panels; i++) {
    const side = i === 0 ? -1 : 1, edge = side * (rodW / 2 - 0.012);
    // one column per point across the folds: x across the open stack, o = how far in front of (+) or
    // behind (-) the rod's line, as a fraction of half the fold depth. Each fold has its own depth (jit)
    // and its own slow wobble down the drop (ph); n: smooth noise across the panel, so the fabric on
    // the floor lies a little further out here and there
    const cols = [];
    for (let j = 0; j < C; j++) {
      const t = j / P.per, peak = Math.round(t), jit = P.jitter[(peak + 3 * i) % P.jitter.length];
      const o = -Math.cos(Math.PI * t) * jit;
      cols.push({ x: edge - side * stack * (j / (C - 1)), o, ph: peak * 1.9 + i * 0.7,
        n: 0.6 * Math.sin(j * 0.37 + i * 2.1) + 0.4 * Math.sin(j * 0.93 + 1.3 + i) });
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(C * P.rows * 3), 3));
    const idx = [];
    for (let r = 0; r < P.rows - 1; r++) for (let j = 0; j < C - 1; j++) {
      const a = r * C + j, b = a + 1, c = a + C, d = c + 1;
      // front faces toward the room on both panels (their columns run opposite ways): the AO pass
      // draws front faces only, and a panel facing the wall would let the wall's shading through
      if (side < 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
    geo.setIndex(idx);
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = m.receiveShadow = true;
    g.add(m);
    // grommets: a ring wherever the fabric crosses the rod
    for (let k = 0; k < 2 * folds; k++) {
      const j0 = k * P.per + P.per / 2, a = cols[j0 - 1], b = cols[j0 + 1];
      const ring = place(hw, grommetGeo(), metal, (a.x + b.x) / 2, cy, out);
      ring.rotation.y = Math.atan2(-(b.o - a.o) * P.depth / 2, b.x - a.x);
    }
    list.push({ geo, cols, mid: edge - side * stack / 2 });
  }

  const state = { rod, length };
  g.set = ({ rod: r1 = state.rod, length: l1 = state.length } = {}) => {
    Object.assign(state, { rod: r1, length: l1 });
    hw.position.y = r1;
    const top = r1 + rise;
    for (const p of list) drape(p, top, l1, out);
    g.userData.hem = top - l1;
    return g;
  };
  g.userData.rod = { w: rodW, past, out };
  return g.set();
}

// fold depth front to back (m), points per half fold, rows down a panel, and each fold's depth
const CURTAIN = { depth: 0.085, per: 4, rows: 76, jitter: [1, 0.78, 1.12, 0.9, 1.05, 0.74, 1.15, 0.86] };
let ringGeo;
const grommetGeo = () => (ringGeo ??= new THREE.TorusGeometry(0.021, 0.0045, 4, 8));

// The line one column of a panel follows from its top, in (y, z): z away from the wall, from the rod's
// line. Straight down while the panel is no longer than its drop. Longer (e: the fabric past the floor),
// the last inches bend forward onto the floor (a break); what's left lies forward along the floor up to
// a reach that grows with e, then rolls up and back over itself (a puddle), and again for a third layer
// (too long). Every piece is continuous in e, so a length change animates.
// Returns { at(s), total, tail }: s = distance down the fabric from its top edge; at(s) = { y, z,
// floor (0 hanging .. 1 lying) }; tail = the fabric in the bend and on the floor.
function curtainPath(top, len) {
  const e = len - top, pieces = [];
  const seg = (l, f) => pieces.push({ l, at: f });
  if (e <= 0) { seg(len, u => ({ y: top - u * len, z: 0, floor: 0 })); return walk(pieces); }
  const Rb = Math.min(0.008 + 0.45 * e, 0.04);
  // a bend that doesn't reach the horizontal: drop to Rb·sin(th), arc th, the hem on the floor
  let th = Math.PI / 2;
  if (Rb * (th - Math.sin(th)) > e) { let lo = 0, hi = th; for (let i = 0; i < 26; i++) { const m = (lo + hi) / 2; if (Rb * (m - Math.sin(m)) > e) hi = m; else lo = m; } th = (lo + hi) / 2; }
  const yb = Rb * Math.sin(th), q = th / (Math.PI / 2);
  seg(top - yb, u => ({ y: top - u * (top - yb), z: 0, floor: 0 }));
  seg(Rb * th, u => { const p = u * th; return { y: yb - Rb * Math.sin(p), z: Rb - Rb * Math.cos(p), floor: q * u * u }; });
  let rest = e - Rb * (th - Math.sin(th));
  if (th < Math.PI / 2 - 1e-6 || rest <= 1e-6) return walk(pieces);
  // on the floor: layers forward, back, forward; each one shorter, joined by a soft roll, and each upper
  // layer sagging back down over the one under it, so the pile reads as a heap, not a stack of sheets
  const reach = Math.min(0.04 + 0.3 * e, 0.2), Rr = 0.02;
  let z = Rb, y = 0, dir = 1, rise = 0;
  for (let layer = 0; layer < 3 && rest > 1e-6; layer++) {
    const L = Math.min(rest, reach * [1, 0.72, 0.5][layer]), z0 = z, y0 = y, y1 = layer ? rise + 0.4 * Rr * layer : 0, d0 = dir, full = reach * [1, 0.72, 0.5][layer], k = layer;
    seg(L, u => { const w = u * L / full; return { y: y0 + (y1 - y0) * (w * w * (3 - 2 * w)), z: z0 + d0 * u * L, floor: 1, lay: k }; });
    z += dir * L; rest -= L; y = y0 + (y1 - y0) * Math.min(1, L / full) ** 2 * (3 - 2 * Math.min(1, L / full));
    if (rest <= 1e-6) break;
    // the roll: half a turn up and back over the layer, as much of it as the fabric left allows
    const a = Math.min(rest / Rr, Math.PI), z1 = z, yr = y, d1 = dir;
    seg(Rr * a, u => { const p = u * a; return { y: yr + Rr - Rr * Math.cos(p), z: z1 + d1 * Rr * Math.sin(p), floor: 1, lay: k + u }; });
    rest -= Rr * a; rise = y; y += 2 * Rr; dir = -dir;
  }
  return walk(pieces);
}
function walk(pieces) {
  const total = pieces.reduce((n, p) => n + p.l, 0), last = pieces[pieces.length - 1];
  const tail = total - pieces[0].l;                                    // bend and floor
  const at = s => {
    for (const p of pieces) { if (s <= p.l || p === last) return p.at(p.l > 0 ? Math.min(Math.max(s / p.l, 0), 1) : 0); s -= p.l; }
  };
  return { at, total, tail };
}

// Shape one panel: rows down the fabric, a few on the straight drop and the rest packed round the hem
// (bend, floor), so the same mesh holds any length.
// A fold stands out along z, square to the wall, all the way down: on the floor it only nudges the
// fabric forward or back, so the folds open into a soft, wavy edge instead of standing up as tubes.
// Hanging, the folds wobble a little down the drop and deepen slightly toward the hem; where the
// fabric lies they ease to a quarter of their depth and the panel spreads about 10%.
function drape(p, top, len, out) {
  const { rows } = CURTAIN, C = p.cols.length, pos = p.geo.attributes.position, arr = pos.array, A = CURTAIN.depth / 2;
  const path = curtainPath(top, len), L = path.total, tail = path.tail;
  const head = Math.min(0.07, L * 0.2), nb = rows - 6;
  const sb = Math.max(head + 0.05, L - 0.18 - tail);                           // start of the hem rows
  const S = [0, head];
  for (let i = 1; i <= 4; i++) S.push(head + (sb - head) * i / 5);
  for (let i = 0; i < nb; i++) S.push(sb + (L - sb) * i / (nb - 1));
  for (let r = 0; r < rows; r++) {
    const s = S[r];
    const q = path.at(s), f = q.floor;
    for (let j = 0; j < C; j++) {
      const c = p.cols[j];
      const down = Math.min(Math.max(1 - q.y / top, 0), 1);                    // 0 at the top, 1 at the floor
      const lay = q.lay ?? 0;                                                  // which layer on the floor
      const hang = (1 + 0.18 * down) * (1 + 0.2 * Math.sin(q.y * 1.7 + c.ph));  // deeper toward the hem, uneven
      const a = A * hang * (1 - f * (0.75 - 0.06 * Math.min(lay, 2)));
      const spread = (1 + 0.05 * down) * (1 + 0.1 * f);
      const sway = 0.012 * Math.sin(q.y * 1.3 + c.ph) * (1 - f);
      const ripple = f > 0 ? f * (0.004 + 0.006 * Math.min(lay, 2)) * (0.5 + 0.5 * Math.sin(c.x * 19 + c.ph + lay)) : 0;
      const k = (r * C + j) * 3;
      arr[k] = p.mid + (c.x - p.mid) * spread + sway;
      arr[k + 1] = Math.max(q.y + ripple, 0.003);
      arr[k + 2] = out + q.z + c.o * a + 0.012 * c.n * f;
    }
  }
  pos.needsUpdate = true;
  p.geo.computeVertexNormals();
  p.geo.computeBoundingSphere();
}

// A fireplace against a wall: a surround (two piers on plinths and a frieze), a firebox opening with a
// dark lining and a few logs, a hearth slab on the floor, and a mantel shelf whose top is at `mantel`
// (54 in). w: the surround's width; depth: how far it stands out from the wall; opening: { w, h }.
// A TV goes above it: userData.mantel is the top of the shelf, userData.depth how far the shelf reaches.
export function fireplace({ w = 1.52, mantel = 54 * IN, depth = 0.22, opening = { w: 0.91, h: 0.76 },
  surround = "marble", shelf = "oak", firebox = "charcoal", hearth = "concrete", logs = true } = {}) {
  const g = new THREE.Group();
  const st = 0.07, sd = depth + 0.08, H = mantel - st, ow = Math.min(opening.w, w - 0.2), oh = Math.min(opening.h, H - 0.18);
  const pw = (w - ow) / 2, hz = 0.035;
  box(g, hearth, w + 0.16, hz, depth + 0.4, 0, 0, (depth + 0.4) / 2, 0.006);
  for (const s of [-1, 1]) {
    const x = s * (w / 2 - pw / 2);
    box(g, surround, pw + 0.02, 0.14, depth + 0.015, x, hz, (depth + 0.015) / 2, 0.006);   // plinth
    box(g, surround, pw, H - hz, depth, x, hz, depth / 2, 0.006);                          // pier
  }
  box(g, surround, ow + 0.002, H - oh - hz, depth, 0, hz + oh, depth / 2, 0.006);         // frieze
  box(g, surround, w + 0.05, 0.035, depth + 0.03, 0, H - 0.035, (depth + 0.03) / 2, 0.006); // moulding under the shelf
  box(g, shelf, w + 0.16, st, sd, 0, H, sd / 2, 0.008);
  // the firebox: a dark lining, its sides splayed towards the back, and a black frame round the opening
  const back = ow - 0.26, bz = 0.03;
  box(g, firebox, back, oh, 0.02, 0, hz, bz);
  for (const s of [-1, 1]) {
    const x0 = s * ow / 2, x1 = s * back / 2, len = Math.hypot(x0 - x1, depth - bz), side = box(g, firebox, 0.02, oh, len, 0, hz, 0);
    side.position.set((x0 + x1) / 2, hz + oh / 2, (depth + bz) / 2);
    side.rotation.y = Math.atan2(x0 - x1, depth - bz);
  }
  box(g, firebox, ow, 0.02, depth - bz, 0, hz + oh - 0.02, (depth + bz) / 2);
  const fr = 0.03;
  for (const s of [-1, 1]) box(g, "black", fr, oh, 0.01, s * (ow / 2 - fr / 2), hz, depth + 0.004);
  box(g, "black", ow, fr, 0.01, 0, hz + oh - fr, depth + 0.004);
  if (logs) {
    const lz = depth * 0.55;
    for (const [x, y, ry, r] of [[-0.06, 0, 0.12, 0.055], [0.07, 0, -0.1, 0.05], [0, 0.085, 0.04, 0.045]]) {
      const l = cyl(g, "walnut", r, back * 0.95, 0, 0, 0, { seg: 6 });
      l.rotation.set(0, ry, Math.PI / 2);
      l.position.set(x * 0.4, hz + r + y, lz + x);
    }
  }
  Object.assign(g.userData, { mantel, depth: sd, w: w + 0.16 });
  return g;
}

// ------------------------------------------------------------------ light, plants, rugs
export function floorLamp({ shade = "cream", stand = "black" } = {}) {
  const g = new THREE.Group();
  cyl(g, stand, 0.15, 0.025, 0, 0, 0, { top: 0.14, seg: 16 });
  cyl(g, stand, 0.012, 1.32, 0, 0.025, 0, { seg: 6 });
  cyl(g, shade, 0.2, 0.3, 0, 1.25, 0, { top: 0.15, seg: 12 });
  return g;
}

export function tableLamp({ shade = "cream", base = "black" } = {}) {
  const g = new THREE.Group();
  cyl(g, base, 0.08, 0.2, 0, 0, 0, { top: 0.05, seg: 10 });
  const dome = place(g, new THREE.SphereGeometry(0.16, 12, 4, 0, Math.PI * 2, 0, Math.PI / 2), shade, 0, 0.2, 0, true);
  dome.scale.y = 0.8;
  return g;
}

export function plant({ pot = "pot", size = 1 } = {}) {
  const g = new THREE.Group();
  cyl(g, pot, 0.14 * size, 0.3 * size, 0, 0, 0, { top: 0.17 * size, seg: 10 });
  cyl(g, "walnut", 0.155 * size, 0.01, 0, 0.27 * size, 0, { seg: 10 });   // soil
  const n = 11;
  for (let i = 0; i < n; i++) {
    const leaf = new THREE.Mesh(leafGeometry(), paint(i % 2 ? "leaf" : "leafDark", 1, { double: true }));
    leaf.castShadow = leaf.receiveShadow = true;
    const s = size * (0.85 + (i % 4) * 0.08);
    leaf.scale.set(0.08 * s, 0.08 * s, 0.3 * s);
    leaf.position.z = 0.05 * size;
    const arm = new THREE.Group();
    arm.position.y = 0.28 * size;
    arm.rotation.set(-0.45 - (i % 3) * 0.32, i * 2.4, (i % 2 ? 1 : -1) * 0.2, "YXZ");
    arm.add(leaf);
    g.add(arm);
  }
  return g;
}

// a leaf: a folded diamond running along +z, its tip drooping
let leafGeo;
function leafGeometry() {
  if (leafGeo) return leafGeo;
  const P = [[0, 0, 0], [-0.5, 0.15, 0.45], [0, -0.12, 0.5], [0.5, 0.15, 0.45], [0, -0.35, 1]];
  const F = [[0, 2, 1], [0, 3, 2], [1, 2, 4], [2, 3, 4]];
  const pos = [];
  for (const f of F) for (const i of f) pos.push(...P[i]);
  leafGeo = new THREE.BufferGeometry();
  leafGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  leafGeo.computeVertexNormals();
  return leafGeo;
}

// ------------------------------------------------------------------ people
// a seated person for scale (the eye point on the TV pages), faceted like the furniture: light skin
// and a dark sweater, so it reads as a person and not a shadow. Origin on the floor under the head,
// facing +z; `eye` is the eye height (m). Limbs are tapered prisms between joints.
function limb(g, color, a, b, r0, r1 = r0, seg = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
  const m = place(g, new THREE.CylinderGeometry(r1, r0, len, seg), color, 0, 0, 0);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}
export function person({ eye = 42 * IN, shirt = "clay", trousers = "slate", skin = "linen", hair = "oak" } = {}) {
  const g = new THREE.Group();
  const seat = 0.45, hip = [0, seat + 0.08, 0.13], shoulder = eye - 0.2;
  for (const sx of [-1, 1]) {
    const x = sx * 0.1;
    limb(g, trousers, [x, seat + 0.06, 0.12], [x, seat + 0.07, 0.56], 0.075, 0.06);       // thigh
    limb(g, trousers, [x, seat + 0.05, 0.58], [x, 0.06, 0.62], 0.055, 0.045);             // shin
    box(g, "black", 0.1, 0.07, 0.24, x, 0, 0.68, 0.02);                                     // shoe
    limb(g, shirt, [sx * 0.2, shoulder, 0.02], [sx * 0.22, seat + 0.28, 0.12], 0.05, 0.045); // upper arm
    limb(g, shirt, [sx * 0.22, seat + 0.28, 0.12], [sx * 0.15, seat + 0.14, 0.4], 0.042, 0.036); // forearm
    const hand = place(g, new THREE.IcosahedronGeometry(0.04, 0), skin, sx * 0.14, seat + 0.13, 0.44);
    hand.scale.set(1, 0.7, 1.3);
  }
  limb(g, shirt, hip, [0, shoulder + 0.02, 0.02], 0.17, 0.2, 7).scale.z = 0.62;            // torso, leaning back
  limb(g, skin, [0, shoulder, 0.02], [0, eye - 0.06, 0.01], 0.045, 0.042);                 // neck
  const head = place(g, new THREE.IcosahedronGeometry(0.1, 1), skin, 0, eye + 0.01, 0);
  head.scale.set(0.88, 1.1, 0.98);
  const top = place(g, new THREE.SphereGeometry(0.104, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.52), hair, 0, eye + 0.03, -0.012);
  top.scale.set(0.9, 1.08, 1.02);
  return g;
}

export function rug({ w = 2.0, d = 2.9, color = "stone", border = null } = {}) {
  const g = new THREE.Group();
  box(g, border ?? color, w, 0.012, d, 0, 0, 0, 0.005);
  if (border) box(g, color, w - 0.16, 0.013, d - 0.16, 0, 0, 0, 0.005);
  g.traverse(o => { if (o.isMesh) o.castShadow = false; });
  return g;
}
