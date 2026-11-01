// Sizes are computed here, never taken on trust from a model. Vision hands us the dimension text it
// read verbatim (a tag, a caption, a product page); this file parses it into metres. Without printed
// text we fall back to the model's estimate, clamped to what the category can be, and say so.

// Category defaults and plausible ranges, [width, depth, height] in metres.
export const CATEGORY = {
  sofa:     { size: [2.0, 0.9, 0.82],  min: [1.2, 0.7, 0.6],   max: [3.6, 1.8, 1.1] },
  armchair: { size: [0.8, 0.82, 0.8],  min: [0.5, 0.5, 0.55],  max: [1.3, 1.2, 1.2] },
  chair:    { size: [0.46, 0.5, 0.82], min: [0.35, 0.35, 0.4], max: [0.8, 0.8, 1.5] },   // office chairs with a headrest reach 1.45 m
  table:    { size: [1.1, 0.6, 0.42],  min: [0.3, 0.3, 0.25],  max: [3.2, 1.6, 1.1] },
  desk:     { size: [1.2, 0.6, 0.75],  min: [0.7, 0.4, 0.65],  max: [2.4, 1.0, 1.3] },
  bed:      { size: [1.6, 2.1, 1.0],   min: [0.9, 1.9, 0.3],   max: [2.2, 2.4, 1.6] },
  shelf:    { size: [0.9, 0.35, 1.8],  min: [0.3, 0.2, 0.3],   max: [3.0, 0.7, 2.6] },
  cupboard: { size: [1.6, 0.45, 0.7],  min: [0.4, 0.3, 0.4],   max: [3.0, 0.8, 2.6] },
  rug:      { size: [2.0, 2.9, 0.01],  min: [0.6, 0.6, 0.005], max: [4.0, 5.0, 0.04] },
  lamp:     { size: [0.4, 0.4, 1.6],   min: [0.1, 0.1, 0.2],   max: [1.2, 1.2, 2.2] },
  plant:    { size: [0.5, 0.5, 1.2],   min: [0.1, 0.1, 0.1],   max: [1.5, 1.5, 2.5] },
  tv:       { size: [1.45, 0.08, 0.84], min: [0.5, 0.03, 0.3], max: [2.5, 0.4, 1.5] },
  other:    { size: [0.8, 0.5, 0.8],   min: [0.05, 0.05, 0.05], max: [4, 4, 3] },
};
export const CATEGORIES = Object.keys(CATEGORY);

const UNIT = { mm: 0.001, cm: 0.01, m: 1, in: 0.0254, '"': 0.0254, inch: 0.0254, inches: 0.0254, ft: 0.3048, "'": 0.3048 };
const NUM = String.raw`(\d+(?:[.,]\d+)?)`;
const U = String.raw`(mm|cm|m|inches|inch|in|ft|"|')?`;

const toM = (n, unit) => parseFloat(String(n).replace(",", ".")) * UNIT[unit];

// Guess the unit of bare numbers from their size: furniture is 0.2–4 m.
function guessUnit(nums) {
  const max = Math.max(...nums);
  if (max > 400) return "mm";
  if (max > 10) return "cm";
  return "m";
}

// "W 78 cm D 82 cm H 74 cm", "160 × 45 × 70 cm", "84\"W x 36\"D x 33\"H", "Width: 2130mm" ...
// Returns [w, d, h] in metres, or null if the text doesn't hold a full size.
export function parseDimensions(text) {
  if (!text) return null;
  const t = String(text).toLowerCase().replace(/[×✕*]/g, "x").replace(/\s+/g, " ");

  // labelled: W/width, D/depth/L/length, H/height, before or after the number
  const label = { w: /^(w|width|wide)$/, d: /^(d|depth|deep|l|length|long)$/, h: /^(h|height|high|tall)$/ };
  const found = {};
  const before = new RegExp(String.raw`\b(w|width|d|depth|l|length|h|height)\b\s*[:=]?\s*${NUM}\s*${U}`, "g");
  const after = new RegExp(String.raw`${NUM}\s*${U}\s*\(?\b(w|wide|width|d|deep|depth|l|long|length|h|high|tall|height)\b`, "g");
  let unitSeen = null;
  for (const m of t.matchAll(before)) {
    const k = Object.keys(label).find(k => label[k].test(m[1]));
    if (k && !found[k]) { found[k] = [m[2], m[3]]; unitSeen ??= m[3]; }
  }
  if (Object.keys(found).length < 3) {
    for (const m of t.matchAll(after)) {
      const k = Object.keys(label).find(k => label[k].test(m[3]));
      if (k && !found[k]) { found[k] = [m[1], m[2]]; unitSeen ??= m[2]; }
    }
  }
  if (found.w && found.d && found.h) {
    const nums = ["w", "d", "h"].map(k => parseFloat(found[k][0].replace(",", ".")));
    const fallback = unitSeen ?? guessUnit(nums);
    return ["w", "d", "h"].map(k => round(toM(found[k][0], found[k][1] ?? fallback)));
  }

  // unlabelled "a x b x c unit": furniture convention is W x D x H
  const triple = new RegExp(String.raw`${NUM}\s*${U}\s*x\s*${NUM}\s*${U}\s*x\s*${NUM}\s*${U}`);
  const m = t.match(triple);
  if (m) {
    const nums = [m[1], m[3], m[5]].map(n => parseFloat(n.replace(",", ".")));
    const unit = m[6] ?? m[4] ?? m[2] ?? guessUnit(nums);
    return [m[1], m[3], m[5]].map((n, i) => round(toM(n, [m[2], m[4], m[6]][i] ?? unit)));
  }
  return null;
}

const round = v => Math.round(v * 1000) / 1000;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Decide the size and how sure it is. `read` is what vision returned.
export function resolveSize({ category, dimension_text, dimension_where, estimate_m }) {
  const cat = CATEGORY[category] ?? CATEGORY.other;
  const parsed = parseDimensions(dimension_text);
  if (parsed && parsed.every(v => v > 0)) {
    const where = dimension_where === "tag" ? "tag" : "product_page";
    return { size: orient(category, parsed), size_source: where, size_text: dimension_text };
  }
  const e = estimate_m;
  if (e && [e.w, e.d, e.h].every(v => typeof v === "number" && v > 0)) {
    const size = [e.w, e.d, e.h].map((v, i) => round(clamp(v, cat.min[i], cat.max[i])));
    return { size: orient(category, size), size_source: "vision_estimate", size_text: null };
  }
  return { size: [...cat.size], size_source: "category_default", size_text: null };
}

// Seating, tables and storage are wider than deep; if a source lists them the other way round, swap.
// Beds and rugs are left alone (a bed is longer than wide).
function orient(category, [w, d, h]) {
  if (["sofa", "cupboard", "desk", "tv"].includes(category) && d > w) return [d, w, h];
  return [w, d, h];
}
