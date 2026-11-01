// The model calls lane G makes. Each takes the OpenAI client so tests can pass a fake one.
// Models only find pages, copy text off them and judge style; every size check is in space.mjs.
import { readFile } from "node:fs/promises";

const json = (name, schema) => ({ format: { type: "json_schema", name, schema, strict: true } });
const parse = (r) => {
  const t = r.output_text ?? "";
  try { return JSON.parse(t); } catch { return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)); }
};

// ---- 1. Web search for product pages in UK shops --------------------------------------------------

const PRODUCTS = {
  type: "object", additionalProperties: false, required: ["products"],
  properties: {
    products: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["url", "name", "shop"],
        properties: { url: { type: "string" }, name: { type: "string" }, shop: { type: "string" } },
      },
    },
  },
};

export async function searchProducts(openai, model, { query, category, minWidthCm, maxWidthCm, maxDepthCm, style, shops, count = 10 }) {
  const r = await openai.responses.create({
    model,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search", user_location: { type: "approximate", country: "GB", city: "London" } }],
    input: [
      `Find ${count} different products for: "${query}" (furniture category: ${category}).`,
      `Each must be at most ${maxWidthCm} cm wide and ${maxDepthCm} cm deep${minWidthCm ? ` (ideally ${minWidthCm}–${maxWidthCm - 20} cm wide)` : ""}, and in stock at one of these UK shops: ${shops.join(", ")}.`,
      style ? `The room is ${style}; prefer pieces that would suit it.` : "",
      `Give the product page URL itself (not a category, search or listing page), the product name and the shop.`,
      `Spread them over at least three shops.`,
    ].filter(Boolean).join("\n"),
    text: json("products", PRODUCTS),
  });
  return parse(r).products ?? [];
}

// ---- 2. Read the sizes off one product page --------------------------------------------------------

const DIM = { anyOf: [{
  type: "object", additionalProperties: false, required: ["cm", "quote"],
  properties: { cm: { type: "number" }, quote: { type: "string" } },
}, { type: "null" }] };
const READ = {
  type: "object", additionalProperties: false,
  required: ["is_product", "category", "width", "depth", "height", "colors", "material", "tags"],
  properties: {
    is_product: { type: "boolean" },
    category: { type: "string" },
    width: DIM, depth: DIM, height: DIM,
    colors: { type: "array", items: { type: "string" } },
    material: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
};

export async function readProductPage(openai, model, { url, title, snippets }) {
  const r = await openai.responses.create({
    model,
    reasoning: { effort: "low" },
    input: [
      { role: "system", content: [
        "You copy furniture sizes off a shop's product page. You never estimate or convert by eye.",
        "For width, depth and height of the assembled product (overall/external size, not seat, package, box or",
        "access dimensions), give the value in cm and `quote`: the shortest exact span of the page text that",
        "states it, copied character for character (e.g. \"W 195cm\" or \"Width 207 cm\"). If mm or m, convert to cm.",
        "If the page does not state a dimension, set it to null. If the page is not a single product, is_product = false.",
        "category: one of sofa, armchair, table, chair, desk, bed, rug, shelf, lamp, cupboard, tv, other.",
        "colors: up to 3 hex colours of the product as described; material: main material; tags: up to 4 style words.",
      ].join(" ") },
      { role: "user", content: `URL: ${url}\nTitle: ${title ?? ""}\nPage text (size parts):\n${snippets}` },
    ],
    text: json("product", READ),
  });
  return parse(r);
}

// ---- 3. The room's style ---------------------------------------------------------------------------

const STYLE = {
  type: "object", additionalProperties: false, required: ["tags", "colors", "materials", "summary"],
  properties: {
    tags: { type: "array", items: { type: "string" } },
    colors: { type: "array", items: { type: "string" } },
    materials: { type: "array", items: { type: "string" } },
    summary: { type: "string" },
  },
};

/** A simple Vision read of a room picture: style words, main colours (hex), materials, one-line summary. */
export async function readRoomStyle(openai, model, imagePath) {
  const b64 = (await readFile(imagePath)).toString("base64");
  const r = await openai.responses.create({
    model,
    reasoning: { effort: "low" },
    input: [{ role: "user", content: [
      { type: "input_text", text: "Describe this room's interior style for choosing new furniture. Look at the finishes and the overall feel (floor, walls, woods, metals, light, accent colours), not at any one piece of furniture, which may be replaced. tags: up to 5 style words; colors: up to 5 main hex colours; materials: up to 4; summary: one short phrase, e.g. \"bright Scandinavian, light oak floor, white walls, green and mustard accents\"." },
      { type: "input_image", image_url: `data:image/jpeg;base64,${b64}`, detail: "low" },
    ] }],
    text: json("room_style", STYLE),
  });
  return parse(r);
}

// ---- 4. Style match and the style half of each reason ---------------------------------------------

const JUDGE = {
  type: "object", additionalProperties: false, required: ["judged"],
  properties: {
    judged: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["id", "match", "note"],
        properties: { id: { type: "string" }, match: { type: "number" }, note: { type: "string" } },
      },
    },
  },
};

/** For each candidate: match 0..1 with the room's style and a short note ("oak legs match your floor"). No sizes. */
export async function judgeStyle(openai, model, { room, replacing, candidates }) {
  const r = await openai.responses.create({
    model,
    reasoning: { effort: "low" },
    input: [
      { role: "system", content: "You are an interior designer. Judge only style and colour, never size. For each candidate give match (0 = clashes, 1 = perfect) with the room, and note: under 10 words on why it suits (or not), naming a concrete detail of the product and of the room, no numbers, no measurements, lower case. Write the note as a reason to choose it (e.g. \"oak legs match your floor\"). The room's current " + (replacing ?? "piece") + " is being replaced: judge against the rest of the room, not against it." },
      { role: "user", content: JSON.stringify({ room, candidates }) },
    ],
    text: json("style_judgement", JUDGE),
  });
  return parse(r).judged ?? [];
}
