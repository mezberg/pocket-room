// The 3D view: the room, its furniture, a new piece, the findings as markers, labels on top.
// The Misplaced look (kit/real.js: sun, soft shadows, AO), drawn on demand: nothing runs while
// the scene is still. Plan (x, y) → three.js (x, h, -y).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Real, rig, fitRig, onDemand, orbiting } from "./kit/real.js";
import { placeLabels } from "./kit/labels.js";
import { buildRoom, cutaway, roomStats } from "./room3d.js";
import { buildItem, buildPiece, standAt, toWorld } from "./furniture.js";

const RED = "#C8444D", GREEN = "#4F9A5E", AMBER = "#D08B2E";
export const VERDICT_COLOR = { "Fits": GREEN, "Just fits": AMBER, "Doesn't fit": RED };

export class Viewer {
  constructor(view, labelsEl) {
    this.view = view;
    this.labelsEl = labelsEl;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    view.prepend(this.renderer.domElement);
    this.real = new Real(this.renderer, { perspective: true });
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: 0.12, minDistance: 2, maxDistance: 24, maxPolarAngle: 1.35, zoomToCursor: false });
    this.controls.addEventListener("change", () => this.request());
    this.controls.addEventListener("start", () => { this.homed = false; });
    this.labels = {};
    this.anims = [];
    this.markers = new THREE.Group();
    this.scene.add(this.markers);
    this.stage = onDemand(this.renderer, view, (dt, t) => this.frame(dt, t));
    new ResizeObserver(() => this.resize()).observe(view);
    this.resize();
  }

  request() { this.stage.request(); }

  // px at the bottom of the view hidden under the sheet and tabs
  setInset(px) {
    if (this.inset === px) return;
    this.inset = px;
    this.resize();
    if (this.homed && this.room) this.home(true);   // keep the whole room in view unless the reader has moved it
  }

  resize() {
    const w = this.view.clientWidth, h = this.view.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // the sheet covers the bottom of the view: move the picture's centre up into what is left
    const dy = Math.round((this.inset ?? 0) / 2);
    if (dy) this.camera.setViewOffset(w, h, 0, dy, w, h); else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    const changed = this.w !== w || this.h !== h;
    this.w = w; this.h = h;
    if (changed && this.homed && this.room) this.home();   // keep the whole room in view unless the reader moved it
    // setSize cleared the canvas: draw now (a resize lands after this frame's rAF), or it flashes blank
    if (changed && this.room && this.real.ready) this.frame(0, performance.now() / 1000);
    this.request();
  }

  frame(dt, t) {
    let moving = this.controls.update() || orbiting(this.controls);
    this.anims = this.anims.filter((a) => a(dt, t) !== false);
    if (this.anims.length) moving = true;
    if (this.room) cutaway(this.room, this.camera);
    this.real.render(this.scene, this.camera);
    placeLabels(this.labels, this.camera, this.w, this.h);
    return moving;
  }

  // ---------------------------------------------------------------- room
  async setRoom(room) {
    this.roomData = room;
    if (this.room) this.scene.remove(this.room);
    if (this.items) this.scene.remove(this.items);
    this.room = buildRoom(room);
    this.items = new THREE.Group();
    this.items.name = "furniture";
    const onFloor = [...(room.furniture ?? []), ...(room.fixtures ?? [])].filter((i) => i.on_floor !== false);
    for (const item of [...(room.fixtures ?? []), ...(room.furniture ?? [])]) {
      const obj = buildItem(item, this.elevation(item, onFloor));
      this.items.add(obj);
      this.label(`item:${item.id}`, item.name, obj.position.clone().setY(obj.position.y + item.size[2] + 0.12), "ghost");
    }
    this.scene.add(this.room, this.items);
    if (!this.rig) { this.rig = rig(this.room, { floor: false }); this.scene.add(this.rig); }
    else fitRig(this.rig, this.room);
    this.home();
    await this.real.compile(this.scene, this.camera);
    this.request();
  }

  // an item that is not on the floor stands on what is under it, or hangs on the wall at a radiator height
  elevation(item, onFloor) {
    if (item.on_floor !== false) return 0;
    if (item.category === "radiator") return 0.15;
    const [x, y] = item.at;
    let top = 0;
    for (const o of onFloor) {
      const r = (o.rot ?? 0) * Math.PI / 180, c = Math.abs(Math.cos(r)), s = Math.abs(Math.sin(r));
      const hw = (o.size[0] * c + o.size[1] * s) / 2, hd = (o.size[0] * s + o.size[1] * c) / 2;
      if (Math.abs(x - o.at[0]) <= hw && Math.abs(y - o.at[1]) <= hd) top = Math.max(top, o.size[2]);
    }
    return top;
  }

  // the camera to the whole room: from the south-east, high, the long side running up the screen
  home(animate = false) {
    const s = roomStats(this.roomData);
    const target = toWorld([s.cx, s.cy], 0.3);
    const portrait = this.h - (this.inset ?? 0) * 0.6 > this.w;
    const dir = portrait ? new THREE.Vector3(0.22, 1.0, 0.52) : new THREE.Vector3(0.55, 0.95, 0.85);
    const box = new THREE.Box3().setFromObject(this.room);
    box.min.y = 0; box.max.y = this.room.userData.height;
    this.fit(box, target, dir, animate ? 0.8 : 0);
    this.homed = true;
  }

  // look at a plan point and about r metres round it, from the side the camera is on now
  focus(at, r = 1.8) {
    const target = toWorld(at, 0.3);
    const dir = this.camera.position.clone().sub(this.controls.target).setY(0).normalize().setY(1.6);
    const box = new THREE.Box3(toWorld(at, 0).addScalar(-r).setY(0), toWorld(at, 0).addScalar(r).setY(1.2));
    this.fit(box, target, dir, 0.8);
    this.homed = false;
  }

  // fly to the nearest distance along dir at which box fits in the part of the view the sheet
  // leaves free, with a margin
  fit(box, target, dir, secs) {
    dir = dir.clone().normalize();
    const corners = [];
    for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    const yMin = -1 + 2 * (this.inset ?? 0) / this.h + 0.06, cam = this.camera.clone(), p = new THREE.Vector3();
    const fits = (d) => {
      cam.position.copy(target).addScaledVector(dir, d);
      cam.lookAt(target);
      cam.updateMatrixWorld();
      return corners.every((c) => { p.copy(c).project(cam); return p.z < 1 && Math.abs(p.x) < 0.92 && p.y < 0.8 && p.y > yMin; });
    };
    let lo = 0.5, hi = 60;
    for (let i = 0; i < 30; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    this.flyTo(target.clone().addScaledVector(dir, hi), target, secs);
  }

  flyTo(pos, target, secs) {
    if (!secs) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.request();
      return;
    }
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    let k = 0;
    this.anims.push((dt) => {
      k = Math.min(1, k + dt / secs);
      const e = 1 - (1 - k) ** 3;
      this.camera.position.lerpVectors(p0, pos, e);
      this.controls.target.lerpVectors(t0, target, e);
      return k < 1;
    });
    this.request();
  }

  // room items hidden while a spot replaces them (the old sofa when the new one takes its place)
  setHidden(ids = []) {
    const gone = new Set(ids);
    for (const obj of this.items?.children ?? []) {
      const id = obj.userData.item?.id;
      obj.visible = !gone.has(id);
      const lb = this.labels[`item:${id}`];
      if (lb) lb.hiddenBySpot = gone.has(id), lb.on = !lb.hiddenBySpot && this.namesOn !== false;
    }
    this.request();
  }

  // ---------------------------------------------------------------- the new piece
  async showPiece(piece) {
    this.clearPiece();
    this.pieceObj = await buildPiece(piece);
    this.pieceObj.visible = false;
    this.scene.add(this.pieceObj);
    await this.real.compile(this.scene, this.camera);
    return this.pieceObj;
  }

  // the real model is ready: swap it in where the stand-in stands, no drop
  async swapModel(piece) {
    const old = this.pieceObj;
    if (!old) return;
    const obj = await buildPiece(piece);
    obj.position.copy(old.position);
    obj.rotation.copy(old.rotation);
    obj.visible = old.visible;
    this.scene.remove(old);
    this.scene.add(obj);
    this.pieceObj = obj;
    await this.real.compile(this.scene, this.camera);
    if (this.labels.piece) this.label("piece", pieceLabel(piece), this.labels.piece.pos.clone(), "solid");
    this.request();
  }

  // drop the piece into a spot: it falls from above and settles, its footprint drawn in the verdict colour
  drop(placement) {
    const obj = this.pieceObj, piece = obj?.userData.piece;
    if (!obj) return;
    const spot = placement.best;
    const s = roomStats(this.roomData);
    const at = spot?.at ?? [s.cx, s.cy], rot = spot?.rot ?? 0;
    standAt(obj, at, rot, 0);
    const y1 = 0, y0 = 1.6;
    obj.position.y = y0;
    obj.visible = true;
    const color = VERDICT_COLOR[placement.verdict] ?? AMBER;
    this.footprint = footprint(piece.size, color);
    standAt(this.footprint, at, rot, 0.006);
    this.footprint.scale.setScalar(0.001);
    this.scene.add(this.footprint);
    if (!spot) this.ghost(obj, color);
    let k = 0;
    this.anims.push((dt) => {
      k = Math.min(1, k + dt / 0.75);
      obj.position.y = y1 + (y0 - y1) * (1 - bounce(k));
      this.footprint.scale.setScalar(Math.min(1, k * 1.6));
      return k < 1;
    });
    const [, , h] = piece.size;
    this.label("piece", pieceLabel(piece), toWorld(at, h + 0.25), "solid");
    this.focus(at, Math.max(piece.size[0], piece.size[1]) / 2 + 1.2);
  }

  // a piece with nowhere to go: see-through, tinted
  ghost(obj, color) {
    obj.traverse((m) => {
      if (!m.isMesh) return;
      m.material = m.material.clone();
      m.material.transparent = true;
      m.material.opacity = 0.55;
      m.material.color.lerp(new THREE.Color(color), 0.5);
      m.castShadow = false;
    });
  }

  clearPiece() {
    if (this.pieceObj) this.scene.remove(this.pieceObj);
    if (this.footprint) this.scene.remove(this.footprint);
    this.pieceObj = this.footprint = null;
    this.unlabel("piece");
    this.request();
  }

  // ---------------------------------------------------------------- findings
  // a pin per finding: red where something is wrong, green where it passes or where the fix goes.
  // onTap(finding) when its bubble is tapped.
  showFindings(findings, onTap) {
    this.clearFindings();
    findings.forEach((f, i) => {
      if (!f.at) return;
      const bad = !f.pass;
      this.markers.add(pin(f.at, bad ? RED : GREEN));
      const el = this.label(`finding:${f.id}:${i}`, String(i + 1), toWorld(f.at, 1.05), bad ? "marker bad" : "marker good");
      el.onclick = () => onTap?.(f, i);
      if (f.fix?.at) {
        this.markers.add(pin(f.fix.at, GREEN, 0.5));
        this.markers.add(arrow(f.at, f.fix.at));
        const fe = this.label(`fix:${f.id}:${i}`, "fix", toWorld(f.fix.at, 0.5), "marker good small");
        fe.onclick = () => onTap?.(f, i);
      }
    });
    this.request();
  }

  clearFindings() {
    this.markers.clear();
    for (const k of Object.keys(this.labels)) if (k.startsWith("finding:") || k.startsWith("fix:")) this.unlabel(k);
    this.request();
  }

  // ---------------------------------------------------------------- labels
  label(key, text, pos, cls = "") {
    let lb = this.labels[key];
    if (!lb) {
      const el = document.createElement(cls.includes("marker") ? "button" : "div");
      el.className = `tag ${cls}`;
      this.labelsEl.append(el);
      lb = this.labels[key] = { el, pos: new THREE.Vector3(), on: true };
    }
    lb.el.textContent = text;
    lb.pos.copy(pos);
    this.request();
    return lb.el;
  }

  unlabel(key) {
    this.labels[key]?.el.remove();
    delete this.labels[key];
  }

  showNames(on) {
    this.namesOn = on;
    for (const [k, lb] of Object.entries(this.labels)) if (k.startsWith("item:")) lb.on = on && !lb.hiddenBySpot;
    this.request();
  }

  // ---------------------------------------------------------------- a still for lane F
  // Only the 3D view the reader sees (nothing under a panel), without the pins and the footprint
  // (they'd come back as objects in the photo), at most 1536 px on the long side.
  snapshot(max = 1536) {
    const hide = [this.markers, this.footprint].filter(Boolean);
    hide.forEach((o) => (o.visible = false));
    this.real.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const k = src.width / this.w;                      // device px per CSS px
    const sh = Math.round((this.h - (this.inset ?? 0)) * k);
    const scale = Math.min(1, max / Math.max(src.width, sh));
    const c = document.createElement("canvas");
    c.width = Math.round(src.width * scale);
    c.height = Math.round(sh * scale);
    c.getContext("2d").drawImage(src, 0, 0, src.width, sh, 0, 0, c.width, c.height);
    hide.forEach((o) => (o.visible = true));
    this.request();
    return c.toDataURL("image/jpeg", 0.88);
  }
}

