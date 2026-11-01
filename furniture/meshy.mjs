// Hosted image → textured mesh with Meshy (https://docs.meshy.ai). Used only when MESHY_API_KEY is set.
// Not yet run against the live API (no key on the day it was written): check the response shapes first.
const BASE = "https://api.meshy.ai/openapi/v1/image-to-3d";
const headers = () => ({ authorization: `Bearer ${process.env.MESHY_API_KEY}`, "content-type": "application/json" });

export const meshyAvailable = () => !!process.env.MESHY_API_KEY;

// image: data URL or https URL → GLB bytes. Polls until done (typically 1-3 min).
export async function meshyBuild(image, { timeoutMs = 6 * 60_000, pollMs = 5000 } = {}) {
  const t0 = Date.now();
  const start = await fetch(BASE, { method: "POST", headers: headers(),
    body: JSON.stringify({ image_url: image, should_texture: true, should_remesh: true, target_polycount: 30000 }) });
  if (!start.ok) throw new Error(`meshy start ${start.status}: ${(await start.text()).slice(0, 200)}`);
  const id = (await start.json()).result;
  while (Date.now() - t0 < timeoutMs) {
    await new Promise(r => setTimeout(r, pollMs));
    const r = await fetch(`${BASE}/${id}`, { headers: headers() });
    const task = await r.json();
    if (task.status === "SUCCEEDED") {
      const glb = await fetch(task.model_urls.glb);
      return { bytes: new Uint8Array(await glb.arrayBuffer()), ms: Date.now() - t0, job: id };
    }
    if (task.status === "FAILED" || task.status === "CANCELED") throw new Error(`meshy ${task.status}: ${task.task_error?.message ?? ""}`);
  }
  throw new Error("meshy timed out");
}
