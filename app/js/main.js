// Pocket Room app: the screens (My room · Add piece · Find for me · Verdict · Talk) round the 3D view.
// Works against the API in contract/api.md.
import { firstPaint } from "./kit/real.js";
import { Viewer } from "./viewer.js";
import { api, untilBuilt, imageToDataURL } from "./api.js";
import { roomStats } from "./room3d.js";
import { spotOf, hiddenIds, analyseBody, placeBody, chanceWords, sizeCm } from "./scene-state.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM_ID = params.get("room") || "hoskins-living";
const desktop = matchMedia("(min-width: 900px)");

const state = { room: null, saved: true, piece: null, placement: null, spot: 0, findings: [], run: 0 };

await firstPaint();
const viewer = new Viewer($("view"), $("labels"));
window.pocketRoom = { viewer, state, setFindings: (f) => { setFindings(f); renderVerdict(); } };   // for the console and tests

// ---------------------------------------------------------------- tabs and sheet
const sheet = $("sheet");
function show(tab) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.dataset.screen !== tab;
  for (const b of document.querySelectorAll(".tabs button")) {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  sheet.classList.remove("folded");
  if (tab === "verdict") $("verdict-dot").hidden = true;
  sheet.scrollTop = 0;
  layout();
}
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  const current = b.getAttribute("aria-current") === "page";
  if (current && !desktop.matches) { sheet.classList.toggle("folded"); layout(); } else show(b.dataset.tab);
});
$("grip").onclick = () => { sheet.classList.toggle("folded"); layout(); };

// Phone: the 3D ends where the sheet begins, so nothing covers the room. Desktop: the panel sits beside it.
function layout() {
  const cover = desktop.matches ? 0 : Math.max(0, innerHeight - sheet.getBoundingClientRect().top);
  document.documentElement.style.setProperty("--cover", `${Math.round(cover)}px`);
  viewer.setInset(0);
}
new ResizeObserver(() => requestAnimationFrame(layout)).observe(sheet);
desktop.addEventListener("change", layout);
addEventListener("resize", layout);

function toast(msg, ms = 3600) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

// Errors in plain words: what the server says when it's useful, else what to do.
function plain(err) {
  const m = String(err?.message ?? err ?? "");
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return "Can't reach Pocket Room. Check your connection and try again.";
  if (/No furniture found/i.test(m)) return "We couldn't see a piece of furniture in that picture. Try one where the piece fills the frame.";
  if (/: 5\d\d$/.test(m)) return "Something went wrong on our side. Try again in a moment.";
  return m || "Something went wrong. Try again.";
}

// ---------------------------------------------------------------- busy boxes (a spinner with words; errors with a retry)
function busyBox(scope) {
  const box = $(`${scope}-busy`), pick = $(`${scope}-pick`);
  const step = box.querySelector(".busy-step"), sub = box.querySelector(".busy-sub"), errBox = box.querySelector(".busy-error");
  let timers = [];
  const stop = () => { timers.forEach(clearTimeout); timers = []; };
  const api = {
    // steps: [[ms, text], ...] move the sub line on while the call runs
    show(text, subText = "", { img, steps } = {}) {
      stop();
      box.classList.remove("failed");
      errBox.hidden = true;
      pick.hidden = true;
      box.hidden = false;
      step.textContent = text;
      sub.textContent = subText;
      const im = box.querySelector("img");
      if (im && img !== undefined) { im.hidden = !img; if (img) im.src = img; }
      for (const [ms, t] of steps ?? []) timers.push(setTimeout(() => (sub.textContent = t), ms));
    },
    hide() { stop(); box.hidden = true; pick.hidden = false; },
    fail(err, retry) {
      stop();
      box.hidden = false;
      pick.hidden = true;
      box.classList.add("failed");
      step.textContent = "That didn't work";
      sub.textContent = "";
      errBox.hidden = false;
      errBox.querySelector(".err").textContent = plain(err);
      errBox.querySelector(".retry").hidden = !retry;
      errBox.querySelector(".retry").onclick = () => retry?.();
      errBox.querySelector(".back").onclick = () => api.hide();
    },
  };
  return api;
}
const addBusy = busyBox("add"), findBusy = busyBox("find");

// ---------------------------------------------------------------- header tools
$("btn-names").onclick = (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", String(on));
  viewer.showNames(on);
};
$("btn-home").onclick = () => viewer.home(true);

