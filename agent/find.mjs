// "Find me a sofa for this wall": search UK shops, read each product page, keep what fits and suits.
//
//   search (Responses + web_search) → fetch each page ourselves (link check) → read sizes off the page
//   (model copies the text; code checks the text is on the page) → fit by lane D's rules (rules/ place())
//   → style match (model) → three options, each with a one-line reason whose numbers come from code.
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { bestWall, freeSpace } from "./space.mjs";
import { place } from "../rules/index.mjs";
import { kitFor } from "../furniture/parametric.mjs";
import { UK_SHOPS, fetchPage, pageMeta, pageText, shopFor, sizeSnippets } from "./page.mjs";
import { judgeStyle, readProductPage, readRoomStyle, searchProducts } from "./models.mjs";

export const ROOM_IMAGES = {
  "hoskins-living": fileURLToPath(new URL("./assets/hoskins-living-room.jpg", import.meta.url)),
};

const CATEGORIES = [
  [/sofa|couch|settee/i, "sofa"], [/armchair|accent chair|lounge chair/i, "armchair"],
  [/bookcase|shel(f|ves)/i, "shelf"], [/sideboard|cabinet|cupboard|dresser/i, "cupboard"],
  [/tv (unit|bench|stand)|media unit/i, "tv"], [/desk/i, "desk"], [/table/i, "table"],
  [/chair/i, "chair"], [/bed\b/i, "bed"], [/rug/i, "rug"], [/lamp/i, "lamp"],
];
export const categoryOf = (query) => CATEGORIES.find(([re]) => re.test(query))?.[1] ?? "other";

/**
 * @param room   contract room
 * @param opts   { query, wall?, count = 3 }
 * @param deps   { openai, models: { text }, fetch, log, styleCache }
 * @returns { pieces, space: { wall, run, category }, rejected: [{ url, why }] }
 */
