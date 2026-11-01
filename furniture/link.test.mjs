// A pasted product link → piece facts. No network: fetch and OpenAI are fakes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readLink, publicUrl } from "./link.mjs";

const page = (dims) => `<html><head><title>Arvid sideboard | Shop</title>
<meta property="og:image" content="https://img.example/arvid.jpg">
<script type="application/ld+json">${JSON.stringify({ "@type": "Product", name: "Arvid oak sideboard", offers: { price: 449, priceCurrency: "GBP" } })}</script>
</head><body><h2>Dimensions</h2><p>${dims}</p></body></html>`;

const fakeFetch = (html) => async (url) => /img\.example/.test(url)
  ? new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200, headers: { "content-type": "image/jpeg" } })
  : new Response(html, { status: 200, headers: { "content-type": "text/html" } });
const fakeOpenAI = (read) => ({ responses: { create: async () => ({ output_text: JSON.stringify(read) }) } });
const READ = { is_product: true, category: "cupboard", colors: ["#c8a27a"], material: "oak", tags: ["scandi"],
  width: { cm: 160, quote: "W 160cm" }, depth: { cm: 45, quote: "D 45cm" }, height: { cm: 70, quote: "H 70cm" } };

test("a product page with its stated size becomes a piece", async () => {
  const { facts, image, kitRead } = await readLink("https://shop.example/p/arvid", {
    openai: fakeOpenAI(READ), models: { text: "m" }, fetch: fakeFetch(page("W 160cm x D 45cm x H 70cm")) });
  assert.deepEqual(facts.size, [1.6, 0.45, 0.7]);
  assert.equal(facts.size_source, "product_page");
  assert.equal(facts.name, "Arvid oak sideboard");
  assert.equal(facts.source.kind, "link");
  assert.equal(facts.source.price, "£449");
  assert.equal(facts.source.image, "https://img.example/arvid.jpg");
  assert.match(image, /^data:image\/jpeg;base64,/);
  assert.equal(kitRead.kit_template, "sideboard");
});

test("no stated depth: no piece (never a guessed size)", async () => {
  await assert.rejects(readLink("https://shop.example/p/arvid", {
    openai: fakeOpenAI({ ...READ, depth: null }), models: { text: "m" }, fetch: fakeFetch(page("W 160cm x H 70cm")) }),
  (e) => e.status === 422 && /never guess/.test(e.message));
});

test("a size the model made up (not on the page) is refused", async () => {
  await assert.rejects(readLink("https://shop.example/p/arvid", {
    openai: fakeOpenAI(READ), models: { text: "m" }, fetch: fakeFetch(page("Lovely oak, made in Denmark")) }), (e) => e.status === 422);
});

test("only public https links", () => {
  for (const bad of ["not a link", "http://shop.example/p", "https://localhost/x", "https://127.0.0.1/x", "https://192.168.1.2/x"])
    assert.throws(() => publicUrl(bad), (e) => e.status === 400, bad);
  assert.equal(publicUrl(" https://www.ikea.com/gb/en/p/x/ "), "https://www.ikea.com/gb/en/p/x/");
});
