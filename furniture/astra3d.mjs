// Image → 3D through the OpenAI API. gpt-6-astra has no mesh output (text only: docs list Responses,
// Chat, Batch), but it rebuilds objects by writing geometry. We ask it for a parts list of primitives;
// glb.mjs turns that into a mesh and normalise() fits it to the computed size. The model shapes; code sizes.
import { partsToDocument } from "./glb.mjs";

export const model3d = () => process.env.OPENAI_MODEL_3D;   // e.g. gpt-6-astra

const PART = {
  type: "object", additionalProperties: false,
  required: ["name", "shape", "size", "pos", "rot", "color", "radius"],
  properties: {
    name: { type: "string" },
    shape: { enum: ["box", "rounded_box", "cylinder", "sphere"] },
    size: { type: "array", items: { type: "number" }, description: "[x, y, z] extents in metres; cylinder: [diameter, height, diameter]" },
    pos: { type: "array", items: { type: "number" }, description: "centre [x, y, z] in metres" },
    rot: { type: "array", items: { type: "number" }, description: "Euler XYZ degrees" },
    color: { type: "string", description: "#rrggbb" },
    radius: { type: "number", description: "edge radius for rounded_box, else 0" },
  },
};
const SCHEMA = { type: "object", additionalProperties: false, required: ["parts"], properties: { parts: { type: "array", items: PART } } };

const PROMPT = ({ name, size }, notes) => `Rebuild the ${name} in this picture as a 3D model made of primitives, as a CAD modeller would.${notes ? `\n${notes}` : ""}
Overall size: width ${size[0]} m (x), height ${size[2]} m (y), depth ${size[1]} m (z).
Frame: y up, floor at y = 0, the front of the piece faces +z, centred on x = 0, z = 0.
Use 15-60 parts. Get the silhouette and proportions right first (base, seat, back, arms, legs, doors, top),
then a few details that make it recognisable (cushion seams, tufting buttons, handles, slats, tapered legs).
Colours sampled from the photo; use slightly different shades for parts that meet, so edges read.
Only the piece: no floor, wall, tag, props or people.`;

// → { doc, parts, ms, usage }
// notes: extra text for the modeller (which object in a room photo, what it looks like, what a check said was wrong)
export async function astraBuild(image, piece, { effort = "low", notes } = {}) {
  const t0 = Date.now();
  const { openai } = await import("../server/openai.mjs");   // lazy: tests and keyless runs never build a client
  const res = await openai.responses.create({
    model: model3d(),
    reasoning: { effort },
    input: [{ role: "user", content: [{ type: "input_text", text: PROMPT(piece, notes) }, { type: "input_image", image_url: image }] }],
    text: { format: { type: "json_schema", name: "parts", strict: true, schema: SCHEMA } },
  });
  const parts = cleanParts(JSON.parse(res.output_text).parts);
  if (parts.length < 3) throw new Error(`astra returned ${parts.length} usable parts`);
  return { doc: partsToDocument(parts), parts, ms: Date.now() - t0, usage: res.usage };
}

// Drop malformed parts; pad short vectors. Sizes are rescaled later, so only sanity matters here.
export function cleanParts(parts = []) {
  const vec = (v, n, fill) => Array.from({ length: n }, (_, i) => (Number.isFinite(v?.[i]) ? v[i] : fill));
  return parts
    .map(p => ({ ...p, size: vec(p.size, 3, NaN), pos: vec(p.pos, 3, 0), rot: vec(p.rot, 3, 0) }))
    .filter(p => p.size.every(v => v > 0.001 && v < 10) && p.pos.every(v => Math.abs(v) < 10));
}