// ---------------------------------------------------------------- My room
async function loadRoom() {
  const t0 = performance.now();
  const room = await api.room(ROOM_ID);
  state.room = room;
  state.saved = true;   // it came from the server's room store
  const s = roomStats(room);
  $("room-name").textContent = room.name;
  const est = room.accuracy_m >= 0.1 ? ` · ±${Math.round(room.accuracy_m * 100)} cm` : "";
  $("room-meta").textContent = `${s.W.toFixed(2)} × ${s.D.toFixed(2)} m · ${s.area.toFixed(1)} m² · ${room.height ?? 2.4} m ceiling · ${room.furniture?.length ?? 0} pieces${est}`;
  layout();
  await viewer.setRoom(room);
  $("view").classList.add("ready");
  console.log(`[pocket-room] room ready ${Math.round(performance.now() - t0)} ms after the script ran, ${Math.round(performance.now())} ms after navigation`);
}

$("btn-check").onclick = async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  b.innerHTML = `<span class="spin small"></span>Checking…`;
  try {
    show("verdict");
    await checkRoom();
  } catch (err) { toast(plain(err)); }
  b.disabled = false;
  b.textContent = "Check my room";
};

async function checkRoom() {
  const run = state.run;
  $("verdict-empty").hidden = true;
  $("verdict-body").hidden = false;
  $("findings-busy").hidden = false;
  try {
    const spot = state.piece ? spotOf(state.placement, state.spot) : null;
    const { findings } = await api.analyse(analyseBody(state.room, state.piece, spot, { saved: state.saved }));
    if (run !== state.run) return;   // the piece or spot changed meanwhile
    setFindings(findings);
  } finally {
    $("findings-busy").hidden = true;
    renderVerdict();
  }
}

$("btn-photo").onclick = async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  b.innerHTML = `<span class="spin small"></span>Making a photo of this view… ~15 s`;
  try {
    const { image } = await api.render(state.room.id, viewer.snapshot());
    if (image) { $("still").src = image; $("still").hidden = false; show("room"); }
  } catch (err) { toast(plain(err)); }
  b.disabled = false;
  b.textContent = "Photo view";
};

// ---------------------------------------------------------------- Add piece
async function fromFile(file, kind = "photo") {
  if (!file) return;
  show("add");
  let image;
  const go = async () => {
    try {
      addBusy.show("Reading the photo…", "", { img: null });
      image ??= await imageToDataURL(file);
      addBusy.show("Reading the photo…", "Finding the piece, its size and style.", { img: image,
        steps: [[5000, "Looking for a tag or a printed size…"], [11000, "Almost there…"]] });
      await addPiece(() => api.newPiece(image, kind), addBusy);
    } catch (err) { addBusy.fail(err, go); }
  };
  await go();
}

$("in-camera").onchange = (e) => fromFile(e.target.files[0], "photo").finally(() => (e.target.value = ""));
$("in-upload").onchange = (e) => fromFile(e.target.files[0], guessKind(e.target.files[0])).finally(() => (e.target.value = ""));
// screenshots are usually PNG; camera photos JPEG/HEIC
const guessKind = (f) => (f && /png/.test(f.type) ? "screenshot" : "photo");

$("btn-sample").onclick = async () => {
  const go = async () => {
    try {
      addBusy.show("Reading the tag…", "Green velvet sofa, from a shop tag.", { img: null });
      await addPiece(() => api.piece("fixture-sofa-84"), addBusy);
    } catch (err) { addBusy.fail(err, go); }
  };
  await go();
};

$("link").onsubmit = async (e) => {
  e.preventDefault();
  const url = $("link-url").value.trim();
  if (!url) return;
  let host = url;
  try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
  const go = async () => {
    try {
      addBusy.show("Opening the product page…", host, { img: null,
        steps: [[2500, "Reading the name, price and the stated size…"], [9000, "Checking each size against the page…"]] });
      await addPiece(() => api.fromLink(url), addBusy);
      $("link-url").value = "";
    } catch (err) { addBusy.fail(err, go); }
  };
  await go();
};
$("go-find").onclick = () => show("find");

// The whole flow: read → place at once (the kit piece stands in while the 3D model builds) → drop →
// verdict → findings; the real model swaps in when it's ready.
async function addPiece(read, box) {
  const run = ++state.run;
  const piece = await read();
  if (run !== state.run) return;
  box.show("Finding the best spot…", `${piece.name} · ${size(piece)}`);
  const [placement] = await Promise.all([api.place(placeBody(state.room, piece, { saved: state.saved })), viewer.showPiece(piece)]);
  if (run !== state.run) return;
  Object.assign(state, { piece, placement, spot: 0, findings: [] });
  viewer.clearFindings();
  dropSpot();
  box.hide();
  $("verdict-dot").hidden = false;
  show("verdict");
  renderVerdict();
  checkRoom().catch((err) => toast(plain(err)));
  if (piece.model?.status === "building" || (piece.model?.status === "pending" && piece.model?.job)) buildInBackground(piece, run);
  else $("verdict-building").hidden = true;
}

