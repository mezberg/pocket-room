// Lane G tests. No network: OpenAI and fetch are fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { room as fixtureRoom } from "../server/fixtures.mjs";
import { bestWall, fitIn, freeSpace } from "./space.mjs";
import { pageMeta, pageText, shopFor, sizeSnippets } from "./page.mjs";
import { categoryOf, checkedSize, find, fitByRules } from "./find.mjs";

// ---- space ------------------------------------------------------------------------------------------

test("west wall is the sofa wall once the old sofa goes", () => {
  const s = bestWall(fixtureRoom(), { replace: "sofa" });
  assert.equal(s.wall, "west");
  const run = s.runs[0];
  // Between the ladder bookshelf (north) and the side table (south).
  assert.ok(Math.abs(run.length - 2.672) < 0.01, `run ${run.length}`);
  assert.equal(run.rot, 90);            // a piece there faces east, into the room
});

test("the old sofa blocks the wall unless it is being replaced", () => {
  const keep = freeSpace(fixtureRoom(), "west");
  assert.ok(keep.runs[0].length < 1, `with the sofa: ${keep.runs[0].length}`);
});

test("fitIn: width against the run, depth against walkway and coffee table", () => {
  const s = bestWall(fixtureRoom(), { replace: "sofa" });
  const run = s.runs[0];
  // lane A's exact export: the dining table stands 0.82 m + a walkway off the west wall
  assert.equal(fitIn(s, run, [2.0, 0.5, 0.8]).verdict, "Fits");
  assert.equal(fitIn(s, run, [2.0, 0.9, 0.8]).verdict, "Just fits");
  assert.equal(fitIn(s, run, [2.0, 0.9, 0.8]).spare_m, 0.672);
  assert.equal(fitIn(s, run, [2.8, 0.9, 0.8]).verdict, "Doesn't fit");     // too wide
  assert.equal(fitIn(s, run, [2.5, 1.5, 0.8]).verdict, "Doesn't fit");     // eats the walkway
  const tight = fitIn(s, run, [2.5, run.depth + 0.1, 0.8]);
  assert.equal(tight.verdict, "Just fits");
});

test("doors keep their swing clear", () => {
  const n = freeSpace(fixtureRoom(), "north");
  // hall door from 2.582 to 3.452 along the north wall: no run may cover it.
  for (const r of n.runs) assert.ok(r.to <= 2.582 || r.from >= 3.452, JSON.stringify(r));
});

// ---- page -------------------------------------------------------------------------------------------

test("only UK shops we can check", () => {
  assert.equal(shopFor("https://www.ikea.com/gb/en/p/x-s123/")?.name, "IKEA");
  assert.equal(shopFor("https://www.ikea.com/us/en/p/x-s123/"), null);
  assert.equal(shopFor("https://www.dunelm.com/product/x-1")?.name, "Dunelm");
  assert.equal(shopFor("https://www.amazon.com/x"), null);
  assert.equal(shopFor("http://www.dunelm.com/product/x-1"), null);
  assert.equal(shopFor("not a url"), null);
});

test("pageMeta reads JSON-LD and og tags", () => {
  const m = pageMeta(pageHtml({ name: "Oslo 3 Seater Sofa", price: 699, image: "//img.example/oslo.jpg", dims: "" }));
  assert.equal(m.title, "Oslo 3 Seater Sofa");
  assert.equal(m.price, "£699");
  assert.equal(m.image, "//img.example/oslo.jpg");
  assert.equal(pageMeta('<meta property="og:title" content="Buy Kleo Sofa - Green | Sofas | Habitat">').title, "Kleo Sofa - Green");
});

test("sizeSnippets keeps the size parts", () => {
  const text = pageText(pageHtml({ name: "A", price: 1, image: "x", dims: "Product Dimensions H 91cm x W 195cm x D 88cm" }));
  assert.match(sizeSnippets(text), /W 195cm/);
});

// ---- checkedSize: never a dimension the page doesn't state -----------------------------------------

const TEXT = "Product Dimensions H 91cm x W 195cm x D 88cm Seat Height: 49cm Box 1: H 53cm x W 196cm";
const dims = (w, d, h) => ({ width: w, depth: d, height: h });