export async function find(room, { query, wall, count = 3 }, { openai, models, fetch, log = () => {}, styleCache = new Map() }) {
  const category = categoryOf(query);
  // A sofa "for this wall" replaces the sofa that is there, so the old one isn't in the way.
  const opts = { replace: category };
  const space = wall ? freeSpace(room, wall, opts) : bestWall(room, opts);
  if (!space?.runs.length) return { pieces: [], space: null, rejected: [], say: "There is no free stretch of wall here." };
  const run = space.runs[0];
  log(`wall ${space.wall}: ${run.length} m free, up to ${(run.open).toFixed(2)} m deep`);

  const style = await roomStyle(room, { openai, models, styleCache });
  const rejected = [];
  const reject = (url, why) => { rejected.push({ url, why }); log(`✗ ${url} — ${why}`); };

  // 1. Search. Ask for things a bit smaller than the run so most of what comes back can fit.
  const found = await searchProducts(openai, models.text, {
    query, category, style: style.summary,
    minWidthCm: Math.max(0, Math.round((run.length - 0.9) * 10) * 10), maxWidthCm: Math.floor(run.length * 100), maxDepthCm: Math.floor((run.depth + 0.15) * 100),
    shops: UK_SHOPS.map((s) => s.name), count: 10,
  });
  const urls = [...new Map(found.map((p) => [p.url.split("#")[0], p])).values()];
  log(`search: ${urls.length} product pages`);

  // 2–3. Fetch and read each page, in parallel.
  const read = await Promise.all(urls.map(async (hit) => {
    const shop = shopFor(hit.url);
    if (!shop) return reject(hit.url, "not one of the UK shops we can check");
    const page = await fetchPage(hit.url, { fetch });
    if (!page.ok) return reject(hit.url, `link does not work (HTTP ${page.status})`);
    const text = pageText(page.html), meta = pageMeta(page.html);
    let got;
    try {
      got = await readProductPage(openai, models.text, { url: page.url, title: meta.title, snippets: sizeSnippets(text) });
    } catch (e) { return reject(hit.url, `could not read the page (${e.message})`); }
    if (!got.is_product) return reject(hit.url, "not a product page");
    const size = checkedSize(got, text);
    if (!size.ok) return reject(hit.url, size.why);
    return { hit, shop, page, meta, got, size: size.m };
  }));

  // 4. Fit, by code: lane D's place() on the whole room (walls, doors, swings, walkways), preferring the wall
  // the search was sized for.
  const fitting = [];
  for (const c of read.filter(Boolean)) {
    if (category !== "other" && c.got.category !== category) { reject(c.hit.url, `it is a ${c.got.category}, not a ${category}`); continue; }
    const fit = fitByRules(room, c.size, { category, wall: space.wall, strict: !!wall, run });
    if (!fit.fits) { reject(c.hit.url, `${fmt(c.size[0])} × ${fmt(c.size[1])} doesn't fit: ${fit.say}`); continue; }
    fitting.push({ ...c, fit });
  }
  if (!fitting.length) return { pieces: [], space: { wall: space.wall, run, category }, rejected, style };

  // 5. Style, by model; numbers stay out of it.
  const ids = fitting.map((c) => idFor(c.page.url));
  let judged = [];
  try {
    judged = await judgeStyle(openai, models.text, {
      replacing: category,
      room: { summary: style.summary, tags: style.tags, colors: style.colors, materials: style.materials },
      candidates: fitting.map((c, i) => ({ id: ids[i], name: c.meta.title ?? c.hit.name, colors: c.got.colors, material: c.got.material, tags: c.got.tags })),
    });
  } catch (e) { log(`style judge failed: ${e.message}`); }
  const byId = new Map(judged.map((j) => [j.id, j]));

  const ranked = fitting.map((c, i) => {
    const j = byId.get(ids[i]) ?? { match: 0.5, note: "" };
    // Fits beats Just fits; then style; then using the wall well (about 60 cm to spare is right, either way
    // is worse); a piece with a picture beats one without.
    const use = c.fit.spare_m == null ? 0.5 : clamp01(1 - Math.abs(c.fit.spare_m - 0.6) / 1.2);
    const score = (c.fit.verdict === "Fits" ? 1 : 0.6) * (c.meta.image ? 1 : 0.9) * (0.7 * clamp01(j.match) + 0.3 * use);
    return { c, id: ids[i], j, score };
  }).sort((a, b) => b.score - a.score);

  // Three different options: one per shop first, then one per product line (the same sofa in two
  // colours is one option), then whatever is best.
  const line = (r) => (r.c.meta.title ?? r.c.hit.name).toLowerCase().split(/[ ,]/)[0] + r.c.shop.name;
  const picked = [];
  const take = (ok) => { for (const r of ranked) if (picked.length < count && !picked.includes(r) && ok(r)) picked.push(r); };
  take((r) => !picked.some((p) => p.c.shop === r.c.shop));
  take((r) => !picked.some((p) => line(p) === line(r)));
  take(() => true);

  return {
    pieces: picked.map(({ c, id, j }) => toPiece(c, { id, category, note: j.note })),
    space: { wall: space.wall, run: { from: run.from, to: run.to, length: run.length, depth: run.depth }, category },
    style, rejected,
  };
}

/**
 * Does a piece of this size fit, by lane D's rules? The best legal spot on `wall` (or, unless strict, on any
 * wall when that one has none). spare_m = how much of the wall's free run is left, when it went on that wall.
 */
export function fitByRules(room, size, { category, wall, strict = false, run } = {}) {
  const p = place(room, { id: "candidate", category, name: `new ${category}`, size });
  const onWall = wall ? p.spots.filter((s) => s.wall === wall) : p.spots;
  const best = onWall[0] ?? (strict ? null : p.spots[0]);
  if (!best) return { verdict: "Doesn't fit", fits: false, say: p.best ? `not on the ${wall} wall` : p.say };
  const spare = run && best.wall === wall ? Math.round((run.length - size[0]) * 1000) / 1000 : null;
  return { verdict: best.verdict, fits: true, wall: best.wall ?? null, at: best.at, rot: best.rot, clearance_m: best.clearance_m,
    spare_m: spare, ...(best.replaces ? { replaces: best.replaces } : {}) };
}

/** The room's style: from the room JSON if it has one, else a Vision read of the room's picture (cached). */
export async function roomStyle(room, { openai, models, styleCache = new Map() }) {
  if (room.style?.tags?.length || room.style?.colors?.length) {
    return { tags: room.style.tags ?? [], colors: room.style.colors ?? [], materials: [], summary: (room.style.tags ?? []).join(", ") };
  }
  if (styleCache.has(room.id)) return styleCache.get(room.id);
  const img = ROOM_IMAGES[room.id];
  let s = { tags: [], colors: [], materials: [], summary: "" };
  if (img) {
    try { s = await readRoomStyle(openai, models.text, img); } catch { /* style is a nice-to-have */ }
  }
  styleCache.set(room.id, s);
  return s;
}

