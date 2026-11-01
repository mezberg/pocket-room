// Vision: photos / video frames of a room -> a "reading" (ratios against known references, relative
// positions). No metres come from the model; build.mjs turns the reading into room.json.
import { REF_KINDS } from "./refs.mjs";

const CATEGORIES = ["sofa", "armchair", "table", "chair", "desk", "bed", "rug", "shelf", "lamp", "plant", "radiator", "cupboard", "tv", "column", "other"];
const num = { type: "number" };
const frac = { type: "number", description: "0..1" };
const measure = {
  type: "object", additionalProperties: false, required: ["ref", "multiples", "note"],
  properties: {
    ref: { type: "string", enum: REF_KINDS },
    multiples: { ...num, description: "How many of this reference fit along the measured span" },
    note: { type: "string", description: "What you compared, in a few words" },
  },
};
const extent = {
  type: "object", additionalProperties: false, required: ["seen_fraction", "measures"],
  properties: {
    seen_fraction: { ...frac, description: "Share of this extent of the whole room that the measures cover (1 = wall to wall)" },
    measures: { type: "array", items: measure, description: "3-5 independent readings of the SEEN span, each against a different reference if you can" },
  },
};

export const READING_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["room_type", "width", "depth", "height", "openings", "objects", "style", "caveats"],
  properties: {
    room_type: { type: "string" },
    width: { ...extent, description: "Left-right across the view, along the far wall" },
    depth: { ...extent, description: "From the camera's wall to the far wall" },
    height: { ...extent, description: "Floor to ceiling (seen_fraction < 1 if the ceiling is out of frame)" },
    openings: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        required: ["kind", "wall", "center", "width", "sill_frac", "head_frac"],
        properties: {
          kind: { type: "string", enum: ["door", "window", "glazed_door", "opening"] },
          wall: { type: "string", enum: ["far", "left", "right", "near"] },
          center: { ...frac, description: "Along the wall: far/near wall from the left as seen; left/right walls from the camera end to the far end" },
          width: measure,
          sill_frac: { type: ["number", "null"], description: "Windows: sill height as a share of the wall height" },
          head_frac: { type: ["number", "null"], description: "Top of the opening as a share of the wall height" },
        },
      },
    },
    objects: {
      type: "array", description: "Big things on the floor (furniture, cabinets, columns). Up to 20.",
      items: {
        type: "object", additionalProperties: false,
        required: ["name", "category", "x", "y", "facing", "length", "count"],
        properties: {
          name: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
          x: { ...frac, description: "Centre, left (0) to right (1) across the room" },
          y: { ...frac, description: "Centre, camera wall (0) to far wall (1)" },
          facing: { type: "string", enum: ["camera", "away", "left", "right"], description: "Which way its front / seat faces" },
          length: { anyOf: [measure, { type: "null" }], description: "Its longest side, if you can compare it" },
          count: { type: "integer", description: "1 unless it is a row of identical things (then one entry for the row's centre)" },
        },
      },
    },
    style: {
      type: "object", additionalProperties: false, required: ["tags", "colors"],
      properties: { tags: { type: "array", items: { type: "string" } }, colors: { type: "array", items: { type: "string", description: "#rrggbb" } } },
    },
    caveats: { type: "array", items: { type: "string" } },
  },
};

export const PROMPT = `You read photos of one room (or frames of a short video) so code can build a simple box model of it.
Do not give metres. Instead measure spans in multiples of the references listed in the schema
(e.g. the far wall is about 9 door widths; the ceiling is 52 brick courses up; a pull-up banner is 0.43 of the wall height
= 1/0.43 banners). Prefer references you can actually see; use people and furniture when nothing else is there.
Treat the first photo's camera as standing at the "near" wall looking at the "far" wall.
If the room continues out of frame, measure what you see and say what share of the whole extent that is (seen_fraction).
List doors, windows and big floor objects with positions as fractions of the room. Keep it to what is visible.`;

/** images: data URLs or https URLs. hint: optional text from the user. Returns the parsed reading. */
export async function readRoom(images, hint) {
  const { openai, MODELS } = await import("../../server/openai.mjs");   // lazy: tests run without a key
  if (!MODELS.text) throw new Error("OPENAI_MODEL_TEXT is not set");
  const content = [{ type: "input_text", text: PROMPT + (hint ? `\nThe user adds: ${hint}` : "") }];
  for (const url of images) content.push({ type: "input_image", image_url: url, detail: "high" });
  const res = await openai.responses.create({
    model: MODELS.text,
    reasoning: { effort: process.env.ROOM_PHOTO_EFFORT || "low" },   // a minute budget: low is ~20 s
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name: "room_reading", schema: READING_SCHEMA, strict: true } },
  });
  return JSON.parse(res.output_text);
}
