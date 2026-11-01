// Lane F. A screenshot of the 3D view (+ an optional real photo) → a photoreal picture of the same room.
// One gpt-image edit. The view is the first image, so it sets the framing; the photo only lends materials.
import { toFile } from "openai";

// Light presets. Each one only changes light and mood, never the layout.
export const PRESETS = {
  "sunday-morning": "Sunday morning, about 9 am. Soft low sunlight comes in through the windows and glazed doors, " +
    "warm patches of light and long soft shadows on the floor, a calm lived-in feel: a folded throw, a mug on the table.",
  "evening": "Evening, lamps on. It is dark outside, the windows show deep blue dusk. The room is lit by its own " +
    "lamps and pendants: warm 2700K pools of light, soft falloff, gentle shadows, cosy.",
  "daylight": "Overcast daylight, even and neutral, like an estate-agent photo.",
};
export const DEFAULT_PRESET = "sunday-morning";

const BASE = `Turn the first image, a screenshot of a 3D model of a real flat, into a photograph of that same room.

Keep exactly:
- the camera: same viewpoint, lens, framing and horizon;
- the room: every wall, window, door, floor and ceiling where it is;
- every piece of furniture: same position, size, orientation and colour as in the screenshot. Do not add,
  remove, move or resize furniture. The proportions in the screenshot are measured and correct.

Make it real: true-to-life materials (wood grain, fabric weave, leather, painted plaster), physically correct
light, contact shadows, ambient occlusion, slight lens falloff. Shot on a full-frame camera, 24 mm, f/5.6,
natural colour, interior photography. No people, no text, no watermark, no 3D-render look.`;

const PHOTO = `The second image is a real photo for reference only: use it for the true look of materials, colours
and textures (for example the exact upholstery of a sofa that appears in both). Never copy its layout, its
camera angle, its background or any people in it.`;

export function buildPrompt({ preset = DEFAULT_PRESET, prompt, photo } = {}) {
  const light = PRESETS[preset] ?? preset;      // a preset name, or free text
  return [BASE, photo ? PHOTO : null, `Light and mood: ${light}`, prompt ? `Also: ${prompt}` : null]
    .filter(Boolean).join("\n\n");
}

// "data:image/png;base64,..." → { mime, buf }
export function parseDataURL(url) {
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/s.exec(url ?? "");
  if (!m) throw Object.assign(new Error("expected an image data URL (png, jpeg or webp)"), { status: 400 });
  return { mime: m[1].replace("jpg", "jpeg"), buf: Buffer.from(m[2], "base64") };
}

// Width and height from the PNG / JPEG / WebP header. null if unknown.
export function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    for (let i = 2; i + 9 < buf.length;) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1], len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X") return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
    if (kind === "VP8 ") return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
    if (kind === "VP8L") { const b = buf.readUInt32LE(21); return [1 + (b & 0x3fff), 1 + ((b >> 14) & 0x3fff)]; }
  }
  return null;
}

// Output size with the view's aspect: long edge `long`, both sides multiples of 16, ratio clamped to 1:3–3:1.
export function outputSize(dims, long = 1536) {
  if (!dims) return "1536x1024";
  const ratio = Math.min(3, Math.max(1 / 3, dims[0] / dims[1]));
  const r16 = (v) => Math.max(16, Math.round(v / 16) * 16);
  return ratio >= 1 ? `${r16(long)}x${r16(long / ratio)}` : `${r16(long * ratio)}x${r16(long)}`;
}

/**
 * view: data URL (required). photo: data URL. prompt: extra words. preset: a PRESETS key or free text.
 * model / quality override the defaults. client: an OpenAI client (tests pass a fake one).
 * Returns { image: dataURL, model, ms, size }.
 */
export async function renderRoom({ view, photo, prompt, preset, model, quality } = {}, { client, defaultModel } = {}) {
  const v = parseDataURL(view);
  const images = [await toFile(v.buf, `view.${v.mime.split("/")[1]}`, { type: v.mime })];
  if (photo) {
    const p = parseDataURL(photo);
    images.push(await toFile(p.buf, `photo.${p.mime.split("/")[1]}`, { type: p.mime }));
  }
  const size = outputSize(imageSize(v.buf));
  const params = {
    model: model || defaultModel,
    image: images,
    prompt: buildPrompt({ preset, prompt, photo }),
    size,
    quality: quality || process.env.RENDER_QUALITY || "medium",
    output_format: "jpeg",
    output_compression: 88,
    n: 1,
  };
  const t0 = Date.now();
  const res = await client.images.edit(params);
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image returned no image");
  return { image: `data:image/jpeg;base64,${b64}`, model: params.model, ms: Date.now() - t0, size };
}
