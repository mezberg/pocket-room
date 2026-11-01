// Fixes in the app: what to send for one, how one changes the room, and how Check my room reads afterwards.
// Pure functions (no DOM, no three.js), tested in node.
import { analyseBody } from "./scene-state.js";

// POST /api/fixes body: the room and piece exactly as /api/analyse got them, plus the finding.
export function fixBody(room, piece, spot, finding, opts) {
  const { id, kind, at, items, say, width_m } = finding;
  return { ...analyseBody(room, piece, spot, opts), finding: { id, kind, at, items, say, width_m } };
}

// The room (and the new piece's spot) once an option is applied. A step on the new piece moves its spot;
// every other step changes the room's own furniture and lights. Returns new objects, never edits the old.
export function applyFix(room, option, { pieceId, spot } = {}) {
  let out = { ...room, furniture: [...(room.furniture ?? [])], lights: [...(room.lights ?? [])] };
  let s = spot ? { ...spot } : spot;
  for (const st of option.steps ?? []) {
    if (st.add) {
      out.furniture = out.furniture.filter((f) => f.id !== st.add.id).concat({ ...st.add });
      if (st.light) out.lights = out.lights.filter((l) => l.id !== st.light.id).concat({ ...st.light });
      continue;
    }
    if (pieceId && st.item === pieceId && s) {
      if (st.at) s = { ...s, at: st.at, rot: st.rot ?? s.rot, moved: true };
      continue;
    }
    if (st.remove) {
      out.furniture = out.furniture.filter((f) => f.id !== st.item);
      out.lights = out.lights.filter((l) => l.id !== st.item);
      continue;
    }
    out.furniture = out.furniture.map((f) => (f.id !== st.item ? f : {
      ...f, ...(st.at ? { at: st.at } : {}), ...(st.rot != null ? { rot: st.rot } : {}), ...(st.size ? { size: st.size } : {}),
    }));
    // a lamp that moves takes its light with it
    if (st.at) out.lights = out.lights.map((l) => (l.id === st.item ? { ...l, at: st.at } : l));
  }
  return { room: out, spot: s };
}

// Undo: a stack of what the room and spot were before each apply.
export function undoStack() {
  const stack = [];
  return {
    push(state) { stack.push(structuredClone(state)); },
    pop() { return stack.pop() ?? null; },
    clear() { stack.length = 0; },
    get size() { return stack.length; },
  };
}

// After an applied fix the room is checked again. If the finding it fixed is gone, it shows as a green
// "Fixed" marker where it was; if it's still there (the same sentence, or the same pieces at the same place),
// it stays as it is. Another problem nearby (a different way still closed) is a different finding.
const sameItems = (a = [], b = []) => a.length === b.length && a.every((x) => b.includes(x));
export function withFixed(findings, fixed, option) {
  if (!fixed) return findings;
  const near = (f) => !fixed.at || !f.at || Math.hypot(f.at[0] - fixed.at[0], f.at[1] - fixed.at[1]) < 0.6;
  const still = findings.some((f) => f.id === fixed.id && !f.pass && (f.say === fixed.say || (sameItems(f.items, fixed.items) && near(f))));
  if (still) return findings;
  return [{ id: fixed.id, kind: fixed.kind, pass: true, severity: "info", fixed: true, at: fixed.at, items: fixed.items, say: `Fixed: ${option.say}` }, ...findings];
}

// Where each moved piece goes, for the ghost preview: [{ item, from, to, rot, remove, add, size }]
export function previewMoves(room, option, { pieceId, spot, piece } = {}) {
  const items = [...(room.fixtures ?? []), ...(room.furniture ?? [])];
  return (option.steps ?? []).map((st) => {
    if (st.add) return { add: st.add, to: st.add.at, rot: st.add.rot ?? 0 };
    const isPiece = pieceId && st.item === pieceId;
    const it = isPiece ? { ...piece, id: pieceId, at: spot?.at, rot: spot?.rot } : items.find((x) => x.id === st.item);
    if (!it) return null;
    return { item: it, piece: !!isPiece, from: it.at, to: st.at ?? it.at, rot: st.rot ?? it.rot ?? 0, remove: !!st.remove, size: st.size };
  }).filter(Boolean);
}
