// Lane F. POST /api/render { roomId, view, photo?, prompt?, preset? } → { image, model, ms, size }.
// See render/README.md for presets, models and timings.
import { Router } from "express";
import { fileURLToPath } from "node:url";
import { renderRoom } from "../../render/render.mjs";

// The render model: OPENAI_MODEL_RENDER if set, else the shared image model.
export const renderModel = () => process.env.OPENAI_MODEL_RENDER || process.env.OPENAI_MODEL_IMAGE;

export function renderRouter(getClient = async () => (await import("../openai.mjs")).openai) {
  const r = Router();
  // Test bench: the flat with a piece swapped in, and a Render button (render/view.html).
  r.get("/view", (req, res) => res.sendFile(fileURLToPath(new URL("../../render/view.html", import.meta.url)), { dotfiles: "allow" }));
  r.post("/", async (req, res, next) => {
    try {
      const { view, photo, prompt, preset, quality } = req.body ?? {};
      if (!view) return res.status(400).json({ error: "view (a data URL of the 3D view) is required" });
      const out = await renderRoom({ view, photo, prompt, preset, quality },
        { client: await getClient(), defaultModel: renderModel() });
      res.json(out);
    } catch (err) {
      if (err.status === 400) return res.status(400).json({ error: err.message });
      next(err);
    }
  });
  return r;
}

export default renderRouter();
