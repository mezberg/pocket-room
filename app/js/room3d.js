// The room shell from room.json: floor, slab, walls with their openings (windows framed and glazed,
// doors with a swing arc on the floor). Any closed loop of straight walls, not only rectangles.
// Each wall is built twice, full height and as a cut-down stub; cutaway(camera) shows the stub for
// the walls that face the camera, so the room stays open whichever way it is turned.
import * as THREE from "three";
import { paint } from "./kit/real.js";
import { windowFrame } from "./kit/kit-real.js";

export const WALL_T = 0.1, STUB_H = 0.32;

// What no photo showed (walls[].seen, floor_seen): drawn see-through grey, so a guess never looks like a wall.
const UNSEEN = "#9C978F";
const unseenWall = () => paint(UNSEEN, 0.3);
let hatch = null;
function unseenFloor() {   // diagonal grey stripes, 0.4 m apart (ShapeGeometry UVs are plan metres)
  if (hatch) return hatch;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#C2BDB5"; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "#A39E96"; g.lineWidth = 10;
  for (const d of [-64, 0, 64]) { g.beginPath(); g.moveTo(d, 64); g.lineTo(d + 64, 0); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(2.5, 2.5);
  tex.colorSpace = THREE.SRGBColorSpace;
  return (hatch = new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }));
}

// [t0, t1] cut by the seen spans: [{ t0, t1, seen }]. No spans given = all seen.
export function splitSeen(t0, t1, seen) {
  if (!seen) return [{ t0, t1, seen: true }];
  const out = [];
  let t = t0;
  for (const [a, b] of seen) {
    const s0 = Math.max(a, t0), s1 = Math.min(b, t1);
    if (s1 <= s0) continue;
    if (s0 > t) out.push({ t0: t, t1: s0, seen: false });
    out.push({ t0: s0, t1: s1, seen: true });
    t = s1;
  }
  if (t < t1) out.push({ t0: t, t1, seen: false });
  return out;
}

// signed area of the wall loop in plan: > 0 counter-clockwise (the room is on the left of a → b)
const loopArea = (walls) => walls.reduce((s, w) => s + (w.a[0] * w.b[1] - w.b[0] * w.a[1]), 0) / 2;

