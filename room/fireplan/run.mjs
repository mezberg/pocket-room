// Runs the floorplan recognition pipeline (Python, outside this repo) on one plan image.
// Its stage 1 is one VLM recolour call through the pipeline's own OpenRouter key (its .env); stages 2-3 are local.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export const PIPELINE = process.env.FLOORPLAN_PIPELINE || join(homedir(), "Desktop/Coding projects/floorplan recognition pipeline");

/** dataURL -> a file in the temp folder, named by content so a re-sent plan reuses the pipeline's cache. */
export function savePlan(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/s.exec(dataUrl || "");
  if (!m) throw Object.assign(new Error("image: a png, jpeg or webp data URL"), { status: 400 });
  const buf = Buffer.from(m[2], "base64");
  const dir = join(tmpdir(), "pocket-room-plans");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${createHash("sha1").update(buf).digest("hex").slice(0, 16)}.${m[1] === "jpeg" ? "jpg" : m[1]}`);
  if (!existsSync(file)) writeFileSync(file, buf);
  return file;
}

/** Image path -> { graph, rings } (the pipeline's _unified_graph.json and _unified_rooms.json). */
export function runPipeline(file, { timeoutMs = 150_000 } = {}) {
  const base = file.replace(/\.[^.]+$/, "");
  const out = { graph: `${base}_unified_graph.json`, rings: `${base}_unified_rooms.json` };
  const read = () => ({ graph: JSON.parse(readFileSync(out.graph)), rings: JSON.parse(readFileSync(out.rings)) });
  if (existsSync(out.graph) && existsSync(out.rings)) return Promise.resolve(read());
  if (!existsSync(join(PIPELINE, "run_pipeline.py"))) return Promise.reject(new Error(`floorplan pipeline not found at ${PIPELINE} (set FLOORPLAN_PIPELINE)`));
  return new Promise((resolve, reject) => {
    const venv = join(PIPELINE, "venv/bin/python");          // the pipeline's own deps (opencv-contrib)
    const python = process.env.FLOORPLAN_PYTHON || (existsSync(venv) ? venv : "python3");
    const p = spawn(python, ["run_pipeline.py", file], { cwd: PIPELINE });
    let log = "";
    p.stdout.on("data", (d) => (log += d));
    p.stderr.on("data", (d) => (log += d));
    const timer = setTimeout(() => { p.kill(); reject(new Error(`floorplan pipeline timed out after ${timeoutMs / 1000} s`)); }, timeoutMs);
    p.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0 && existsSync(out.graph)) resolve(read());
      else reject(new Error(`floorplan pipeline failed (${code}): ${log.slice(-400)}`));
    });
  });
}
