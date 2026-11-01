// Records the Pocket Room demo: drives the real app (live models, no mocks) in headless Chrome and saves
// every painted frame (CDP screencast) with its wall-clock time, plus a timeline of steps, captions and
// live waits. compose.mjs turns that into the video (waits sped up and labelled as such).
//
//   PORT=8850 node --env-file=.env server/index.mjs          # in another shell
//   node scripts/demo/record.mjs desktop  <outDir>          # or: phone
//   node scripts/demo/compose.mjs <outDir> docs/demo/pocket-room-demo-desktop.mp4
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const mode = process.argv[2] ?? "desktop";
const out = resolve(process.argv[3] ?? `/tmp/pocket-room-demo-${mode}`);
const base = process.env.DEMO_URL ?? "http://localhost:8850";
const phone = mode === "phone";
const sofaPhoto = resolve("furniture/test-images/chesterfield-2-seat-2026-11-01.jpg");
mkdirSync(join(out, "frames"), { recursive: true });

const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--enable-gpu", "--use-angle=metal", "--hide-scrollbars"] });
const ctx = await browser.newContext(phone
  ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }
  : { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));

// ---- timeline
const t0 = Date.now() / 1000;
const timeline = { mode, viewport: page.viewportSize(), dpr: phone ? 2 : 1, events: [] };
const now = () => Date.now() / 1000;
const mark = (type, extra = {}) => { timeline.events.push({ t: now(), type, ...extra }); console.log(`${(now() - t0).toFixed(1).padStart(6)}s ${type} ${extra.text ?? extra.label ?? ""}`); };
const caption = (text) => mark("caption", { text });
// a live wait on a model: recorded in full, sped up in the cut with its real length on screen
async function live(label, fn) {
  mark("wait-start", { label });
  const s = now();
  try { return await fn(); } finally { mark("wait-end", { label, seconds: +(now() - s).toFixed(1) }); }
}
const hold = (ms) => page.waitForTimeout(ms);

// ---- frames
const cdp = await ctx.newCDPSession(page);
const frames = [];
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  const name = `${String(frames.length).padStart(6, "0")}.jpg`;
  frames.push({ name, t: metadata.timestamp, rx: now() });
  writeFileSync(join(out, "frames", name), Buffer.from(data, "base64"));
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
});
const vp = page.viewportSize();
const W = vp.width * (phone ? 2 : 1), H = vp.height * (phone ? 2 : 1);

// The photo route asks for a fresh image-to-3D build (mode is part of POST /api/pieces): otherwise this
// exact photo matches the library model gpt-6-astra built from it earlier and nothing builds on camera.
await page.route("**/api/pieces", async (route) => {
  const req = route.request();
  if (req.method() !== "POST") return route.continue();
  const body = JSON.parse(req.postData() || "{}");
  await route.continue({ postData: JSON.stringify({ ...body, mode: "image_to_3d" }) });
});

// ---- the flow
const folded = () => page.evaluate(() => document.getElementById("sheet").classList.contains("folded"));
async function tab(name) {   // phone: tapping the current tab folds the sheet, so tap again if it folded
  await page.click(`nav.tabs button[data-tab="${name}"]`);
  await hold(500);
  if (phone && (await folded())) { await page.click(`nav.tabs button[data-tab="${name}"]`); await hold(500); }
}
async function drag(dx, ms) {   // a slow orbit, by mouse/touch drag on the 3D view
  const cx = vp.width / 2, cy = phone ? vp.height * 0.3 : vp.height * 0.45;
  const steps = Math.round(ms / 16);
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(cx + (dx * i) / steps, cy); await hold(16); }
  await page.mouse.up();
}
async function findingsIn() {
  await page.waitForFunction(() => document.querySelectorAll("#findings li").length > 0 && document.getElementById("findings-busy").hidden, null, { timeout: 120_000 });
}
async function tapMarker() {
  const m = page.locator(".tag.marker.bad:visible").first();
  if (await m.count()) await m.click({ force: true });
  else await page.locator("#findings li").first().click();
}
async function foldSheetIfPhone() {   // phone: a tap on the current tab folds the sheet so the room shows
  if (!phone || (await folded())) return;
  const cur = page.locator("nav.tabs button[aria-current=page]");
  if (await cur.count()) await cur.click();
  await hold(500);
}

