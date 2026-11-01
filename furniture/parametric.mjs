// A piece → a parametric kit template (app/js/kit/kit-real.js, or chesterfield.js) with args computed
// from its size. The app builds it with `KIT[template](args)` and, since the kit's heights are fixed,
// scales the group so its bounding box matches `fit` (= piece.size, three.js order [x, y, z] = [w, h, d]).
// Multiply the group's scale, don't set it: chesterfieldLoveseat scales its own root. See viewer.html fitTo().

const WOODS = { oak: "#C59C6E", walnut: "#7B5B42" };

// kit template → the module that exports it
export const MODULES = { chesterfieldLoveseat: "chesterfield.js" };
export const TEMPLATES = ["sofa", "armchair", "chesterfieldLoveseat", "diningChair", "coffeeTable", "diningTable",
  "desk", "bed", "nightstand", "wardrobe", "shelf", "sideboard", "dresser", "tv", "floorLamp", "tableLamp", "plant", "rug"];

// The kit takes palette names or any CSS colour; pick the nearest wood name for wood, else the hex.
function wood(hex) {
  if (!hex) return "oak";
  const d = (a, b) => [1, 3, 5].reduce((s, i) => s + (parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) ** 2, 0);
  return d(hex, WOODS.oak) <= d(hex, WOODS.walnut) ? "oak" : "walnut";
}
const r2 = v => Math.round(v * 100) / 100;

export function kitFor(piece, read = {}) {
  const [w, d, h] = piece.size;
  const colors = piece.style?.colors ?? [];
  const main = colors[0] ?? "linen", second = colors[1];
  const t = read.kit_template;
  const seats = Math.max(1, read.seats ?? Math.round(w / 0.7));
  const done = (template, args) => ({ template, module: MODULES[template] ?? "kit-real.js", args, fit: [w, h, d] });

  switch (t) {
    case "chesterfieldLoveseat":
      return done(t, { width: w, depth: d, height: h, seats: Math.min(seats, 3), leather: main });
    case "sofa": case "armchair": {
      const arms = read.arms ?? (t === "armchair" ? "wide" : "slim");
      const armW = { none: 0, slim: 0.12, wide: 0.24 }[arms] ?? 0.12;
      const n = t === "armchair" ? 1 : seats;
      const legs = read.legs === "wood" ? "frame" : (read.legs ?? "block");
      return done("sofa", { seats: n, seatW: r2(Math.max(0.3, (w - 2 * armW) / n)), depth: r2(d), arms, legs, color: main, wood: wood(second) });
    }
    case "coffeeTable": case "diningTable":
      return done(t, { w: r2(w), d: r2(d), h: r2(h), top: read.material === "wood" ? wood(main) : main, round: !!read.round });
    case "desk":
      return done(t, { w: r2(w), d: r2(d), top: wood(main) });
    case "bed":
      return done(t, { w: r2(w), l: r2(d), frame: wood(main) });
    case "nightstand":
      return done(t, { w: r2(w), d: r2(d), color: main });
    case "wardrobe":
      return done(t, { w: r2(w), h: r2(h), d: r2(d), doors: read.doors ?? Math.max(1, Math.round(w / 0.5)), color: main });
    case "shelf":
      return done(t, { w: r2(w), h: r2(h), d: r2(d), shelves: Math.max(2, Math.round(h / 0.35)), board: wood(main) });
    case "sideboard":
      return done(t, { w: r2(w), h: r2(h), d: r2(d), doors: read.doors ?? Math.max(1, Math.round(w / 0.55)), color: main,
        base: read.legs === "wood" ? wood(main) : "black" });
    case "dresser":
      return done(t, { w: r2(w), h: r2(h), d: r2(d), color: main });
    case "tv":
      return done(t, { size: Math.round(Math.hypot(w, h) / 0.0254) });
    case "floorLamp": case "tableLamp":
      return done(t, { shade: main });
    case "plant":
      return done(t, { size: r2(h / 1.2) });
    case "rug":
      return done(t, { w: r2(w), d: r2(d), color: main });
    case "diningChair":
      return done(t, { color: main, wood: wood(second) });
    default:
      return null;
  }
}

// The kit template for a category when nothing has read the picture (a pasted link, an agent find).
const BY_CATEGORY = { sofa: "sofa", armchair: "armchair", shelf: "shelf", cupboard: "sideboard", tv: "sideboard", desk: "desk",
  chair: "diningChair", bed: "bed", rug: "rug", lamp: "floorLamp", plant: "plant" };
export const templateFor = (category, size) =>
  category === "table" ? (size[2] > 0.6 ? "diningTable" : "coffeeTable") : BY_CATEGORY[category] ?? null;
