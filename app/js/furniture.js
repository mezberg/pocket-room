// Furniture in 3D: a room item or a piece (contract/) becomes a kit piece (kit/kit-real.js), a GLB,
// or a plain box, scaled to its size and stood at its plan spot.
// Plan → three.js: (x, h, -y). rot turns the front (local +z in the kit, −y in plan) counter-clockwise
// seen from above, which is rotation.y in three.js.
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as kit from "./kit/kit-real.js";
import { paint, shadows } from "./kit/real.js";

export const toWorld = ([x, y], h = 0) => new THREE.Vector3(x, h, -y);
export const toPlan = (v) => [v.x, -v.z];

// category → a kit piece built near its size (the box scale below takes it the rest of the way)
function fromCategory(item) {
  const [w, d, h] = item.size, cat = item.category, name = (item.name || "").toLowerCase();
  switch (cat) {
    case "sofa": return kit.sofa({ seats: Math.max(1, Math.round((w - 0.24) / 0.62)), depth: d, color: "linen", pillows: 2 });
    case "armchair": return kit.armchair({ color: "clay" });
    case "chair":
      if (/office/.test(name)) return officeChair();
      return kit.diningChair({ color: "moss" });
    case "table":
      if (h > 0.65) return kit.diningTable({ w, d, h, round: Math.abs(w - d) < 0.05 && /round/.test(name) });
      if (w < 0.5 && d < 0.5) return kit.coffeeTable({ w, d, h, round: true, top: "walnut" });
      return kit.coffeeTable({ w, d, h, top: "oak" });
    case "desk": return kit.desk({ w, d });
    case "shelf": case "bookcase": return kit.shelf({ w, h, d });
    case "cupboard": case "wardrobe": return kit.wardrobe({ w, h, d, doors: Math.max(1, Math.round(w / 0.55)), color: "cap" });
    case "dresser": return kit.dresser({ w, h, d });
    case "sideboard": return kit.sideboard({ w, h, d });
    case "tv": return tvBench(w, d, h);
    case "bed": return kit.bed({ w, l: d });
    case "nightstand": return kit.nightstand({ w, d });
    case "lamp": return /table/.test(name) ? kit.tableLamp() : kit.floorLamp();
    case "plant": return kit.plant({ size: Math.max(0.6, Math.min(h / 1.0, 2)) });
    case "rug": return kit.rug({ w, d });
    case "radiator": return radiator(w, d, h);
    default: return blockOf(item, "stone");
  }
}

function tvBench(w, d, h) {
  const g = kit.sideboard({ w, h: Math.min(h, 0.55), d, doors: 3, color: "walnut" });
  return g;
}

function radiator(w, d, h) {
  const g = new THREE.Group();
  const n = Math.max(4, Math.round(w / 0.06));
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w / n - 0.008, h, d), paint("cap"));
    m.position.set(-w / 2 + (i + 0.5) * w / n, h / 2, 0);
    g.add(m);
  }
  return g;
}

function officeChair() {
  const g = new THREE.Group();
  const add = (geo, color, x, y, z) => { const m = new THREE.Mesh(geo, paint(color)); m.position.set(x, y, z); g.add(m); return m; };
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5, leg = add(new THREE.BoxGeometry(0.03, 0.03, 0.3), "black", Math.sin(a) * 0.15, 0.05, Math.cos(a) * 0.15);
    leg.rotation.y = a;
  }
  add(new THREE.CylinderGeometry(0.025, 0.025, 0.36, 8), "black", 0, 0.24, 0);
  add(new THREE.BoxGeometry(0.5, 0.08, 0.48), "charcoal", 0, 0.46, 0);
  const back = add(new THREE.BoxGeometry(0.46, 0.5, 0.06), "charcoal", 0, 0.8, -0.22);
  back.rotation.x = -0.1;
  return g;
}

function blockOf(item, color) {
  const [w, d, h] = item.size;
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), paint(color));
  m.position.y = h / 2;
  g.add(m);
  return g;
}

// scale g so its bounding box is the item's size (w × h × d), footprint centred on the origin, on the floor
function fitToSize(g, [w, d, h]) {
  g.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(g), s = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.add(g);
  g.position.set(-c.x, -box.min.y, -c.z);
  inner.scale.set(s.x > 1e-3 ? w / s.x : 1, s.y > 1e-3 ? h / s.y : 1, s.z > 1e-3 ? d / s.z : 1);
  const outer = new THREE.Group();
  outer.add(inner);
  return outer;
}

// A room item (furniture or fixture). elevation: how high it stands (on top of something, or on a wall).
export function buildItem(item, elevation = 0) {
  const obj = fitToSize(fromCategory(item), item.size);
  shadows(obj);
  standAt(obj, item.at, item.rot ?? 0, elevation);
  obj.userData.item = item;
  return obj;
}

export function standAt(obj, at, rot = 0, h = 0) {
  obj.position.copy(toWorld(at, h));
  obj.rotation.y = THREE.MathUtils.degToRad(rot);
}

// A piece from lane B / G. Parametric → the kit template with its args; GLB → loaded and fitted;
// otherwise its category. The style's first colour paints the upholstery when it has one.
const loader = new GLTFLoader();
export async function buildPiece(piece) {
  const m = piece.model ?? {};
  let g;
  if (m.status === "ready" && m.glb) {   // GLB: y-up, front toward +z in three.js (plan −y)
    const gltf = await loader.loadAsync(m.glb);
    g = gltf.scene;
  } else if (m.parametric?.template && typeof kit[m.parametric.template] === "function") {
    const args = { ...m.parametric.args };
    const color = piece.style?.colors?.[0];
    if (color && args.color == null) args.color = color;
    g = kit[m.parametric.template](args);
  } else {
    g = fromCategory(piece);
  }
  const obj = fitToSize(g, piece.size);
  shadows(obj);
  obj.userData.piece = piece;
  return obj;
}