export function buildRoom(room) {
  const group = new THREE.Group();
  group.name = "room";
  const H = room.height ?? 2.4;
  const ccw = loopArea(room.walls) > 0;

  // floor + slab from the wall loop
  const shape = new THREE.Shape(room.walls.map((w) => new THREE.Vector2(w.a[0], w.a[1])));
  const seenFloor = room.floor_seen?.length >= 3;
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), seenFloor ? unseenFloor() : paint("floor"));
  floor.rotation.x = -Math.PI / 2;     // shape in (x, y) plan → (x, -z)
  floor.receiveShadow = true;
  floor.userData.floor3d = true;
  group.add(floor);
  if (seenFloor) {   // the part the photos showed, real floor on top of the grey
    const part = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(room.floor_seen.map(([x, y]) => new THREE.Vector2(x, y)))), paint("floor"));
    part.rotation.x = -Math.PI / 2;
    part.position.y = 0.002;
    part.receiveShadow = true;
    part.userData.floor3d = true;
    group.add(part);
    // a dashed edge round what was seen
    const pts = [...room.floor_seen, room.floor_seen[0]].map(([x, y]) => new THREE.Vector3(x, 0.006, -y));
    const edge = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: "#6E6A62", dashSize: 0.12, gapSize: 0.08 }));
    edge.computeLineDistances();
    edge.userData.noEdge = true;
    group.add(edge);
  }
  // the slab: the wall loop grown by the wall thickness, 25 cm deep, in the cut colour
  const grown = growLoop(room.walls, ccw, WALL_T + 0.04);
  const slab = new THREE.Mesh(new THREE.ExtrudeGeometry(new THREE.Shape(grown), { depth: 0.25, bevelEnabled: false }), paint("cap"));
  slab.rotation.x = -Math.PI / 2;
  slab.position.y = -0.251;
  slab.receiveShadow = true;
  group.add(slab);

  const walls = [];
  for (const w of room.walls) {
    const a = new THREE.Vector2(...w.a), b = new THREE.Vector2(...w.b);
    const len = a.distanceTo(b), dir = b.clone().sub(a).normalize();
    const inward = ccw ? new THREE.Vector2(-dir.y, dir.x) : new THREE.Vector2(dir.y, -dir.x);
    const ops = (w.openings ?? []).map((o) => ({ ...o, t0: o.from, t1: o.from + o.width, y0: o.sill ?? 0, y1: Math.min(o.head ?? 2.04, H) }));
    const full = wallMesh(a, dir, inward, len, H, ops, w.seen);
    const stub = wallMesh(a, dir, inward, len, STUB_H, ops, w.seen);
    stub.visible = false;
    group.add(full, stub);
    // what hangs in the openings
    const fittings = new THREE.Group();
    for (const o of ops) {
      const mid = a.clone().addScaledVector(dir, (o.t0 + o.t1) / 2);
      if (o.kind === "window" || o.kind === "glazed_door") {
        const win = windowFrame({ w: o.t1 - o.t0, y0: o.y0, y1: o.y1, wall: WALL_T, rails: 0, bars: o.kind === "glazed_door" ? 0 : 1 });
        win.position.set(mid.x, 0, -mid.y);
        win.rotation.y = Math.atan2(inward.x, -inward.y);
        win.traverse((m) => { if (m.isMesh) { m.castShadow = false; m.receiveShadow = true; } });
        win.userData.tall = o.y1 > STUB_H;
        fittings.add(win);
      } else if (o.kind === "door" && o.swing) {
        fittings.add(swingArc(a, dir, inward, o));
      }
    }
    group.add(fittings);
    // the longest stretch nobody saw gets a "not seen" tag (viewer.js labels it)
    const gaps = splitSeen(0, len, w.seen).filter((p) => !p.seen && p.t1 - p.t0 > 0.6).sort((p, q) => (q.t1 - q.t0) - (p.t1 - p.t0));
    const unseen = gaps[0] ? a.clone().addScaledVector(dir, (gaps[0].t0 + gaps[0].t1) / 2) : null;
    walls.push({ id: w.id, full, stub, fittings, mid: a.clone().addScaledVector(dir, len / 2), inward, len, a, dir, unseen });
  }
  group.userData.walls = walls;
  group.userData.height = H;
  return group;
}

// one wall: boxes round the openings, on the outside of the wall line (the line is the room face)
function wallMesh(a, dir, inward, len, h, ops, seen) {
  const g = new THREE.Group();
  const out = inward.clone().negate();
  const box = (t0, t1, y0, y1, known) => {
    if (t1 - t0 < 0.005 || y1 - y0 < 0.005) return;
    const m = new THREE.Mesh(new THREE.BoxGeometry(t1 - t0, y1 - y0, WALL_T), known ? paint("wall") : unseenWall());
    const c = a.clone().addScaledVector(dir, (t0 + t1) / 2).addScaledVector(out, WALL_T / 2);
    m.position.set(c.x, (y0 + y1) / 2, -c.y);
    m.rotation.y = Math.atan2(dir.y, dir.x);    // box x along the wall (plan y flips to −z)
    m.receiveShadow = known;
    m.castShadow = known;
    if (!known) m.userData.noEdge = true;
    g.add(m);
  };
  // the corner run-on past the wall's end goes with the last stretch
  const seg = (t0, t1, y0, y1) => {
    y1 = Math.min(y1, h);
    for (const p of splitSeen(t0, Math.min(t1, len), seen)) box(p.t0, p.t1 >= len - 1e-6 && t1 > len ? t1 : p.t1, y0, y1, p.seen);
  };
  // the wall runs on past b by its thickness to close the corner (each corner once, round the loop)
  let cursor = 0;
  for (const o of [...ops].sort((p, q) => p.t0 - q.t0)) {
    seg(cursor, o.t0, 0, h);
    seg(o.t0, o.t1, 0, o.y0);
    seg(o.t0, o.t1, o.y1, h);
    cursor = Math.max(cursor, o.t1);
  }
  seg(cursor, len + WALL_T, 0, h);
  return g;
}

