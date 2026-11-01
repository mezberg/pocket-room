// Helpers that turn plan pixels + manifest boxes into room.json parts. Pure functions, no I/O.
import { readFileSync } from "node:fs";
import { X, Y, M } from "./plan.mjs";

export const r3 = (v) => Math.round(v * 1000) / 1000;
export const pt = (px, py) => [r3(X(px)), r3(Y(py))];

const manifest = JSON.parse(readFileSync(new URL("./manifest.json", import.meta.url)));
export const assembly = (name) => {
  const a = manifest.assemblies.find((a) => a.name === name);
  if (!a) throw new Error(`no assembly "${name}" in manifest.json`);
  return a;
};

/**
 * Walls from a closed polygon of inner-face corners in plan pixels, counter-clockwise from above
 * (x east, y north; py grows southwards). ids[i] names the wall from corner i to corner i+1.
 */
export function walls(corners, ids, openings = {}) {
  return corners.map((c, i) => {
    const d = corners[(i + 1) % corners.length];
    return { id: ids[i], a: pt(...c), b: pt(...d), openings: (openings[ids[i]] || []).map((o) => opening(c, d, o)) };
  });
}

// An opening given by its pixel span [s0, s1] along the wall (x px on horizontal walls, y px on vertical).
function opening(a, b, o) {
  const horiz = a[1] === b[1];
  const pa = horiz ? a[0] : a[1];
  const [s0, s1] = o.span;
  const near = Math.min(Math.abs(s0 - pa), Math.abs(s1 - pa));
  const out = { id: o.id, kind: o.kind, from: r3(M(near)), width: r3(M(Math.abs(s1 - s0))) };
  if (o.sill != null) out.sill = o.sill;
  if (o.head != null) out.head = o.head;
  if (o.kind === "door" || o.kind === "glazed_door") {
    if (o.hingePx == null) out.swing = null;
    else {
      // hinge: which end of the opening it is on, the end towards wall end a or the one towards b
      const endA = Math.abs(s0 - pa) < Math.abs(s1 - pa) ? s0 : s1;
      const hinge = o.hingePx === endA ? "a" : "b";
      out.swing = { hinge, into: o.into };
    }
  }
  return out;
}

/**
 * An item from a manifest assembly: footprint centre and world-axis box from the manifest,
 * turned into the piece's own frame by `rot` (0 = front faces south, 90 = east, CCW).
 * `h` overrides the height when the box includes things standing on the piece.
 * Pass `size` for pieces at angles that aren't multiples of 90 (the world box isn't their footprint).
 */
export function item(id, assemblyName, category, rot, { size, at, h, onFloor = true, name } = {}) {
  const a = assembly(assemblyName);
  const [sx, sy, sz] = a.size;
  const quarter = ((rot % 180) + 180) % 180 === 90;
  const s = size || (quarter ? [sy, sx, sz] : [sx, sy, sz]);
  if (h != null) s[2] = h;
  return {
    id, name: name || a.name, category,
    at: at ? at.map(r3) : [r3(a.origin_blender[0]), r3(a.origin_blender[1])],
    size: s.map(r3), rot, on_floor: onFloor,
  };
}

/** An item from a plan-pixel rectangle (world axes) and its facing; for things the manifest lumps together. */
export function pbox(id, name, category, rot, [px0, py0, px1, py1], h, onFloor = true) {
  const sx = Math.abs(X(px1) - X(px0)), sy = Math.abs(Y(py1) - Y(py0));
  const quarter = ((rot % 180) + 180) % 180 === 90;
  return {
    id, name, category, at: [r3((X(px0) + X(px1)) / 2), r3((Y(py0) + Y(py1)) / 2)],
    size: (quarter ? [sy, sx, h] : [sx, sy, h]).map(r3), rot, on_floor: onFloor,
  };
}
