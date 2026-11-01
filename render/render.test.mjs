// Lane F tests. No network: the OpenAI client is a fake that records the call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import { renderRoom, buildPrompt, imageSize, outputSize, parseDataURL, PRESETS } from "./render.mjs";
import { renderRouter } from "../server/routes/render.mjs";

const jpeg = readFileSync(new URL("./samples/inputs/view-chesterfield.jpg", import.meta.url));
const photo = readFileSync(new URL("./samples/inputs/photo-chesterfield.jpg", import.meta.url));
const VIEW = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
const PHOTO = `data:image/jpeg;base64,${photo.toString("base64")}`;
const OUT = Buffer.from("fake jpeg").toString("base64");

function fakeClient() {
  const calls = [];
  return { calls, images: { edit: async (params) => { calls.push(params); return { data: [{ b64_json: OUT }] }; } } };
}

test("image size from headers, output size keeps the view's aspect", () => {
  assert.deepEqual(imageSize(jpeg), [1536, 1152]);
  const png = Buffer.alloc(32); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(800, 16); png.writeUInt32BE(1200, 20);
  assert.deepEqual(imageSize(png), [800, 1200]);
  assert.equal(outputSize([1536, 1152]), "1536x1152");
  assert.equal(outputSize([1920, 1080]), "1536x864");
  assert.equal(outputSize([800, 1200]), "1024x1536");
  assert.equal(outputSize([5000, 100]), "1536x512");      // clamped to 3:1
  assert.equal(outputSize(null), "1536x1024");
});

test("prompt: keeps the layout, adds the photo and the light", () => {
  const p = buildPrompt({ preset: "evening", photo: true, prompt: "a cat on the sofa" });
  assert.match(p, /Do not add,\s+remove, move or resize furniture/);
  assert.match(p, /second image is a real photo/);
  assert.ok(p.includes(PRESETS.evening));
  assert.match(p, /a cat on the sofa/);
  assert.doesNotMatch(buildPrompt({}), /second image/);
  assert.ok(buildPrompt({}).includes(PRESETS["sunday-morning"]));
  assert.match(buildPrompt({ preset: "rainy afternoon" }), /rainy afternoon/);
});

test("renderRoom sends the view first, then the photo, and returns a data URL", async () => {
  const client = fakeClient();
  const out = await renderRoom({ view: VIEW, photo: PHOTO, preset: "evening" }, { client, defaultModel: "img-model" });
  assert.equal(out.image, `data:image/jpeg;base64,${OUT}`);
  assert.equal(out.model, "img-model");
  const [call] = client.calls;
  assert.equal(call.model, "img-model");
  assert.equal(call.size, "1536x1152");
  assert.equal(call.output_format, "jpeg");
  assert.equal(call.image.length, 2);
  assert.equal(call.image[0].name, "view.jpeg");
  assert.equal(call.image[1].name, "photo.jpeg");
  assert.equal((await call.image[0].arrayBuffer()).byteLength, jpeg.length);
});

test("bad input is a 400", () => {
  assert.throws(() => parseDataURL("hello"), (e) => e.status === 400);
});

test("POST /api/render, end to end with a mocked client", async () => {
  const client = fakeClient();
  process.env.OPENAI_MODEL_RENDER = "render-model";
  const app = express().use(express.json({ limit: "25mb" })).use("/api/render", renderRouter(async () => client));
  const server = app.listen(0);
  const url = `http://localhost:${server.address().port}/api/render`;
  try {
    const post = (body) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const ok = await post({ roomId: "hoskins-living", view: VIEW, prompt: "Sunday morning" });
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.image, `data:image/jpeg;base64,${OUT}`);
    assert.equal(body.model, "render-model");
    assert.equal(client.calls[0].image.length, 1);
    assert.equal((await post({ roomId: "hoskins-living" })).status, 400);
    assert.equal((await post({ view: "not an image" })).status, 400);
  } finally {
    server.close();
    delete process.env.OPENAI_MODEL_RENDER;
  }
});