// a thin quarter circle on the floor where the door leaf sweeps
function swingArc(a, dir, inward, o) {
  const w = o.t1 - o.t0, hingeAtB = o.swing.hinge === "b";
  const hinge = a.clone().addScaledVector(dir, hingeAtB ? o.t1 : o.t0);
  const side = o.swing.into === false ? inward.clone().negate() : inward;
  const along = dir.clone().multiplyScalar(hingeAtB ? -1 : 1);
  const pts = [];
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * Math.PI / 2;
    const p = hinge.clone().addScaledVector(along, Math.cos(t) * w).addScaledVector(side, Math.sin(t) * w);
    pts.push(new THREE.Vector3(p.x, 0.004, -p.y));
  }
  const leafEnd = hinge.clone().addScaledVector(side, w);
  const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: "#9C968C", dashSize: 0.05, gapSize: 0.04, transparent: true, opacity: 0.8 }));
  arc.computeLineDistances();
  const leaf = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(hinge.x, 0.004, -hinge.y), new THREE.Vector3(leafEnd.x, 0.004, -leafEnd.y)]),
    new THREE.LineBasicMaterial({ color: "#9C968C", transparent: true, opacity: 0.8 }));
  const g = new THREE.Group();
  g.add(arc, leaf);
  g.traverse((m) => { m.userData.noEdge = true; });
  return g;
}

// the wall loop moved outward by d (corner points where the moved lines meet)
function growLoop(walls, ccw, d) {
  const lines = walls.map((w) => {
    const a = new THREE.Vector2(...w.a), b = new THREE.Vector2(...w.b), dir = b.clone().sub(a).normalize();
    const out = ccw ? new THREE.Vector2(dir.y, -dir.x) : new THREE.Vector2(-dir.y, dir.x);
    return { p: a.clone().addScaledVector(out, d), dir };
  });
  return lines.map((l, i) => {
    const prev = lines[(i + lines.length - 1) % lines.length];
    const den = prev.dir.x * l.dir.y - prev.dir.y * l.dir.x;
    if (Math.abs(den) < 1e-6) return l.p.clone();
    const t = ((l.p.x - prev.p.x) * l.dir.y - (l.p.y - prev.p.y) * l.dir.x) / den;
    return prev.p.clone().addScaledVector(prev.dir, t);
  });
}

// cut down the walls whose room face looks away from the camera (the camera sees their back)
const v = new THREE.Vector2();
export function cutaway(roomGroup, camera) {
  let changed = false;
  for (const w of roomGroup.userData.walls) {
    v.set(camera.position.x - w.mid.x, -camera.position.z - w.mid.y);
    const facing = v.dot(w.inward) < -0.05;   // camera is behind this wall
    if (w.stub.visible !== facing) {
      w.stub.visible = facing;
      w.full.visible = !facing;
      w.fittings.children.forEach((f) => { if (f.userData.tall) f.visible = !facing; });
      changed = true;
    }
  }
  return changed;
}

// the plan's bounding box and a few numbers for the room sheet
export function roomStats(room) {
  const xs = room.walls.map((w) => w.a[0]), ys = room.walls.map((w) => w.a[1]);
  const W = Math.max(...xs) - Math.min(...xs), D = Math.max(...ys) - Math.min(...ys);
  return { W, D, area: Math.abs(loopArea(room.walls)), cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2 };
}