test("checkedSize takes sizes quoted from the page", () => {
  const r = checkedSize(dims({ cm: 195, quote: "W 195cm" }, { cm: 88, quote: "D 88cm" }, { cm: 91, quote: "H 91cm" }), TEXT);
  assert.deepEqual(r, { ok: true, m: [1.95, 0.88, 0.91] });
});

test("checkedSize drops a missing dimension", () => {
  const r = checkedSize(dims({ cm: 195, quote: "W 195cm" }, null, { cm: 91, quote: "H 91cm" }), TEXT);
  assert.equal(r.ok, false);
  assert.match(r.why, /no depth/);
});

test("checkedSize drops a quote that isn't on the page", () => {
  const r = checkedSize(dims({ cm: 200, quote: "W 200cm" }, { cm: 88, quote: "D 88cm" }, { cm: 91, quote: "H 91cm" }), TEXT);
  assert.equal(r.ok, false);
  assert.match(r.why, /not on the page/);
});

test("checkedSize drops a number that isn't in its quote", () => {
  const r = checkedSize(dims({ cm: 210, quote: "W 195cm" }, { cm: 88, quote: "D 88cm" }, { cm: 91, quote: "H 91cm" }), TEXT);
  assert.equal(r.ok, false);
});

test("checkedSize accepts mm on the page", () => {
  const r = checkedSize(dims({ cm: 205, quote: "Width: 2050mm" }, { cm: 90, quote: "Depth: 900mm" }, { cm: 85, quote: "Height: 850mm" }),
    "Width: 2050mm Depth: 900mm Height: 850mm");
  assert.deepEqual(r.m, [2.05, 0.9, 0.85]);
});

test("categoryOf", () => {
  assert.equal(categoryOf("find me a sofa for this wall"), "sofa");
  assert.equal(categoryOf("a small armchair"), "armchair");
  assert.equal(categoryOf("bookcase"), "shelf");
});

// ---- find, end to end with fakes -------------------------------------------------------------------

function pageHtml({ name, price, image, dims, colour = "oatmeal" }) {
  const ld = { "@context": "https://schema.org", "@type": "Product", name, image, offers: { "@type": "Offer", price, priceCurrency: "GBP" } };
  return `<html><head><title>${name} | Shop</title><meta property="og:image" content="${image}">
<script type="application/ld+json">${JSON.stringify(ld)}</script></head>
<body><h1>${name}</h1><p>A ${colour} sofa.</p><h2>Dimensions</h2><p>${dims}</p><script>var x = "W 999cm";</script></body></html>`;
}

// Five shops' pages: three good, one too wide, one with no sizes, one dead link, one not UK.
const PAGES = {
  "https://www.ikea.com/gb/en/p/ekholma-3-seat-sofa-s1/": { name: "EKHOLMA 3-seat sofa", price: 549, image: "https://www.ikea.com/e.jpg", dims: "Depth 85 cm Height 94 cm Seat depth 55 cm Width 207 cm" },
  "https://www.dunelm.com/product/max-3-seater-sofa-1": { name: "Max 3 Seater Sofa", price: 699, image: "https://images.dunelm.com/m.jpg", dims: "Product Dimensions H 86cm x W 204cm x D 92cm" },
  "https://www.johnlewis.com/olivia-sofa/p1": { name: "Olivia Large 3 Seater Sofa", price: 999, image: "https://jl.example/o.jpg", dims: "Dimensions: H82 x W186 x D90cm" },
  "https://www.habitat.co.uk/product/huge": { name: "Huge 4 Seater Sofa", price: 1200, image: "https://h.example/h.jpg", dims: "H85, W290, D95cm" },
  "https://www.sofa.com/sofas/nosize": { name: "Mystery Sofa", price: 900, image: "https://s.example/m.jpg", dims: "Lovely and soft." },
  "https://www.made.com/dead": null,
  "https://www.wayfair.co.uk/nope": { name: "Not checked", price: 1, image: "x", dims: "W 100cm" },
};

