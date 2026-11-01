// Live run against the fixture room: node --env-file=.env agent/run.mjs "find me a sofa for this wall" [wall]
import { openai, MODELS } from "../server/openai.mjs";
import { room } from "../server/fixtures.mjs";
import { find } from "./find.mjs";

const [query = "find me a sofa for this wall", wall] = process.argv.slice(2);
const t0 = Date.now();
const out = await find(room(), { query, wall }, { openai, models: MODELS, log: (m) => console.error(`  ${m}`) });
console.error(`  ${((Date.now() - t0) / 1000).toFixed(0)} s, style: ${out.style?.summary}`);
console.log(JSON.stringify(out, null, 2));
