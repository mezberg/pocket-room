// Records the Pocket Room demo: drives the real app (live models, no mocks) in headless Chrome and saves
// every painted frame (CDP screencast) with its wall-clock time, plus a timeline of steps, captions and
// live waits. compose.mjs turns that into the video (waits sped up and labelled as such).
//
//   PORT=8850 node --env-file=.env server/index.mjs          # in another shell
//   node scripts/demo/record.mjs desktop <outDir>           # the main flow
//   node scripts/demo/record.mjs phone <outDir>             # the closing scene: in IKEA, phone camera
//   then compose.mjs / assemble.mjs (scripts/demo/README.md)
import { chromium } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const mode = process.argv[2] ?? "desktop";
const out = resolve(process.argv[3] ?? `/tmp/pocket-room-demo-${mode}`);
const base = process.env.DEMO_URL ?? "http://localhost:8850";
const phone = mode === "phone";
const sofaPhoto = resolve("furniture/test-images/chesterfield-2-seat-2026-11-01.jpg");
const shopPhoto = resolve("scripts/demo/ikea-side-table.jpg");   // the IKEA aisle photo, framed on the side table
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
const verdictIn = () => page.waitForFunction(() => !document.querySelector('[data-screen="verdict"]').hidden && document.getElementById("verdict-chip").textContent.trim(), null, { timeout: 180_000 });
const findingIndex = (ids) => page.evaluate((ids) => window.pocketRoom.state.findings.findIndex((f) => !f.pass && ids.includes(f.id) && /\bMove\b/.test(f.say)), ids);
// tap finding i, wait for its fixes (the Decisions pick comes selected), Apply, wait for the room to be checked again
async function applyFix(i, { look = 0 } = {}) {
  await page.locator("#findings li").nth(i).click();
  await page.waitForSelector('.fix [data-act="apply"]:not([disabled]), .fix .fix-none', { timeout: 60_000 });
  if (!(await page.locator('.fix [data-act="apply"]:not([disabled])').count())) { await page.click(".fix .fix-none ~ .row button"); return false; }
  await hold(look);
  await page.click('.fix [data-act="apply"]');
  await page.waitForFunction(() => window.pocketRoom.state.findings.length > 0 && document.getElementById("findings-busy").hidden, null, { timeout: 120_000 });
  return true;
}
// Off camera: check the room and clear the leather bag from the balcony walkway with the app's own
// Check → Fix → Apply (three walkway findings, one small fix), so the check on camera shows what matters.
async function tidyRoom() {
  await tab("room");
  await page.click("#btn-check");
  await findingsIn();
  const i = await page.evaluate(() => window.pocketRoom.state.findings.findIndex((f) => !f.pass && f.id === "walkway_tight" && /leather bag/.test(f.say)));
  if (i >= 0) console.log("tidy leather bag:", (await applyFix(i)) ? "applied" : "no fix");
  await page.waitForSelector("#toast", { state: "hidden", timeout: 15_000 }).catch(() => {});
  // start the film from a room with no pins up and nothing marked "Fixed" (the fixed room itself stays)
  await page.evaluate(() => { window.pocketRoom.state.fixed = null; window.pocketRoom.setFindings([]); window.pocketRoom.viewer.home(); });
  await tab("room");
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
  await page.waitForTimeout(2000);   // first frames, textures
  await tidyRoom();
  await page.waitForTimeout(1500);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: W, maxHeight: H, everyNthFrame: 1 });
  await hold(300);
  mark("start");
  if (phone) await phoneScene(); else await desktopFlow();
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

