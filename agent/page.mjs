// Fetch a product page ourselves: checks the link works and gives the text the sizes are read from.
// No model here. Never logs in, never posts; a plain GET like a browser's.

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

// UK shops whose product pages load without a login or a bot wall (checked 2026-11-01; next.co.uk,
// argos, loaf, wayfair, heal's and swyft answer 403/429 to a plain GET, so they're left out).
export const UK_SHOPS = [
  { host: "ikea.com", path: /^\/gb\//, name: "IKEA" },
  { host: "johnlewis.com", name: "John Lewis" },
  { host: "habitat.co.uk", name: "Habitat" },
  { host: "dunelm.com", name: "Dunelm" },
  { host: "made.com", name: "MADE" },
  { host: "sofa.com", name: "sofa.com" },
  { host: "furniturevillage.co.uk", name: "Furniture Village" },
  { host: "marksandspencer.com", name: "M&S" },
];

export function shopFor(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== "https:") return null;
  const host = u.hostname.replace(/^www\./, "");
  return UK_SHOPS.find((s) => (host === s.host || host.endsWith(`.${s.host}`)) && (!s.path || s.path.test(u.pathname))) ?? null;
}

/** GET a page. Returns { ok, status, url, html } — ok only for a 200 HTML page. */
export async function fetchPage(url, { fetch = globalThis.fetch, timeoutMs = 20000 } = {}) {
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "user-agent": UA, "accept-language": "en-GB,en;q=0.9", accept: "text/html,application/xhtml+xml" },
    });
    const type = res.headers.get("content-type") ?? "";
    const html = res.ok && /html/.test(type) ? await res.text() : "";
    return { ok: res.status === 200 && html.length > 0, status: res.status, url: res.url || url, html };
  } catch (e) {
    return { ok: false, status: 0, url, html: "", error: String(e.message ?? e) };
  }
}

const decode = (s) => s
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&times;/g, "×")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));

/** Visible text of a page, whitespace squashed. */
export function pageText(html) {
  return decode(html
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ").trim();
}

/** Title, picture and price from the page's own metadata (og: tags and JSON-LD Product). */
export function pageMeta(html) {
  const meta = (p) => html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${p}["'][^>]*content=["']([^"']+)`, "i"))?.[1]
    ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${p}["']`, "i"))?.[1];
  const out = { title: null, image: meta("og:image") ?? meta("twitter:image"), price: null };
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let j;
    try { j = JSON.parse(m[1]); } catch { continue; }
    const nodes = [j].flat().flatMap((n) => [n, ...(n?.["@graph"] ?? [])]);
    const product = nodes.find((n) => [n?.["@type"]].flat().includes("Product"));
    if (!product) continue;
    out.title ??= typeof product.name === "string" ? product.name : null;
    out.image ??= [product.image].flat()[0]?.url ?? [product.image].flat()[0];
    const offer = [product.offers].flat()[0];
    const price = offer?.price ?? offer?.lowPrice ?? offer?.offers?.[0]?.price;
    if (price != null && !out.price) out.price = money(price, offer?.priceCurrency ?? "GBP");
  }
  out.title ??= meta("og:title") ?? html.match(/<title[^>]*>([^<]+)/i)?.[1];
  // "Buy Habitat Kleo Fabric 2 Seater Sofa - Forest Green | Sofas | Habitat" → the product's own name.
  if (out.title) out.title = decode(out.title).replace(/^buy\s+/i, "").split(/\s+\|\s+/)[0].replace(/\s+-\s+IKEA.*$/, "").trim();
  if (out.image) out.image = decode(out.image);
  return out;
}

const money = (p, cur) => {
  const n = Number(p);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${cur === "GBP" ? "£" : `${cur} `}${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
};

/** The parts of the text that talk about size, so the model reads a few kB, not the whole page. */
export function sizeSnippets(text, max = 6000) {
  const re = /dimension|measurement|width|depth|height|\bW\s?\d|\bD\s?\d|\bH\s?\d|\d\s?(?:cm|mm)\b/gi;
  const spans = [];
  for (const m of text.matchAll(re)) {
    const a = Math.max(0, m.index - 150), b = Math.min(text.length, m.index + 250);
    if (spans.length && a <= spans.at(-1)[1]) spans.at(-1)[1] = b; else spans.push([a, b]);
  }
  let out = "";
  for (const [a, b] of spans) {
    if (out.length > max) break;
    out += `… ${text.slice(a, b)} `;
  }
  return out.slice(0, max);
}
