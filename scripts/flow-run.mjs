// End-to-end run of the designer flow through the real UI and the live pipeline (no data set by hand):
// rooms from Kate's Zoopla screenshots via the New room flow, pieces from a photo, a screenshot, a pasted link
// and a question (Find for me), the plan from designer/ with the Decisions pick, Apply. Screens go to
// docs/screens/flow-*.jpg; what happened goes to stdout as JSON lines (the server log has every call).
//   node scripts/flow-run.mjs http://localhost:8840 [scenario…]
import { openApp, sleep } from "./ui-drive.mjs";
import { resolve } from "node:path";

const BASE = process.argv[2] ?? "http://localhost:8840";
const ONLY = process.argv.slice(3);
const DESK = { width: 1440, height: 900 }, PHONE = { width: 375, height: 812, mobile: true };
const IN = (f) => resolve(`docs/test-inputs/zoopla/${f}`);
const out = (o) => console.log(JSON.stringify(o));
const shared = {};   // rooms built and links found, for later scenarios

async function open(size, room) {
  const ui = await openApp(`${BASE}/${room ? `?room=${room}` : ""}`, size);
  await ui.waitFor(() => document.querySelector("#view")?.classList.contains("ready"), { timeout: 90000 });
  return ui;
}
const timed = async (fn) => { const t0 = Date.now(); await fn(); return Date.now() - t0; };
const text = (ui, sel) => ui.evaluate(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ""`);
async function advice(ui) {
  const ms = await timed(() => ui.waitFor(() => document.querySelectorAll(".findings li.first").length > 0 || (document.querySelectorAll(".findings li").length > 0 && !document.querySelector(".findings li.bad")), { timeout: 60000 }));
  const top = await ui.evaluate(`pocketRoom.state.findings.filter(f => f.rank).map(f => f.say)`);
  return { ms, top };
}
async function build(ui, files, name) {
  await ui.click("#btn-new-room");
  await sleep(400);
  await ui.upload("#room-upload", files.map(IN));
  await ui.waitFor(() => !document.querySelector("#btn-build").disabled);
  await ui.click("#new-name"); await ui.type(name);
  const ms = await timed(async () => {
    await ui.click("#btn-build");
    await ui.waitFor(() => location.search.includes("room=photo-") && document.querySelector("#view").classList.contains("ready"), { timeout: 240000 });
  });
  const room = await ui.evaluate(`({ id: pocketRoom.state.room.id, name: pocketRoom.state.room.name, furniture: pocketRoom.state.room.furniture.map(f => f.name) })`);
  return { ms, room };
}
async function waitPlan(ui) {
  await ui.waitFor(() => !document.querySelector("#plan").hidden || document.querySelector("#add-busy .busy-error:not([hidden])"), { timeout: 240000 });
  const err = await ui.evaluate(`document.querySelector("#add-busy .busy-error:not([hidden]) .err")?.innerText ?? null`);
  if (err) throw new Error(`add piece failed: ${err}`);
  await sleep(1500);
  return ui.evaluate(`({ say: document.querySelector("#verdict-say").innerText, piece: document.querySelector("#verdict-piece").innerText,
    plans: [...document.querySelectorAll("#plan .plan-opt")].map(b => b.innerText.replace(/\\n+/g, " | ")),
    kinds: pocketRoom.state.plan.plans.map(p => p.kind), decision: pocketRoom.state.plan.decision })`);
}
async function apply(ui, kind) {
  if (kind) {
    const i = await ui.evaluate(`pocketRoom.state.plan.plans.findIndex(p => p.kind === ${JSON.stringify(kind)})`);
    if (i < 0) return { skipped: `no ${kind} plan` };
    await ui.click({ js: `document.querySelectorAll("#plan .plan-opt")[${i}]` });
    await sleep(1500);
  }
  const ms = await timed(async () => {
    await ui.click('#plan [data-act="apply"]');
    await sleep(300);
    await ui.waitFor(() => document.querySelector("#plan").hidden && document.querySelector("#findings-busy").hidden && document.querySelectorAll(".findings li").length > 0, { timeout: 60000 });
  });
  await sleep(1500);
  return { ms, say: await text(ui, "#verdict-say"), chip: await text(ui, "#verdict-chip"), applied: await ui.evaluate("pocketRoom.state.placement?.plan") };
}
async function find(ui, q) {
  await ui.click('.tabs [data-tab="find"]');
  await sleep(300);
  await ui.click("#find-q"); await ui.type(q);
  const ms = await timed(async () => {
    await ui.click("#find button[type=submit]");
    await ui.waitFor(() => !document.querySelector("#find-results").hidden || document.querySelector("#find-busy .busy-error:not([hidden])"), { timeout: 240000 });
  });
  const err = await ui.evaluate(`document.querySelector("#find-busy .busy-error:not([hidden]) .err")?.innerText ?? null`);
  if (err) throw new Error(`find failed: ${err}`);
  const cards = await ui.evaluate(`[...document.querySelectorAll("#find-cards li")].map(l => ({ name: l.querySelector(".name")?.innerText, facts: l.querySelector(".facts")?.innerText, url: l.querySelector("a")?.href }))`);
  return { ms, cards };
}
async function upload(ui, file) {
  await ui.click('.tabs [data-tab="add"]');
  await sleep(300);
  const t0 = Date.now();
  await ui.upload("#in-upload", [IN(file)]);
  return t0;
}

const scenarios = {
  // Kate's flat: the problems on the 3D and the advice, a fix, then a piece from a product photo
  async flat_photo() {
    const ui = await open(DESK);
    const a = await advice(ui);
    await ui.click('.tabs [data-tab="verdict"]'); await sleep(1200);
    await ui.shot("docs/screens/flow-desktop-1-flat-advice.jpg");
    const t0 = await upload(ui, "piece-ikea-office-chair-red.jpg");
    const plan = await waitPlan(ui);
    const planMs = Date.now() - t0;
    await ui.shot("docs/screens/flow-desktop-2-flat-photo-plan.jpg");
    const ap = await apply(ui);
    await ui.shot("docs/screens/flow-desktop-3-flat-photo-applied.jpg");
    out({ scenario: "flat_photo", room: "hoskins-living", advice: a, photo_to_plan_ms: planMs, plan, apply: ap, errors: ui.logs.filter((l) => /exception|error/i.test(l)) });
    await ui.close();
  },
  // Kate's flat on a phone: what's wrong (top three), then the office chair from its product photo
  async flat_photo_phone() {
    const ui = await open(PHONE);
    const a = await advice(ui);
    await ui.click("#room-advice"); await sleep(2500);
    await ui.shot("docs/screens/flow-phone-1-flat-advice-fix.jpg");
    const t0 = await upload(ui, "piece-ikea-office-chair-red-2.jpg");
    const plan = await waitPlan(ui);
    const planMs = Date.now() - t0;
    await ui.shot("docs/screens/flow-phone-2-flat-photo-plan.jpg");
    const ap = await apply(ui);
    await ui.shot("docs/screens/flow-phone-3-flat-photo-applied.jpg");
    out({ scenario: "flat_photo_phone", room: "hoskins-living", advice: a, photo_to_plan_ms: planMs, plan, apply: ap, errors: ui.logs.filter((l) => /exception|error/i.test(l)) });
    await ui.close();
  },
  // Kate's flat on a phone: just a question ("find me an armchair"), then the designer's plan
  async flat_question() {
    const ui = await open(PHONE);
    await advice(ui);
    const f = await find(ui, "an armchair");
    shared.link = f.cards.find((c) => /ikea\.com/.test(c.url ?? ""))?.url ?? f.cards[0]?.url;
    await ui.shot("docs/screens/flow-phone-1-flat-question-results.jpg");
    const t0 = Date.now();
    await ui.click("#find-cards li");
    const plan = await waitPlan(ui);
    const planMs = Date.now() - t0;
    await ui.shot("docs/screens/flow-phone-2-flat-question-plan.jpg");
    const ap = await apply(ui, plan.kinds.includes("move") ? "move" : null);
    await ui.shot("docs/screens/flow-phone-3-flat-question-applied.jpg");
    out({ scenario: "flat_question", room: "hoskins-living", find: f, card_to_plan_ms: planMs, plan, apply: ap, errors: ui.logs.filter((l) => /exception|error/i.test(l)) });
    await ui.close();
  },
  // Kate's flat, desktop: "find me a sofa" — the flat has one, so replacing it is the obvious plan
  async flat_sofa_question() {
    const ui = await open(DESK);
    await advice(ui);
    const f = await find(ui, "a sofa");
    const t0 = Date.now();
    await ui.click("#find-cards li");
    const plan = await waitPlan(ui);
    const planMs = Date.now() - t0;
    await ui.shot("docs/screens/flow-desktop-7-flat-sofa-plan.jpg");
    const ap = await apply(ui, plan.kinds.includes("replace") ? "replace" : null);
    await ui.shot("docs/screens/flow-desktop-8-flat-sofa-applied.jpg");
    out({ scenario: "flat_sofa_question", room: "hoskins-living", find: f, card_to_plan_ms: planMs, plan, apply: ap, errors: ui.logs.filter((l) => /exception|error/i.test(l)) });
    await ui.close();
  },
  // Zoopla listing A from its five photos, then a piece from a screenshot (PNG)
  async zoopla_a_screenshot() {
    const ui = await open(DESK);
    const b = await build(ui, [1, 2, 3, 4, 5].map((i) => `listing-a-living-${i}.jpg`), "Zoopla A living room");
    shared.a = b.room.id;
    const a = await advice(ui);
    await sleep(1200);
    await ui.shot("docs/screens/flow-desktop-4-zoopla-a-built.jpg");
    const t0 = await upload(ui, "piece-ikea-poang-armchair-screenshot.png");
    const plan = await waitPlan(ui);
    const planMs = Date.now() - t0;
    await ui.shot("docs/screens/flow-desktop-5-zoopla-a-screenshot-plan.jpg");
    const ap = await apply(ui);
    await ui.shot("docs/screens/flow-desktop-6-zoopla-a-applied.jpg");
    out({ scenario: "zoopla_a_screenshot", build: b, advice: a, screenshot_to_plan_ms: planMs, plan, apply: ap, errors: ui.logs.filter((l) => /exception|error/i.test(l)) });
    await ui.close();
  },
  // Zoopla A on a phone: "find me a sofa" — the room has one, so replacing it is on the table
  async zoopla_a_replace() {
    const ui = await open(PHONE, shared.a);
    await advice(ui);
    const f = await find(ui, "a sofa");
    shared.link ??= f.cards.find((c) => /ikea\.com/.test(c.url ?? ""))?.url ?? f.cards[0]?.url;
    const t0 = Date.now();
    await ui.click("#find-cards li");
    const plan = await waitPlan(ui);
    const planMs = Date.now() - t0;
    await ui.shot("docs/screens/flow-phone-4-zoopla-a-sofa-plan.jpg");
    const ap = await apply(ui, plan.kinds.includes("replace") ? "replace" : null);
    await ui.shot("docs/screens/flow-phone-5-zoopla-a-sofa-applied.jpg");
    out({ scenario: "zoopla_a_replace", room: shared.a, find: f, card_to_plan_ms: planMs, plan, apply: ap, errors: ui.logs.filter((l) => /exception|error/i.test(l)) });
    await ui.close();
  },
  // Zoopla listing B from its one photo, then a pasted product link (one the agent found earlier)
  async zoopla_b_link() {
    const ui = await open(PHONE);
    const b = await build(ui, ["listing-b-living-1.jpg"], "Zoopla B living room");
    const a = await advice(ui);
    await sleep(1200);
    await ui.shot("docs/screens/flow-phone-6-zoopla-b-advice.jpg");
    const link = shared.link ?? process.env.FLOW_LINK;
    if (!link) throw new Error("no link: run a Find for me scenario first or set FLOW_LINK to a link the agent found");
    await ui.click('.tabs [data-tab="add"]');
    await sleep(300);
    await ui.click("#link-url"); await ui.type(link);
    const t0 = Date.now();
    await ui.click("#link button[type=submit]");
    const plan = await waitPlan(ui);
    const planMs = Date.now() - t0;
    await ui.shot("docs/screens/flow-phone-7-zoopla-b-link-plan.jpg");
    const ap = await apply(ui);
    await ui.shot("docs/screens/flow-phone-8-zoopla-b-applied.jpg");
    out({ scenario: "zoopla_b_link", build: b, advice: a, link, link_to_plan_ms: planMs, plan, apply: ap, errors: ui.logs.filter((l) => /exception|error/i.test(l)) });
    await ui.close();
  },
};

for (const [name, run] of Object.entries(scenarios)) {
  if (ONLY.length && !ONLY.includes(name)) continue;
  const t0 = Date.now();
  try { await run(); }
  catch (e) { out({ scenario: name, failed: e.message }); }
  out({ scenario: name, total_ms: Date.now() - t0 });
}
