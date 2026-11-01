// GLBs: build one from a list of primitive parts, and normalise any GLB (ours or a generator's) to the
// contract: scaled to `size`, base on the floor, centred, front at plan −y (glTF/three.js +z), decimated.
// glTF frame: y up, metres. Plan [w, d, h] ↔ glTF extents [x, z, y].
import { Document, NodeIO } from "@gltf-transform/core";
import { getBounds, transformMesh, clearNodeTransform, flatten, weld, simplify, dedup, prune } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";

export const io = new NodeIO();
const TRI_BUDGET = 40_000;   // above this, simplify

// ------------------------------------------------------------------ primitive geometry (y up)
// Each returns { pos: number[], nrm: number[], idx: number[] } in local space, centred on the origin.
function quadGrid(out, origin, u, v, us, vs, normal) {
  const base = out.pos.length / 3;
  for (const b of vs) for (const a of us) {
    out.pos.push(origin[0] + u[0] * a + v[0] * b, origin[1] + u[1] * a + v[1] * b, origin[2] + u[2] * a + v[2] * b);
    out.nrm.push(...normal);
  }
  const n = us.length;
  for (let j = 0; j < vs.length - 1; j++) for (let i = 0; i < n - 1; i++) {
    const p = base + j * n + i;
    out.idx.push(p, p + 1, p + n + 1, p, p + n + 1, p + n);
  }
}

// Box with optional rounded edges: a face grid denser near the edges, projected onto a rounded box.
function box([w, h, d], r = 0) {
  const half = [w / 2, h / 2, d / 2];
  r = Math.max(0, Math.min(r, ...half.map(x => x * 0.98)));
  const steps = (hx) => {
    if (!r) return [-hx, hx];
    const k = 4, band = [];
    for (let i = 0; i <= k; i++) band.push(hx - r + r * (i / k));
    return [...band.slice().reverse().map(x => -x), ...band];
  };
  const out = { pos: [], nrm: [], idx: [] };
  const [X, Y, Z] = [steps(half[0]), steps(half[1]), steps(half[2])];
  // +x, -x, +y, -y, +z, -z faces; u × v points outward
  quadGrid(out, [half[0], 0, 0], [0, 0, -1], [0, 1, 0], Z, Y, [1, 0, 0]);
  quadGrid(out, [-half[0], 0, 0], [0, 0, 1], [0, 1, 0], Z, Y, [-1, 0, 0]);
  quadGrid(out, [0, half[1], 0], [1, 0, 0], [0, 0, -1], X, Z, [0, 1, 0]);
  quadGrid(out, [0, -half[1], 0], [1, 0, 0], [0, 0, 1], X, Z, [0, -1, 0]);
  quadGrid(out, [0, 0, half[2]], [1, 0, 0], [0, 1, 0], X, Y, [0, 0, 1]);
  quadGrid(out, [0, 0, -half[2]], [-1, 0, 0], [0, 1, 0], X, Y, [0, 0, -1]);
  if (r) {
    for (let i = 0; i < out.pos.length; i += 3) {
      const p = out.pos.slice(i, i + 3);
      const inner = p.map((x, a) => Math.max(-(half[a] - r), Math.min(half[a] - r, x)));
      const dv = p.map((x, a) => x - inner[a]);
      const len = Math.hypot(...dv);
      if (len < 1e-9) continue;
      for (let a = 0; a < 3; a++) { out.nrm[i + a] = dv[a] / len; out.pos[i + a] = inner[a] + dv[a] / len * r; }
    }
  }
  return out;
}

function cylinder([dx, h, dz], seg = 20) {
  const out = { pos: [], nrm: [], idx: [] };
  const rx = dx / 2, rz = (dz ?? dx) / 2;
  for (let i = 0; i <= seg; i++) {
    const t = (i / seg) * Math.PI * 2, c = Math.cos(t), s = Math.sin(t);
    const n = [c / rx, 0, s / rz], l = Math.hypot(...n);
    out.pos.push(c * rx, -h / 2, s * rz, c * rx, h / 2, s * rz);
    out.nrm.push(n[0] / l, 0, n[2] / l, n[0] / l, 0, n[2] / l);
  }
  for (let i = 0; i < seg; i++) { const p = i * 2; out.idx.push(p, p + 1, p + 3, p, p + 3, p + 2); }
  for (const [y, ny] of [[h / 2, 1], [-h / 2, -1]]) {
    const c0 = out.pos.length / 3;
    out.pos.push(0, y, 0); out.nrm.push(0, ny, 0);
    for (let i = 0; i <= seg; i++) {
      const t = (i / seg) * Math.PI * 2;
      out.pos.push(Math.cos(t) * rx, y, Math.sin(t) * rz); out.nrm.push(0, ny, 0);
    }
    for (let i = 0; i < seg; i++) ny > 0 ? out.idx.push(c0, c0 + i + 2, c0 + i + 1) : out.idx.push(c0, c0 + i + 1, c0 + i + 2);
  }
  return out;
}

function sphere([w, h, d], ws = 18, hs = 12) {
  const out = { pos: [], nrm: [], idx: [] };
  for (let j = 0; j <= hs; j++) {
    const v = j / hs, phi = v * Math.PI;
    for (let i = 0; i <= ws; i++) {
      const th = (i / ws) * Math.PI * 2;
      const u = [-Math.cos(th) * Math.sin(phi), Math.cos(phi), Math.sin(th) * Math.sin(phi)];
      out.pos.push(u[0] * w / 2, u[1] * h / 2, u[2] * d / 2);
      const n = [u[0] / w, u[1] / h, u[2] / d], l = Math.hypot(...n) || 1;
      out.nrm.push(n[0] / l, n[1] / l, n[2] / l);
    }
  }
  for (let j = 0; j < hs; j++) for (let i = 0; i < ws; i++) {
    const a = j * (ws + 1) + i, b = a + ws + 1;
    out.idx.push(a + 1, a, b + 1, a, b, b + 1);
  }
  return out;
}

