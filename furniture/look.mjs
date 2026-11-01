// Astra checks its own work: the app renders a piece's model on its own and sends it here. A vision model
// (OPENAI_MODEL_TEXT) puts the render next to the picture the model was built from (the shop photo, or the crop
// of the room photo) and says whether it reads as the same object. "wrong" comes with what to change, and the
// piece is rebuilt with that (pieces.mjs rebuildPiece), at most MAX_REBUILDS times. "cant_tell" changes nothing.
// Size is code's; the check only judges shape, parts and colour.
export const MAX_REBUILDS = 2;

export const LOOK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["verdict", "issues", "color"],
  properties: {
    verdict: { enum: ["matches", "wrong", "cant_tell"], description: "cant_tell when the picture doesn't show the object well enough to judge" },
    issues: { type: "string", description: "If wrong: what to change, as instructions to a 3D modeller ('add the wall cabinets above the worktop', 'fronts are pale oak, not white'). Else empty." },
    color: { type: ["string", "null"], description: "Its main colour in the picture as #rrggbb if the model's colour is clearly off, else null" },
  },
};

const PROMPT = (name, notes) => `Image 1 is a picture of a ${name} (a shop photo, or a crop of a room photo). Image 2 is our 3D model of it,
rendered on its own from the front-right (a simple clean look made of primitive shapes in plain opaque colours: no textures,
glass, transparency, fabric or fine detail are possible, and the viewing angle may differ from the picture's). Proportions are
fixed by measurement; do not judge size.${notes ? `\nWhat the modeller was asked to build: ${notes}` : ""}
Does the model read as that object: the overall shape, its main parts (doors, drawers, wall units, worktop, cushions,
arms, legs, frame) and its colours? Say "wrong" only for things a person would notice at a glance and the modeller can fix
with shapes and plain colours, with clear fixes.`;

/** → { verdict, issues, color }. picture, view: data URLs. */
export async function compareLook(picture, view, name, notes) {
  const { openai, MODELS } = await import("../server/openai.mjs");
  const res = await openai.responses.create({
    model: MODELS.text,
    reasoning: { effort: "low" },
    input: [{ role: "user", content: [
      { type: "input_text", text: PROMPT(name, notes?.split("\nA check compared")[0]) },
      { type: "input_image", image_url: picture, detail: "high" },
      { type: "input_image", image_url: view, detail: "high" },
    ] }],
    text: { format: { type: "json_schema", name: "look_check", schema: LOOK_SCHEMA, strict: true } },
  });
  return JSON.parse(res.output_text);
}

/** What to do with a verdict: { rebuild: feedback | null, color: hex | null }. */
export function decide(piece, look) {
  const color = look.verdict === "wrong" && /^#[0-9a-f]{6}$/i.test(look.color ?? "") ? look.color.toLowerCase() : null;
  const rebuild = look.verdict === "wrong" && look.issues?.trim() && (piece.rebuilds ?? 0) < MAX_REBUILDS ? look.issues.trim() : null;
  return { rebuild, color };
}
