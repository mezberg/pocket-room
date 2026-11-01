// Picture → what's in it, with Responses vision. The model reads and judges; it doesn't measure.
// Sizes: it copies dimension text verbatim (sizes.mjs parses it) and may add an estimate, which the
// piece then labels `vision_estimate`.
import { CATEGORIES } from "./sizes.mjs";
import { TEMPLATES } from "./parametric.mjs";

const nullable = (s) => ({ anyOf: [s, { type: "null" }] });
const str = { type: "string" };

export const READ_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["is_furniture", "category", "name", "style_tags", "colors", "material", "dimension_text", "dimension_where",
    "estimate_m", "price", "shop", "url", "kit_template", "kit_fit", "seats", "arms", "legs", "doors", "round"],
  properties: {
    is_furniture: { type: "boolean" },
    category: { enum: CATEGORIES },
    name: { ...str, description: "Plain words, e.g. 'Mustard boucle armchair'. Use the product name if printed." },
    style_tags: { type: "array", items: str, description: "2-5 style words: chesterfield, mid-century, scandi, boucle..." },
    colors: { type: "array", items: str, description: "Hex colours of the piece itself, main first (1-3)." },
    material: str,
    dimension_text: nullable({ ...str, description: "Dimension text EXACTLY as printed in the picture (tag, caption, page), else null. Never make it up." }),
    dimension_where: nullable({ enum: ["tag", "caption", "product_page"] }),
    estimate_m: nullable({ type: "object", additionalProperties: false, required: ["w", "d", "h"],
      properties: { w: { type: "number" }, d: { type: "number" }, h: { type: "number" } },
      description: "Your rough estimate of width, depth, height in metres when nothing is printed." }),
    price: nullable(str), shop: nullable(str), url: nullable(str),
    kit_template: nullable({ enum: TEMPLATES }),
    kit_fit: { enum: ["good", "rough", "none"], description: "How well the chosen kit template captures this piece's shape." },
    seats: nullable({ type: "integer" }),
    arms: nullable({ enum: ["none", "slim", "wide"] }),
    legs: nullable({ enum: ["block", "metal", "frame", "wood"] }),
    doors: nullable({ type: "integer" }),
    round: nullable({ type: "boolean" }),
  },
};

const PROMPT = (kind, hint) => `You read a picture of furniture for an app that places it in a 3D model of a flat.
The picture is a ${kind === "shop_tag" ? "photo of a piece with its shop tag" : kind === "screenshot" ? "screenshot (social post or shop page)" : "photo"}.
Describe the ONE main piece (the one in focus, or the one the tag/caption is about).
- category: one of ${CATEGORIES.join(", ")} (sideboards, cabinets, dressers, wardrobes → cupboard).
- dimension_text: copy any printed dimensions word for word, units included. If none are printed, null. Do not convert or invent.
- estimate_m: only when nothing is printed; your best guess in metres.
- kit_template: the closest parametric template (chesterfieldLoveseat for any tufted rolled-arm Chesterfield sofa); kit_fit says how close.
- colors: sample the piece, not the background.${hint ? `\nUser hint: ${hint}` : ""}`;

export async function readPicture(image, { kind = "photo", hint } = {}) {
  const { openai, MODELS } = await import("../server/openai.mjs");
  const res = await openai.responses.create({
    model: MODELS.text,
    input: [{ role: "user", content: [{ type: "input_text", text: PROMPT(kind, hint) }, { type: "input_image", image_url: image }] }],
    text: { format: { type: "json_schema", name: "piece_read", strict: true, schema: READ_SCHEMA } },
  });
  return JSON.parse(res.output_text);
}