// Euler XYZ (degrees) rotation matrix, row-major 3×3
function rotation([rx = 0, ry = 0, rz = 0] = []) {
  const [a, b, c] = [rx, ry, rz].map(x => (x * Math.PI) / 180);
  const [ca, sa, cb, sb, cc, sc] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(c), Math.sin(c)];
  // R = Rz · Ry · Rx (three.js 'XYZ' order)
  return [
    cb * cc, sa * sb * cc - ca * sc, ca * sb * cc + sa * sc,
    cb * sc, sa * sb * sc + ca * cc, ca * sb * sc - sa * cc,
    -sb, sa * cb, ca * cb,
  ];
}
const mul = (R, v) => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];

const SHAPES = { box: (p) => box(p.size), rounded_box: (p) => box(p.size, p.radius ?? 0.03), cylinder: (p) => cylinder(p.size), sphere: (p) => sphere(p.size) };

// sRGB hex → linear RGBA (glTF baseColorFactor is linear)
export function linear(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? "");
  const n = m ? parseInt(m[1], 16) : 0x999999;
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return [...c, 1];
}

// parts: [{ name, shape, size: [x, y, z], pos: [x, y, z], rot: [rx, ry, rz], color, radius }] (y up, front +z)
// → a Document with one primitive per colour.
export function partsToDocument(parts, { roughness = 0.65 } = {}) {
  const doc = new Document();
  const buffer = doc.createBuffer();
  const byColor = new Map();
  for (const part of parts) {
    const make = SHAPES[part.shape] ?? SHAPES.box;
    if (!Array.isArray(part.size) || part.size.length < 3 || part.size.some(v => !(v > 0))) continue;
    const g = make(part);
    const R = rotation(part.rot), t = part.pos ?? [0, 0, 0];
    const key = (part.color ?? "#999999").toLowerCase();
    const acc = byColor.get(key) ?? { pos: [], nrm: [], idx: [] };
    const base = acc.pos.length / 3;
    for (let i = 0; i < g.pos.length; i += 3) {
      const p = mul(R, g.pos.slice(i, i + 3)), n = mul(R, g.nrm.slice(i, i + 3));
      acc.pos.push(p[0] + t[0], p[1] + t[1], p[2] + t[2]); acc.nrm.push(...n);
    }
    for (const i of g.idx) acc.idx.push(base + i);
    byColor.set(key, acc);
  }
  const mesh = doc.createMesh("piece");
  for (const [color, g] of byColor) {
    const mat = doc.createMaterial(color).setBaseColorFactor(linear(color)).setRoughnessFactor(roughness).setMetallicFactor(0);
    const prim = doc.createPrimitive()
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.pos)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(g.nrm)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(g.idx)).setBuffer(buffer))
      .setMaterial(mat);
    mesh.addPrimitive(prim);
  }
  doc.createScene("scene").addChild(doc.createNode("piece").setMesh(mesh));
  return doc;
}

// ------------------------------------------------------------------ normalise
// size: plan [w, d, h] in metres. yaw: degrees to turn the model about y before fitting (a generator's
// front may not face +z). Scales each axis to fit exactly: the rules work on the box, so the box must be right.
export async function normalise(doc, size, { yaw = 0, triBudget = TRI_BUDGET } = {}) {
  const root = doc.getRoot();
  const scene = root.getDefaultScene() ?? root.listScenes()[0];
  // bake every node transform into its mesh, so the meshes are in scene space
  for (const s of root.listScenes()) if (s !== scene) s.dispose();
  await doc.transform(flatten());
  for (const node of root.listNodes()) if (node.getMesh()) clearNodeTransform(node);
  for (const node of root.listNodes()) if (!node.getMesh()) { node.setTranslation([0, 0, 0]).setRotation([0, 0, 0, 1]).setScale([1, 1, 1]); }

  const meshes = [...new Set(root.listNodes().map(n => n.getMesh()).filter(Boolean))];
  if (yaw) {
    const a = (yaw * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
    for (const m of meshes) transformMesh(m, [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
  }
  const { min, max } = getBounds(scene);
  const ext = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const [w, d, h] = size;
  const k = [w / ext[0], h / ext[1], d / ext[2]];
  const c = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  // M = S · T(−c), column-major
  const M = [k[0], 0, 0, 0, 0, k[1], 0, 0, 0, 0, k[2], 0, -c[0] * k[0], -c[1] * k[1], -c[2] * k[2], 1];
  for (const m of meshes) transformMesh(m, M);

  await doc.transform(dedup());
  // simplify within 1% of the size first; if that can't reach the budget, allow 3%
  for (const error of [0.01, 0.03]) {
    const tris = countTriangles(doc);
    if (tris <= triBudget * 1.1) break;
    await MeshoptSimplifier.ready;
    await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: triBudget / tris, error }));
  }
  await doc.transform(prune());
  return doc;
}

export function countTriangles(doc) {
  let n = 0;
  for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) {
    const idx = p.getIndices();
    n += (idx ? idx.getCount() : p.getAttribute("POSITION").getCount()) / 3;
  }
  return n;
}

export const boundsOf = (doc) => getBounds(doc.getRoot().getDefaultScene() ?? doc.getRoot().listScenes()[0]);
export const toGLB = (doc) => io.writeBinary(doc);
export const fromGLB = (bytes) => io.readBinary(new Uint8Array(bytes));
