// Misplaced — the room shell for 3D pages: slab, floor and walls with door and window openings.
// The front wall is cut down to a stub so the camera can see in. Shell surfaces take shadows
// but cast none: it's a cutaway, not a closed room. (bedroom.js has its own copy of this.)
//
// Metres, room centred on the origin. Walls: back (z = -D/2), front (z = +D/2), left (x = -W/2),
// right (x = +W/2). Positions along a wall (t) run from the left wall (back, front) or from the
// back wall (left, right).
// Wall height: WALL_H (2.5 m) unless buildShell gets { h }; setWallHeight() changes it live (a
// ceiling slider) without a rebuild. { ceiling: true } adds a thin grey ceiling edge on top of the
// full walls, so the reader sees where the ceiling is; the front stub stays cut down.
// { baseboard: { h, t } } runs a baseboard (trim colour) along the room face of the full walls,
// broken where an opening reaches the floor (a door); it takes shadows and casts none.
import * as THREE from "three";
import { paint } from "./real.js";

export const WALL_T = 0.1, WALL_H = 2.5, STUB_H = 0.3;
export const DOOR_H = 2.05, WIN_Y0 = 0.9, WIN_Y1 = 2.1;

export function wallFrames(W, D) {
  return {
    back:  { P0: [-W / 2, -D / 2], a: [1, 0], n: [0, 1],  len: W },
    front: { P0: [-W / 2, D / 2],  a: [1, 0], n: [0, -1], len: W },
    left:  { P0: [-W / 2, -D / 2], a: [0, 1], n: [1, 0],  len: D },
    right: { P0: [W / 2, -D / 2],  a: [0, 1], n: [-1, 0], len: D },
  };
}
export const along = (F, t, out = 0) => [F.P0[0] + F.a[0] * t + F.n[0] * out, F.P0[1] + F.a[1] * t + F.n[1] * out];

// stand obj on wall F at t, facing into the room
export function place(obj, F, t, out = 0) {
  const [x, z] = along(F, t, out);
  obj.position.set(x, 0, z);
  obj.rotation.y = Math.atan2(F.n[0], F.n[1]);
}

function addBox(parent, sx, sy, sz, x, y, z, material) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material);
  m.position.set(x, y, z);
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

// openings: { wall: [{ t0, t1, y0, y1 }] }. Clears and refills `group`; returns the wall frames.
// h: wall height (floor to ceiling). Openings must end below the lowest height setWallHeight() will
// be given (a window at WIN_Y1 = 2.1 m clears a 7 ft 6 in ceiling).
export function buildShell(group, W, D, openings = {}, { h = WALL_H, ceiling = false, baseboard = null } = {}) {
  group.traverse(o => o.geometry?.dispose());
  group.clear();
  const F = wallFrames(W, D);
  addBox(group, W + 2 * WALL_T + 0.1, 0.26, D + 2 * WALL_T + 0.1, 0, -0.15, 0, paint("cap"));
  addBox(group, W, 0.02, D, 0, -0.01, 0, paint("floor"));
  for (const name of ["back", "left", "right", "front"]) {
    const wh = name === "front" ? STUB_H : h;
    wall(group, F[name], wh, openings[name] ?? [], name === "back" || name === "front", name !== "front");
  }
  if (ceiling) ceilingEdge(group, W, D, h);
  if (baseboard) baseboards(group, F, openings, baseboard);
  group.userData.wallH = h;
  return F;
}

// Change the height of the full walls (and the ceiling edge) in place: the strips that reach the top
// stretch, nothing is rebuilt, so a ceiling slider can animate it. The shadow map follows by itself
// (real.js); call fitRig() after a big change so the sun's shadow box still holds the room.
export function setWallHeight(group, h) {
  if (group.userData.wallH === h) return;
  group.userData.wallH = h;
  group.traverse(o => {
    const top = o.userData.wallTop, edge = o.userData.ceilingEdge;
    if (top) {
      o.visible = h - top.y0 > 0.005;
      o.scale.y = Math.max(h - top.y0, 0.001) / (top.h - top.y0);
      o.position.y = (top.y0 + h) / 2;
    }
    if (edge) o.position.y = h + edge.dy;
  });
}

// the ceiling's cut edge: a thin slab on top of the back and side walls that runs a little past
// their inner face, in a darker tone than the walls so it reads against the plate
const CEIL_T = 0.035, CEIL_LIP = 0.035;
function ceilingEdge(group, W, D, h) {
  const m = paint("concrete"), y = h + CEIL_T / 2 - 0.004;
  const add = (sx, sz, x, z) => { addBox(group, sx, CEIL_T, sz, x, y, z, m).userData.ceilingEdge = { dy: y - h }; };
  const T = WALL_T + CEIL_LIP;
  add(W + 2 * WALL_T, T, 0, -D / 2 - WALL_T + T / 2);
  for (const s of [-1, 1]) add(T, D - CEIL_LIP, s * (W / 2 + WALL_T - T / 2), CEIL_LIP / 2);
}

// the back wall's board runs wall to wall; the side walls' boards run their full length, into the corners
function baseboards(group, F, openings, { h, t }) {
  const m = paint("cap");
  for (const name of ["back", "left", "right"]) {
    const f = F[name], doors = (openings[name] ?? []).filter(o => o.y0 < h).sort((a, b) => a.t0 - b.t0);
    let cursor = 0;
    const run = (a, b) => {
      if (b - a < 0.005) return;
      const [x, z] = along(f, (a + b) / 2, t / 2);
      addBox(group, f.a[0] ? b - a : t, h, f.a[0] ? t : b - a, x, h / 2, z, m);
    };
    for (const o of doors) { run(cursor, o.t0); cursor = Math.max(cursor, o.t1); }
    run(cursor, f.len);
  }
}

function wall(group, F, h, openings, extendEnds, full) {
  const s0 = extendEnds ? -WALL_T : 0, s1 = F.len + (extendEnds ? WALL_T : 0);
  const ops = openings.map(o => ({ ...o, y1: Math.min(o.y1, h) })).filter(o => o.y0 < h).sort((a, b) => a.t0 - b.t0);
  const seg = (a, b, y0, y1) => {
    if (b - a < 0.005 || y1 - y0 < 0.005) return;
    const c = (a + b) / 2, len = b - a;
    const x = F.P0[0] + F.a[0] * c - F.n[0] * WALL_T / 2, z = F.P0[1] + F.a[1] * c - F.n[1] * WALL_T / 2;
    const m = addBox(group, F.a[0] ? len : WALL_T, y1 - y0, F.a[0] ? WALL_T : len, x, (y0 + y1) / 2, z, paint("wall"));
    if (full && y1 === h) m.userData.wallTop = { y0, h };
  };
  let cursor = s0;
  for (const o of ops) {
    seg(cursor, o.t0, 0, h);
    seg(o.t0, o.t1, 0, o.y0);
    seg(o.t0, o.t1, o.y1, h);
    cursor = Math.max(cursor, o.t1);
  }
  seg(cursor, s1, 0, h);
}