try {
  await page.goto(`${base}/?room=hoskins-living`);
  await page.evaluate(() => { try { localStorage.clear(); } catch {} });
  await page.goto(`${base}/?room=hoskins-living`);
  await page.waitForSelector(".view.ready", { timeout: 60_000 });
  await page.waitForTimeout(2500);   // first frames, textures
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await hold(300);

  // 1. the room
  mark("start");
  caption("Kate's living room, in 3D, from the estate agent's plan");
  await foldSheetIfPhone();
  await hold(800);
  await drag(phone ? 120 : 260, 2600);
  await hold(1200);

  // 2. check the room
  caption("Check my room: code rules + OpenAI Decisions API");
  await hold(600);
  if (phone) await tab("room");
  await page.click("#btn-check");
  await live("Decisions API", findingsIn);
  await hold(1200);
  caption("Each finding is a pin in the room. Tap one to read it");
  await foldSheetIfPhone();
  await tapMarker();
  await hold(phone ? 4500 : 3500);
  await page.click("#btn-home").catch(() => {});
  await hold(800);

  // 3. add a piece from a photo
  caption("Add piece: a photo of a sofa seen in a shop");
  await tab("add");
  await hold(1000);
  await page.setInputFiles("#in-upload", sofaPhoto);
  caption("OpenAI vision reads the photo: the piece, its size and style");
  await live("vision", () => page.waitForFunction(() => !document.querySelector('[data-screen="verdict"]').hidden && document.getElementById("verdict-chip").textContent.trim(), null, { timeout: 180_000 }));
  caption("Placed to scale on the best wall, replacing the old sofa");
  await hold(2500);
  caption("Verdict computed in code; the Decisions API grades the room with it in");
  await live("Decisions API", findingsIn);
  await hold(3000);
  if (!(await page.locator("#verdict-building").isHidden())) {
    caption("gpt-6-astra builds the real 3D model from the photo");
    await live("image → 3D", () => page.waitForFunction(() => document.getElementById("verdict-building").hidden, null, { timeout: 240_000 }));
  }
  caption("The real 3D model, in the room");
  await page.click("#btn-home").catch(() => {});
  await foldSheetIfPhone();
  await hold(800);
  await drag(phone ? -80 : -180, 2200);
  await hold(1500);

  // 4. find for me
  caption("Find for me: an agent searches UK shops for one that fits");
  await tab("find");
  await hold(900);
  await page.click('#find-chips [data-q="a sofa for this wall"]');
  await live("agent search", () => page.waitForSelector("#find-results:not([hidden]) #find-cards li", { timeout: 240_000 }));
  caption("Three real products, sizes read from each shop's own page");
  await hold(1500);
  if (phone) { await page.locator("#find-cards li").nth(1).scrollIntoViewIfNeeded(); await hold(1500); await page.locator("#find-cards li").first().scrollIntoViewIfNeeded(); }
  await hold(2500);
  caption("Tap one: it's placed in the room with its verdict");
  await page.locator("#find-cards li").first().click();
  await page.waitForFunction(() => !document.querySelector('[data-screen="verdict"]').hidden && document.getElementById("verdict-chip").textContent.trim(), null, { timeout: 60_000 });
  await live("Decisions API", findingsIn);
  await hold(3500);

  // 5. photo view
  caption("Photo view: gpt-image renders this exact view, photoreal");
  await page.click("#btn-home").catch(() => {});
  await tab("room");
  await hold(800);
  await page.click("#btn-photo");
  await live("gpt-image", () => page.waitForFunction(() => { const i = document.getElementById("still"); return !i.hidden && i.complete && i.naturalWidth > 0; }, null, { timeout: 120_000 }));
  await page.evaluate(() => document.getElementById("still").scrollIntoView({ block: "center" }));
  await hold(3000);
  const src = await page.evaluate(() => document.getElementById("still").src);   // the render itself, shown full size in the cut
  const buf = src.startsWith("data:") ? Buffer.from(src.split(",")[1], "base64") : Buffer.from(await (await page.request.get(src)).body());
  writeFileSync(join(out, "photo-view.img"), buf);
  mark("photo-view", { box: await page.locator("#still").boundingBox() });
  mark("end");
} catch (err) {
  mark("error", { text: String(err).slice(0, 300) });
  await page.screenshot({ path: join(out, "error.png") });
  process.exitCode = 1;
} finally {
  await cdp.send("Page.stopScreencast").catch(() => {});
  timeline.frames = frames;
  timeline.errors = errors;
  writeFileSync(join(out, "timeline.json"), JSON.stringify(timeline, null, 1));
  console.log(`${frames.length} frames, ${errors.length} console errors${errors.length ? ":\n  " + errors.join("\n  ") : ""}`);
  await browser.close();
}