async function buildInBackground(piece, run) {
  $("verdict-building").hidden = false;
  try {
    const ready = await untilBuilt(piece, () => {});
    if (run !== state.run) return;
    state.piece = ready;
    if (ready.model?.glb) { await viewer.swapModel(ready); toast("The real 3D model is in."); }
  } catch {
    if (run === state.run) toast("The 3D model didn't build; the stand-in stays, sized right.");
  } finally {
    if (run === state.run) $("verdict-building").hidden = true;
  }
}

const size = (p) => `${p.size[0].toFixed(2)} × ${p.size[1].toFixed(2)} × ${p.size[2].toFixed(2)} m${/estimate|default/.test(p.size_source) ? " (estimated)" : ""}`;

// ---------------------------------------------------------------- Find for me
const PLURAL = { sofa: "sofas", armchair: "armchairs", chair: "chairs", bookcase: "bookcases", shelf: "shelves", sideboard: "sideboards",
  desk: "desks", table: "tables", bed: "beds", rug: "rugs", lamp: "lamps", cabinet: "cabinets" };
async function findFor(q) {
  show("find");
  $("find-results").hidden = true;
  const what = Object.keys(PLURAL).find((k) => new RegExp(`\\b${k}`, "i").test(q));
  const go = async () => {
    try {
      findBusy.show(`Finding ${what ? PLURAL[what] : "pieces"} that fit…`, "Searching UK shops…", { steps: [
        [7000, "Opening each product page…"], [14000, "Reading the stated sizes off each page…"],
        [22000, "Checking each one against your walls and walkways…"], [32000, "Picking three that suit your room…"],
        [55000, "Still going: some shops are slow…"]] });
      const out = await api.find({ roomId: state.room.id, query: q, room: state.saved ? undefined : state.room });
      if (!out.pieces?.length) throw new Error(out.say || `Nothing we found fits this room. Try other words, or a smaller ${what ?? "piece"}.`);
      findBusy.hide();
      $("find-pick").hidden = true;
      renderCards(out);
    } catch (err) { findBusy.fail(err, go); }
  };
  await go();
}
$("find-chips").onclick = (e) => { const b = e.target.closest("[data-q]"); if (b) findFor(b.dataset.q); };
$("find").onsubmit = (e) => { e.preventDefault(); const q = $("find-q").value.trim(); if (q) findFor(q); };
$("find-again").onclick = () => { $("find-results").hidden = true; $("find-pick").hidden = false; };

const chipClass = (v) => ({ "Fits": "fits", "Just fits": "just", "Doesn't fit": "no" }[v] ?? "just");
function renderCards(out) {
  $("find-results").hidden = false;
  const wall = out.space?.wall ? ` the ${out.space.wall} wall` : " your room";
  $("find-lead").textContent = `${out.pieces.length === 1 ? "One fits" : `${out.pieces.length} that fit`}${wall}, sizes from each shop's own page. Tap one to see it in your room.`;
  $("find-cards").replaceChildren(...out.pieces.map((p) => {
    const li = document.createElement("li");
    li.innerHTML = `<img alt=""><div class="body"><p class="name"></p><p class="facts"></p><p class="why"></p>
      <div class="acts"><span class="mini"></span><a target="_blank" rel="noopener">See it in the shop</a></div></div>`;
    const img = li.querySelector("img");
    img.referrerPolicy = "no-referrer";
    if (p.source?.image) img.src = p.source.image; else img.hidden = true;
    img.onerror = () => (img.hidden = true);
    li.querySelector(".name").textContent = p.name;
    li.querySelector(".facts").textContent = [p.source?.shop, p.source?.price, sizeCm(p.size)].filter(Boolean).join(" · ");
    li.querySelector(".why").textContent = p.agent?.reason ?? "";
    const v = p.agent?.fit?.verdict, mini = li.querySelector(".mini");
    if (v) { mini.textContent = v; mini.className = `mini ${chipClass(v)}`; } else mini.hidden = true;
    const a = li.querySelector("a");
    a.href = p.source?.url ?? "#";
    a.onclick = (e) => e.stopPropagation();
    const pick = async () => {
      document.querySelectorAll(".cards li").forEach((x) => x.classList.toggle("on", x === li));
      try { await addPiece(async () => p, { show: () => {}, hide: () => {} }); }
      catch (err) { toast(plain(err)); }
    };
    li.onclick = pick;
    return li;
  }));
}

// ---------------------------------------------------------------- Verdict
function setFindings(findings) {
  state.findings = findings ?? [];
  viewer.showFindings(state.findings, (f, i) => focusFinding(i));
}