/**
 * Sizes the model copied, checked against the page: each quote must be on the page, and must hold the number.
 * Nothing without all three stated dimensions gets through. Returns metres [w, d, h].
 */
export function checkedSize(got, text) {
  const flat = norm(text);
  const m = [];
  for (const k of ["width", "depth", "height"]) {
    const d = got[k];
    if (!d || !(d.cm > 0)) return { ok: false, why: `no ${k} stated on the page` };
    if (!flat.includes(norm(d.quote))) return { ok: false, why: `${k} quote "${d.quote}" is not on the page` };
    const nums = [...d.quote.replace(/(\d),(\d{3})/g, "$1$2").matchAll(/\d+(?:[.,]\d+)?/g)].map((x) => Number(x[0].replace(",", ".")));
    if (!nums.some((n) => near(n, d.cm) || near(n, d.cm * 10) || near(n, d.cm / 100))) {
      return { ok: false, why: `${k} ${d.cm} cm is not what the page says ("${d.quote}")` };
    }
    if (d.cm < 10 || d.cm > 500) return { ok: false, why: `${k} ${d.cm} cm is not a furniture size` };
    m.push(Math.round(d.cm * 10) / 1000);
  }
  return { ok: true, m };
}

function toPiece(c, { id, category, note }) {
  const [w, d, h] = c.size;
  const name = c.meta.title ?? c.hit.name;
  const spare = c.fit.spare_m, wall = c.fit.wall;
  const verb = c.fit.verdict === "Fits" ? "fits" : "just fits";
  const where = wall ? `the ${wall} wall` : "the middle of the room";
  const fitText = spare != null && spare >= 0
    ? `${fmt(w)} wide, ${verb} ${where} with ${cm(spare)} to spare`
    : `${fmt(w)} wide, ${verb} ${where} with ${cm(c.fit.clearance_m)} to walk past`;
  const reason = [fitText, note && !/\d/.test(note) ? note.replace(/\.$/, "") : null].filter(Boolean).join("; ");
  return {
    id,
    category,
    name,
    size: [w, d, h],
    size_source: "product_page",
    style: { tags: c.got.tags ?? [], colors: c.got.colors ?? [], material: c.got.material ?? undefined },
    source: { kind: "agent", image: absolute(c.meta.image, c.page.url), url: c.page.url, price: c.meta.price ?? null, shop: c.shop.name },
    model: modelFor(category, c.size, c.got),
    agent: {
      reason,
      fit: { verdict: c.fit.verdict, wall, at: c.fit.at, rot: c.fit.rot, spare_m: spare, clearance_m: c.fit.clearance_m, ...(c.fit.replaces ? { replaces: c.fit.replaces } : {}) },
      quotes: { width: c.got.width.quote, depth: c.got.depth.quote, height: c.got.height.quote },
    },
  };
}

// A parametric piece from lane B's kit (furniture/parametric.mjs) so the piece shows at once, in its colours.
const TEMPLATE = { sofa: "sofa", armchair: "armchair", shelf: "shelf", cupboard: "sideboard", tv: "sideboard", desk: "desk",
  chair: "diningChair", bed: "bed", rug: "rug", lamp: "floorLamp" };
function modelFor(category, size, got = {}) {
  const template = category === "table" ? (size[2] > 0.6 ? "diningTable" : "coffeeTable") : TEMPLATE[category];
  const parametric = template ? kitFor({ size, style: { colors: got.colors ?? [] } }, { kit_template: template, material: got.material }) : null;
  return parametric ? { status: "ready", how: "parametric", glb: null, job: null, parametric }
    : { status: "pending", how: null, glb: null, parametric: null, job: null };
}

const idFor = (url) => `agent-${createHash("sha1").update(url).digest("hex").slice(0, 10)}`;
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").replace(/\s*([x×:])\s*/g, "$1").trim();
const near = (a, b) => Math.abs(a - b) <= Math.max(0.05, b * 0.002);
const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const fmt = (m) => `${(Math.round(m * 100) / 100).toFixed(2).replace(/0$/, "")} m`;
const cm = (m) => (m >= 1 ? fmt(m) : `${Math.round(m * 100)} cm`);
const absolute = (src, base) => { try { return src ? new URL(src, base).href : null; } catch { return null; } };