const fmt = (m) => m.toFixed(2);
// shop names run long ("Hutch Fabric Round Arm 3 Seater Sofa - Oat"): the label keeps the part before " - ", ≤ 26 chars
const short = (n = "") => { const s = n.split(" - ")[0]; return s.length > 26 ? `${s.slice(0, 25).trim()}…` : s; };
const pieceLabel = (p) => `${short(p.name)} · ${fmt(p.size[0])} × ${fmt(p.size[1])} m${p.model?.status === "building" ? " · building 3D…" : ""}`;
function bounce(k) {
  // fall, then a small bounce
  if (k < 0.7) return (k / 0.7) ** 2;
  const u = (k - 0.7) / 0.3;
  return 1 - Math.sin(u * Math.PI) * 0.06;
}

// the footprint: a flat outline at floor level (overlay: no shadow, out of the AO pass)
function footprint([w, d], color) {
  const g = new THREE.Group();
  const fill = new THREE.Mesh(new THREE.PlaneGeometry(w + 0.08, d + 0.08), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false }));
  fill.rotation.x = -Math.PI / 2;
  const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([
    [-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => new THREE.Vector3(x * (w / 2 + 0.04), 0.002, z * (d / 2 + 0.04)))),
  new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 }));
  g.add(fill, edge);
  g.traverse((o) => { o.userData.noEdge = true; o.raycast = () => {}; });
  return g;
}

// a marker pin: a disc on the floor, a thin stem, a ball on top
function pin(at, color, scale = 1) {
  const g = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, depthWrite: false });
  const disc = new THREE.Mesh(new THREE.RingGeometry(0.12 * scale, 0.2 * scale, 32), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = 0.008;
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.06 * scale, 24), mat);
  dot.rotation.x = -Math.PI / 2;
  dot.position.y = 0.009;
  const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.95 * scale, 6), mat);
  stem.position.y = 0.95 * scale / 2;
  g.add(disc, dot, stem);
  g.traverse((o) => { o.userData.noEdge = true; o.renderOrder = 2; });
  g.position.copy(toWorld(at));
  return g;
}

// a dashed green line from the problem to the fix
function arrow(a, b) {
  const pa = toWorld(a, 0.02), pb = toWorld(b, 0.02);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([pa, pb]),
    new THREE.LineDashedMaterial({ color: GREEN, dashSize: 0.08, gapSize: 0.05, transparent: true }));
  line.computeLineDistances();
  line.userData.noEdge = true;
  return line;
}
