// One OpenAI client for every lane. Models come from .env so a lane can swap one without touching code.
import OpenAI from "openai";
export const openai = new OpenAI();          // reads OPENAI_API_KEY
export const MODELS = {
  text: process.env.OPENAI_MODEL_TEXT,         // vision + reasoning (Responses API)
  decisions: process.env.OPENAI_MODEL_DECISIONS,
  image: process.env.OPENAI_MODEL_IMAGE,
  realtime: process.env.OPENAI_MODEL_REALTIME,
};

// The run log: one line per model call (which API, which model, how long), never the key or the content.
for (const [name, res, method] of [["responses", openai.responses, "create"], ["decisions", openai.decisions, "create"], ["images.generate", openai.images, "generate"], ["images.edit", openai.images, "edit"]]) {
  if (!res?.[method]) continue;
  const orig = res[method].bind(res);
  res[method] = (body, ...rest) => {
    const t0 = Date.now();
    const p = orig(body, ...rest);
    const tools = (body?.tools ?? []).map((t) => t.type).join(",");
    p.then((r) => console.log(`[model] ${new Date().toISOString()} ${name} ${body?.model} ${Date.now() - t0} ms${tools ? ` tools=${tools}` : ""}${r?.usage?.total_tokens ? ` tokens=${r.usage.total_tokens}` : ""}`),
      (e) => console.log(`[model] ${new Date().toISOString()} ${name} ${body?.model} FAILED ${Date.now() - t0} ms: ${String(e?.message ?? e).slice(0, 120)}`));
    return p;
  };
}