const SIZES = {   // what the fake model copies off each page
  "EKHOLMA 3-seat sofa": dims({ cm: 207, quote: "Width 207 cm" }, { cm: 85, quote: "Depth 85 cm" }, { cm: 94, quote: "Height 94 cm" }),
  "Max 3 Seater Sofa": dims({ cm: 204, quote: "W 204cm" }, { cm: 92, quote: "D 92cm" }, { cm: 86, quote: "H 86cm" }),
  "Olivia Large 3 Seater Sofa": dims({ cm: 186, quote: "W186" }, { cm: 90, quote: "D90cm" }, { cm: 82, quote: "H82" }),
  "Huge 4 Seater Sofa": dims({ cm: 290, quote: "W290" }, { cm: 95, quote: "D95cm" }, { cm: 85, quote: "H85" }),
  "Mystery Sofa": dims(null, null, null),
};

function fakeFetch(calls) {
  return async (url) => {
    calls.push(url);
    const p = PAGES[url];
    if (!p) return new Response("gone", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(pageHtml(p), { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  };
}

function fakeOpenAI(calls) {
  const out = (o) => ({ output_text: JSON.stringify(o) });
  return { responses: { create: async (req) => {
    const kind = req.text?.format?.name;
    calls.push({ kind, req });
    if (kind === "products") {
      assert.ok(req.tools?.some((t) => t.type === "web_search"), "search uses the web_search tool");
      return out({ products: Object.keys(PAGES).map((url) => ({ url, name: "x", shop: "x" })) });
    }
    if (kind === "room_style") return out({ tags: ["scandinavian"], colors: ["#f2f0eb"], materials: ["oak"], summary: "bright Scandinavian, light oak floor" });
    if (kind === "product") {
      const user = req.input.find((m) => m.role === "user").content;
      const name = user.match(/Title: (.*)/)[1];
      return out({ is_product: true, category: "sofa", ...SIZES[name], colors: ["#d8cfc0"], material: "fabric", tags: ["modern"] });
    }
    if (kind === "style_judgement") {
      const { candidates } = JSON.parse(req.input.find((m) => m.role === "user").content);
      return out({ judged: candidates.map((c, i) => ({ id: c.id, match: 0.9 - i * 0.1, note: "oatmeal fabric suits your light oak floor" })) });
    }
    throw new Error(`unexpected call ${kind}`);
  } } };
}

test("find: three real-shop pieces that fit, sizes from the page, links checked", async () => {
  const fetched = [], calls = [];
  const out = await find(fixtureRoom(), { query: "find me a sofa for this wall" },
    { openai: fakeOpenAI(calls), models: { text: "test-model" }, fetch: fakeFetch(fetched) });

  assert.equal(out.space.wall, "west");
  assert.equal(out.pieces.length, 3);
  const names = out.pieces.map((p) => p.name).sort();
  assert.deepEqual(names, ["EKHOLMA 3-seat sofa", "Max 3 Seater Sofa", "Olivia Large 3 Seater Sofa"]);
  for (const p of out.pieces) {
    assert.equal(p.source.kind, "agent");
    assert.equal(p.size_source, "product_page");
    assert.equal(p.category, "sofa");
    assert.ok(fetched.includes(p.source.url), "link was fetched");
    assert.ok(shopFor(p.source.url), "UK shop");
    assert.match(p.source.price, /^£/);
    assert.ok(p.source.image?.startsWith("https://"));
    assert.ok(["Fits", "Just fits"].includes(p.agent.fit.verdict));
    assert.match(p.agent.reason, /^\d\.\d+ m wide, (just )?fits the west wall with \d+ cm to spare; .+/);
    assert.equal(p.model.parametric.template, "sofa");
  }
  const ikea = out.pieces.find((p) => p.source.shop === "IKEA");
  assert.deepEqual(ikea.size, [2.07, 0.85, 0.94]);
  // the verdict is lane D's place() on the whole room: the way to the sofa's front is 67 cm, so "just fits"
  const d = fitByRules(fixtureRoom(), [2.07, 0.85, 0.94], { category: "sofa", wall: "west" });
  assert.equal(ikea.agent.fit.verdict, d.verdict);
  assert.deepEqual(ikea.agent.fit.at, d.at);
  assert.equal(ikea.agent.fit.replaces, "sofa");
  assert.equal(ikea.agent.reason, `2.07 m wide, ${d.verdict === "Fits" ? "fits" : "just fits"} the west wall with 60 cm to spare; oatmeal fabric suits your light oak floor`);

  const why = Object.fromEntries(out.rejected.map((r) => [r.url, r.why]));
  assert.match(why["https://www.habitat.co.uk/product/huge"], /doesn't fit/);
  assert.match(why["https://www.sofa.com/sofas/nosize"], /no width stated/);
  assert.match(why["https://www.made.com/dead"], /HTTP 404/);
  assert.match(why["https://www.wayfair.co.uk/nope"], /not one of the UK shops/);
  assert.ok(!fetched.includes("https://www.wayfair.co.uk/nope"), "unknown shops are never fetched");

  // The model only saw the page's size text, and the script's "W 999cm" never reached it.
  const reads = calls.filter((c) => c.kind === "product");
  for (const r of reads) assert.doesNotMatch(JSON.stringify(r.req.input), /999/);
  // Models come from the deps, not hard-coded.
  for (const c of calls) assert.equal(c.req.model, "test-model");
});

test("find: room style from the room JSON skips the Vision read", async () => {
  const calls = [];
  const room = { ...fixtureRoom(), style: { tags: ["mid-century"], colors: ["#3f5e4a"] } };
  await find(room, { query: "sofa", wall: "west" }, { openai: fakeOpenAI(calls), models: { text: "m" }, fetch: fakeFetch([]) });
  assert.ok(!calls.some((c) => c.kind === "room_style"));
  assert.match(calls.find((c) => c.kind === "products").req.input, /mid-century/);
});

test("fitByRules: lane D's verdict, the wall asked for, Doesn't fit for a sofa wider than any wall", () => {
  const ok = fitByRules(fixtureRoom(), [2.0, 0.9, 0.8], { category: "sofa", wall: "west" });
  assert.ok(ok.fits && ok.wall === "west" && ["Fits", "Just fits"].includes(ok.verdict));
  const huge = fitByRules(fixtureRoom(), [7.5, 0.9, 0.8], { category: "sofa", wall: "west" });
  assert.equal(huge.fits, false);
  assert.match(huge.say, /Doesn't fit/);
});

test("search size: a long wall doesn't ask for a 9 m armchair; a short one keeps its range", async () => {
  const { searchSize } = await import("./find.mjs");
  // a sofa stands in front of part of a 10 m wall: depth for the whole run is 0, the open stretch is 5.75 m
  const big = searchSize({ length: 10, depth: 0, open: 5.75 }, "armchair");
  assert.equal(big.maxWidthCm, 120);
  assert.equal(big.minWidthCm, 0);
  const short = searchSize({ length: 2.4, depth: 1.1 }, "sofa");
  assert.deepEqual(short, { minWidthCm: 150, maxWidthCm: 240, maxDepthCm: 125 });
  assert.equal(big.maxDepthCm, 120);
});

test("fitByRules with the designer: a coffee table that only fits once the designer makes room counts as fitting", async () => {
  const { fitByRules } = await import("./find.mjs");
  const room = fixtureRoom();
  const plain = fitByRules(room, [1.4, 0.7, 0.45], { category: "table" });
  const helped = fitByRules(room, [1.4, 0.7, 0.45], { category: "table", designer: true });
  if (!plain.fits) {
    assert.equal(helped.fits, true, "the designer finds room by replacing or moving furniture");
    assert.ok(["place", "replace", "move"].includes(helped.plan));
  } else assert.equal(helped.fits, true);
});

test("fitByRules with replace: only a true replacement counts, never a spot elsewhere", async () => {
  const { fitByRules } = await import("./find.mjs");
  const room = fixtureRoom();
  const small = fitByRules(room, [1.0, 0.55, 0.45], { category: "table", replace: "coffee_table", designer: true });
  if (small.fits) assert.equal(small.replaces, "coffee_table");
  const huge = fitByRules(room, [2.6, 1.2, 0.45], { category: "table", replace: "coffee_table", designer: true });
  assert.equal(huge.fits, false, "too big to stand where the old one is: not offered on a wall instead");
});
