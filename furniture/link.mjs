// A pasted product link → piece.json. Reuses lane G's page reading (agent/page.mjs, agent/models.mjs):
// a plain GET of the page, name / picture / price from its metadata, and the stated width, depth and height
// copied with their exact quote and checked against the page text. No stated size, no piece: we never
// invent dimensions.
import { fetchPage, pageMeta, pageText, sizeSnippets } from "../agent/page.mjs";
import { readProductPage } from "../agent/models.mjs";
import { checkedSize } from "../agent/find.mjs";
import { templateFor } from "./parametric.mjs";
import { CATEGORIES } from "./sizes.mjs";

const fail = (status, message) => Object.assign(new Error(message), { status });

// Only public web pages: no localhost, private ranges or plain http.
export function publicUrl(raw) {
  let u;
  try { u = new URL(String(raw ?? "").trim()); } catch { throw fail(400, "That doesn't look like a link. Paste the product page's address."); }
  if (u.protocol !== "https:") throw fail(400, "Paste an https:// product link.");
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/.test(h))
    throw fail(400, "That link isn't a public shop page.");
  return u.href;
}

// The product picture as a data URL (so the image-to-3D model doesn't have to fetch a shop's CDN).
async function pictureData(url, { fetch = globalThis.fetch } = {}) {
  if (!url) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { "user-agent": "Mozilla/5.0", accept: "image/jpeg,image/png;q=0.9,image/webp;q=0.8" } });
    const type = (res.headers.get("content-type") ?? "").split(";")[0];
    if (!res.ok || !/^image\/(jpeg|png|webp|gif)$/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > 8e6) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch { return null; }
}

/**
 * @returns { facts (piece without id/model), image (data URL or null), kitRead }
 * @throws 400 bad link, 422 page unreadable / no stated size, 502 page down
 */
export async function readLink(raw, { openai, models, fetch = globalThis.fetch } = {}) {
  const url = publicUrl(raw);
  const t0 = Date.now();
  const page = await fetchPage(url, { fetch });
  if (!page.ok) throw fail(502, page.status ? `The shop's page didn't open (HTTP ${page.status}). Some shops block apps; try a screenshot instead.` : "The shop's page didn't open. Check the link, or try a screenshot.");
  const text = pageText(page.html), meta = pageMeta(page.html);
  const got = await readProductPage(openai, models.text, { url: page.url, title: meta.title, snippets: sizeSnippets(text) });
  if (!got.is_product) throw fail(422, "That page isn't a single product. Open the product itself and paste its link.");
  const size = checkedSize(got, text);
  if (!size.ok) throw fail(422, `The page doesn't state the full size (${size.why}), and we never guess it. Try a screenshot of the size panel instead.`);
  const category = CATEGORIES.includes(got.category) ? got.category : "other";
  const absolute = (src) => { try { return src ? new URL(src, page.url).href : null; } catch { return null; } };
  const imageUrl = absolute(meta.image);
  const facts = {
    category,
    name: meta.title ?? "Product from the link",
    size: size.m,
    size_source: "product_page",
    size_text: [got.width.quote, got.depth.quote, got.height.quote].join(" · "),
    style: { tags: got.tags ?? [], colors: got.colors ?? [], material: got.material ?? undefined },
    source: { kind: "link", url: page.url, image: imageUrl, price: meta.price ?? null, shop: new URL(page.url).hostname.replace(/^www\./, "") },
    timing: { read_ms: Date.now() - t0 },
  };
  const image = await pictureData(imageUrl, { fetch });
  return { facts, image, kitRead: { kit_template: templateFor(category, size.m), material: got.material } };
}
