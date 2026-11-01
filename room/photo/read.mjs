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
const reading = {
  type: "object", additionalProperties: false, required: ["photo", "span_fraction", "ref", "multiples", "note"],
  properties: {
    photo: { type: "integer", description: "Which photo this reading is from, 1-based" },
    span_fraction: { ...frac, description: "Share of the room's whole extent that this measured span covers (1 = wall to wall)" },
    ...measure.properties,
  },
};
const extent = {
  type: "object", additionalProperties: false, required: ["seen_fraction", "measures"],
  properties: {
    seen_fraction: { ...frac, description: "Largest share of this extent of the whole room that any one photo shows (1 = wall to wall)" },
    measures: { type: "array", items: reading, description: "3-5 independent readings, each against a different reference if you can (with several photos: from each photo that shows this extent). Never empty." },
  },
};

export const READING_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["room_type", "width", "depth", "height", "seen", "openings", "objects", "style", "caveats"],
  properties: {
    room_type: { type: "string" },
    width: { ...extent, description: "Left-right across the view, along the far wall" },
    depth: { ...extent, description: "From the camera's wall to the far wall" },
    height: { ...extent, description: "Floor to ceiling (seen_fraction < 1 if the ceiling is out of frame)" },
    seen: {
      type: "object", additionalProperties: false, required: ["floor", "walls"],
      description: "What the photos together actually show. Code greys out the rest of the room instead of making it up.",
      properties: {
        floor: {
          type: "object", additionalProperties: false, required: ["left", "right", "near", "far"],
          description: "The part of the floor in view, as fractions of the room: left/right across (0 = left wall, 1 = right wall), near/far from the camera wall (0) to the far wall (1)",
          properties: { left: frac, right: frac, near: frac, far: frac },
        },
        walls: {
          type: "array", description: "Each stretch of wall in view. Several entries for one wall are fine; leave out walls nobody saw (usually the near wall behind photo 1)",
          items: {
            type: "object", additionalProperties: false, required: ["wall", "from", "to"],
            properties: {
              wall: { type: "string", enum: ["far", "left", "right", "near"] },
              from: { ...frac, description: "Start of the seen stretch, same convention as an opening's center" },
              to: { ...frac, description: "End of the seen stretch" },
            },
          },
        },
      },
    },
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
        required: ["name", "category", "x", "y", "facing", "length", "depth", "height", "color", "count"],
        properties: {
          name: { type: "string" },
          category: { type: "string", enum: CATEGORIES },
          x: { ...frac, description: "Centre, left (0) to right (1) across the room" },
          y: { ...frac, description: "Centre, camera wall (0) to far wall (1)" },
          facing: { type: "string", enum: ["camera", "away", "left", "right"], description: "Which way its front / seat faces" },
          length: { anyOf: [measure, { type: "null" }], description: "Its longest side, if you can compare it" },
          depth: { anyOf: [measure, { type: "null" }], description: "Front to back, if you can compare it" },
          height: { anyOf: [measure, { type: "null" }], description: "Floor to its top (a low TV unit, a coffee table, a kitchen worktop), if you can compare it" },
          color: { type: ["string", "null"], description: "Its main colour as #rrggbb, sampled from the photo (the upholstery, the cabinet fronts)" },
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
Always give readings for width, depth AND height, even rough ones: depth runs along the floor, so read it against
things standing in a row towards the far wall (tables, chairs, sofas, floor tiles, people), and height against a person,
a door or a banner even when the ceiling is out of frame (then the span is the part you see).
Say which part of the floor and which stretches of each wall are actually in view (seen); be strict: a wall
that runs out of frame is seen only as far as the frame shows it.
List doors, windows and big floor objects with positions as fractions of the room, with their main colour
and, for cupboards, units and tables, their height (low TV units and coffee tables are often under half a metre).
Each reference means exactly what it names: table_height is a dining table or desk (74 cm), never a coffee table;
chair_width is a dining chair seat. Keep it to what is visible.`;

// Added when there are several photos: they go round the room from corner to corner.
export const MULTI = (n) => `
There are ${n} photos of the same room, taken from its corners and going round it clockwise
(photo 1 from a corner of the near wall). Combine them into one room in photo 1's frame: width runs along
the far wall as seen in photo 1, depth from the near wall to the far wall. Corner photos often show two walls
end to end: measure those wall to wall (span_fraction 1). Give readings from each photo that shows an extent
and say which photo each came from, so code can compare the photos. List each door, window and object once.`;

/** images: data URLs or https URLs. hint: optional text from the user. Returns the parsed reading. */
export async function readRoom(images, hint) {
  const { openai, MODELS } = await import("../../server/openai.mjs");   // lazy: tests run without a key
  if (!MODELS.text) throw new Error("OPENAI_MODEL_TEXT is not set");
  const text = PROMPT + (images.length > 1 ? MULTI(images.length) : "") + (hint ? `\nThe user adds: ${hint}` : "");
  const content = [{ type: "input_text", text }];
  images.forEach((url, i) => {
    if (images.length > 1) content.push({ type: "input_text", text: `Photo ${i + 1}:` });
    content.push({ type: "input_image", image_url: url, detail: "high" });
  });
  const res = await openai.responses.create({
    model: MODELS.text,
    reasoning: { effort: process.env.ROOM_PHOTO_EFFORT || "low" },   // a minute budget: low is ~20 s
    input: [{ role: "user", content }],
    text: { format: { type: "json_schema", name: "room_reading", schema: READING_SCHEMA, strict: true } },
  });
  return JSON.parse(res.output_text);
}
