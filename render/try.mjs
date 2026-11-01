// Try a render from files on disk, with timings. Writes the result next to --out.
//   node --env-file=.env render/try.mjs --view render/samples/inputs/view-living.jpg \
//     [--photo render/samples/inputs/photo.jpg] [--preset evening] [--model gpt-image-2.5-flare] \
//     [--quality medium] [--prompt "..."] --out render/samples/out.jpg
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { openai } from "../server/openai.mjs";
import { renderRoom } from "./render.mjs";
import { renderModel } from "../server/routes/render.mjs";

const { values: a } = parseArgs({ options: {
  view: { type: "string" }, photo: { type: "string" }, preset: { type: "string" }, model: { type: "string" },
  quality: { type: "string" }, prompt: { type: "string" }, out: { type: "string" } } });
const dataURL = (f) => `data:image/${f.endsWith(".png") ? "png" : "jpeg"};base64,${readFileSync(f).toString("base64")}`;

const out = await renderRoom(
  { view: dataURL(a.view), photo: a.photo && dataURL(a.photo), preset: a.preset, prompt: a.prompt, model: a.model, quality: a.quality },
  { client: openai, defaultModel: renderModel() });
writeFileSync(a.out, Buffer.from(out.image.split(",")[1], "base64"));
console.log(JSON.stringify({ out: a.out, model: out.model, quality: a.quality ?? "medium", preset: a.preset ?? "sunday-morning", size: out.size, s: +(out.ms / 1000).toFixed(1) }));