function focusFinding(i) {
  const f = state.findings[i];
  show("verdict");
  document.querySelectorAll(".findings li").forEach((li, j) => li.classList.toggle("on", j === i));
  if (f?.at) viewer.focus(f.at, 1.4);
  if (f && !desktop.matches) toast(f.say, 4500);
}

// the spot on show: drop the piece there, hide what it replaces
function dropSpot() {
  const p = state.placement, spot = spotOf(p, state.spot);
  viewer.setHidden(hiddenIds(spot));
  viewer.drop({ ...p, best: spot, verdict: spot?.verdict ?? p.verdict });
}

function renderVerdict() {
  const p = state.placement;
  const hasAny = p || state.findings.length || !$("findings-busy").hidden;
  $("verdict-empty").hidden = !!hasAny;
  $("verdict-body").hidden = !hasAny;
  if (!hasAny) return;
  const chip = $("verdict-chip");
  if (p) {
    const spot = spotOf(p, state.spot);
    const verdict = state.spot === 0 ? p.verdict : spot?.verdict ?? p.verdict;
    chip.hidden = false;
    chip.textContent = verdict;
    chip.className = `chip ${chipClass(verdict)}`;
    const reason = spot?.decision?.reason ?? spot?.reasons?.[0];
    $("verdict-say").textContent = state.spot === 0 ? p.say
      : `${verdict}. ${spot?.wall ? `On the ${spot.wall} wall` : "In the middle of the room"}${spot?.replaces ? ", replacing the old one" : ""}${reason ? `: ${reason}` : ""}.`;
    const bits = [state.piece?.name, state.piece && size(state.piece)];
    if (spot?.clearance_m != null) bits.push(`${Math.round(Math.min(spot.clearance_m, 2) * 100)}${spot.clearance_m >= 2 ? "+" : ""} cm to walk past`);
    if (state.piece?.source?.price) bits.push(state.piece.source.price);
    $("verdict-piece").textContent = bits.filter(Boolean).join(" · ");
    $("btn-next").hidden = !(p.spots?.length > 1);
    $("btn-next").textContent = `Next spot (${state.spot + 1} of ${p.spots?.length ?? 1})`;
    $("btn-remove").hidden = false;
  } else {
    chip.hidden = true;
    $("verdict-say").textContent = "Your room as it is.";
    $("verdict-piece").textContent = "";
    $("btn-next").hidden = $("btn-remove").hidden = true;
  }
  const ol = $("findings");
  ol.replaceChildren(...state.findings.map((f, i) => {
    const li = document.createElement("li");
    li.className = f.pass ? "good" : "bad";
    li.innerHTML = `<b>${i + 1}</b><span></span>`;
    li.querySelector("span").textContent = f.say;
    const small = document.createElement("small");
    const chance = chanceWords(f);
    small.textContent = `${f.kind === "design" ? "Design" : "Rule"}${chance ? ` · ${chance}` : ""}${f.fix ? " · green pin shows the fix" : ""}`;
    li.querySelector("span").append(small);
    li.onclick = () => focusFinding(i);
    return li;
  }));
}

$("btn-next").onclick = () => {
  const p = state.placement;
  if (!p?.spots?.length) return;
  state.spot = (state.spot + 1) % p.spots.length;
  state.run++;   // findings for the old spot no longer apply
  setFindings([]);
  dropSpot();
  renderVerdict();
  checkRoom().catch((err) => toast(plain(err)));
};

$("btn-remove").onclick = () => {
  state.run++;
  viewer.clearPiece();
  viewer.clearFindings();
  viewer.setHidden([]);
  Object.assign(state, { piece: null, placement: null, spot: 0, findings: [] });
  $("verdict-building").hidden = true;
  renderVerdict();
  show("add");
};

// ---------------------------------------------------------------- Talk (placeholder until the voice lane lands)
$("btn-mic").onclick = (e) => {
  e.currentTarget.classList.remove("pulse");
  void e.currentTarget.offsetWidth;
  e.currentTarget.classList.add("pulse");
  toast("Voice isn't wired up yet.");
};

// ---------------------------------------------------------------- PWA: install + share target
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});

// a picture shared to the app (manifest share_target → sw.js) waits in the cache under /shared/latest
async function takeShared() {
  show("add");
  history.replaceState(null, "", location.pathname);
  try {
    const cache = await caches.open("pocket-room-share");
    const res = await cache.match("/shared/latest");
    if (!res) return;
    await cache.delete("/shared/latest");
    const blob = await res.blob();
    await fromFile(blob, "screenshot");
  } catch (err) { toast(plain(err)); }
}

layout();
try {
  await loadRoom();
} catch (err) {
  $("loading-text").textContent = `Couldn't load the room: ${plain(err)}`;
  throw err;
}
if (params.has("shared")) await takeShared();
else if (params.get("tab")) show(params.get("tab"));