async function desktopFlow() {
  // 1. the room
  caption("Kate's living room in 3D, built from the estate agent's plan");
  await hold(800);
  await drag(260, 2600);
  await hold(1000);

  // 2. check the room
  caption("Check my room: rules in code + OpenAI's Decisions API");
  await hold(500);
  await page.click("#btn-check");
  await live("Decisions API", findingsIn);
  await hold(1000);
  // two issues fixed on camera: the blocked way from the hall door (a measured three-piece move), then the
  // chair run into the coffee table (three measured fixes, the Decisions API picks one)
  const FIXES = [
    ["path_blocked", "Tap an issue: the fix is measured in code, every walkway re-checked", "Apply: three pieces move and the way opens"],
    ["overlap", "Chair 3 runs into the coffee table: the Decisions API picks a fix", "Apply: the chair moves, the room is checked again"],
  ];
  let shown = 0;
  for (const [id, ask, done] of FIXES) {
    const i = await page.evaluate((id) => window.pocketRoom.state.findings.findIndex((f) => !f.pass && f.id === id), id);
    if (i < 0) { console.log("no finding:", id); continue; }
    caption(ask);
    await page.locator("#findings li").nth(i).click();   // the list, not the pin: pins can sit on top of each other
    await live("fixes", () => page.waitForSelector('.fix [data-act="apply"]:not([disabled]), .fix .fix-none', { timeout: 60_000 }));
    if (!(await page.locator('.fix [data-act="apply"]:not([disabled])').count())) { console.log("no fix:", id); await page.click(".fix .fix-none ~ .row button"); continue; }
    console.log("fix:", id, (await page.locator(".fix .fix-opt[aria-checked=true]").first().textContent()).trim());
    await hold(3500);
    caption(done);
    await page.click('.fix [data-act="apply"]');
    await live("Decisions API", () => page.waitForFunction(() => window.pocketRoom.state.findings.length > 0 && document.getElementById("findings-busy").hidden, null, { timeout: 120_000 }));
    await hold(2500);
    shown++;
  }
  if (!shown) {
    caption("Each issue is a pin in the room. Tap one to read it");
    await tapMarker();
    await hold(3200);
  }
  await page.waitForSelector("#toast", { state: "hidden", timeout: 9_000 }).catch(() => {});
  await page.click("#btn-home").catch(() => {});
  await hold(700);

  // 3. find for me: a new floor lamp, in place of the old one (no armchair fits this room)
  caption("Find for me: an agent searches UK shops for a new floor lamp that fits");
  await tab("find");
  await hold(700);
  await page.click("#find-q");
  await page.keyboard.type("a floor lamp", { delay: 70 });
  await hold(400);
  await page.keyboard.press("Enter");
  await live("agent search", () => page.waitForSelector("#find-results:not([hidden]) #find-cards li", { timeout: 240_000 }));
  caption("Three real products, sizes read from each shop's own page");
  await hold(3500);
  caption("Tap one: it takes the old lamp's place, with its verdict");
  await page.locator("#find-cards li").first().click();
  await verdictIn();
  await live("Decisions API", findingsIn);
  await hold(3000);

  // 4. add a piece from a photo: the Chesterfield
  caption("Add piece: a photo of a sofa seen in a shop");
  await page.click("#btn-home").catch(() => {});
  await tab("add");
  await hold(1000);
  await page.setInputFiles("#in-upload", sofaPhoto);
  caption("OpenAI vision reads the photo: the piece, its size, its style");
  await live("vision", verdictIn);
  const how = await page.evaluate(() => window.pocketRoom.state.piece?.model?.how);
  console.log("model:", how);
  caption(how === "db_match" ? "gpt-6-astra's 3D model of this sofa, placed to scale, replacing the old one" : "Placed to scale on the best wall, replacing the old sofa");
  await hold(2500);
  caption("Verdict computed in code; the Decisions API checks the room with it in");
  await live("Decisions API", findingsIn);
  await hold(2500);
  if (!(await page.locator("#verdict-building").isHidden())) {
    caption("gpt-6-astra builds the 3D model from the photo");
    await live("image → 3D", () => page.waitForFunction(() => document.getElementById("verdict-building").hidden, null, { timeout: 240_000 }));
  }

  // 6. photo view from eye height
  await page.waitForSelector("#toast", { state: "hidden", timeout: 9_000 }).catch(() => {});
  caption("Photo view: step into the room at eye height");
  await tab("room");
  await page.click("#btn-names");   // names off for the photo
  // pins off too (the render leaves them out anyway), then the viewer's own fly-to: there's no eye-height
  // button in the app, so the script moves the camera
  await page.evaluate(() => {
    const { viewer } = window.pocketRoom, V = viewer.camera.position.constructor, w = ([x, y, h]) => new V(x, h, -y);
    window.pocketRoom.setFindings([]);
    viewer.flyTo(w([3.3, -5.0, 1.65]), w([0.8, -1.4, 0.8]), 2.4);   // standing by the TV, looking north-west at the sofa
  });
  await hold(3200);
  caption("gpt-image renders this exact view, photoreal");
  await page.click("#btn-photo");
  await live("gpt-image", () => page.waitForFunction(() => { const i = document.getElementById("still"); return !i.hidden && i.complete && i.naturalWidth > 0; }, null, { timeout: 120_000 }));
  await page.evaluate(() => document.getElementById("still").scrollIntoView({ block: "center" }));
  await hold(2500);
  const src = await page.evaluate(() => document.getElementById("still").src);   // the render itself, shown full size in the cut
  const buf = src.startsWith("data:") ? Buffer.from(src.split(",")[1], "base64") : Buffer.from(await (await page.request.get(src)).body());
  writeFileSync(join(out, "photo-view.img"), buf);
}

// the closing scene, on a phone: in IKEA, Camera → the side table → in your room
async function phoneScene() {
  caption("In IKEA? Your room is in your pocket");
  await foldSheetIfPhone();
  await hold(1200);
  await drag(90, 1600);
  await hold(600);
  caption("Add piece → Camera: snap the side table");
  await tab("add");
  await hold(1400);
  await page.setInputFiles("#in-camera", shopPhoto);
  caption("Read by OpenAI vision, placed in your room to scale");
  await live("vision", verdictIn);
  const v = (await page.locator("#verdict-chip").textContent()).trim();
  caption(v === "Doesn't fit" ? "Doesn't fit: you know before you buy" : `${v}: you know before you buy`);
  await hold(2500);
  await live("Decisions API", findingsIn);
  await hold(1000);
  await foldSheetIfPhone();
  await hold(3000);
}
