// Pocket Room app: the screens (My room · Add piece · Verdict · Talk) round the 3D view.
// Works against the API in contract/api.md; the stubs answer until the lanes land.
import { firstPaint } from "./kit/real.js";
import { Viewer, VERDICT_COLOR } from "./viewer.js";
import { api, untilBuilt, imageToDataURL } from "./api.js";
import { roomStats } from "./room3d.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const ROOM_ID = params.get("room") || "hoskins-living";

const state = { room: null, piece: null, placement: null, spot: 0, findings: [] };

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
  insetSoon();
}
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  const current = b.getAttribute("aria-current") === "page";
  if (current) { sheet.classList.toggle("folded"); insetSoon(); } else show(b.dataset.tab);
});
$("grip").onclick = () => { sheet.classList.toggle("folded"); insetSoon(); };

// keep the room's picture centred in what the sheet leaves visible
function inset() {
  const top = sheet.classList.contains("folded") ? $("tabs").getBoundingClientRect().top : sheet.getBoundingClientRect().top;
  viewer.setInset(Math.max(0, innerHeight - top));
}
let insetTimer;
function insetSoon() { clearTimeout(insetTimer); insetTimer = setTimeout(inset, 320); }
new ResizeObserver(insetSoon).observe(sheet);

function toast(msg, ms = 3200) {
  const t = $("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), ms);
}

// ---------------------------------------------------------------- header tools
$("btn-names").onclick = (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", String(on));
  viewer.showNames(on);
};
$("btn-home").onclick = () => viewer.home(true);

// ---------------------------------------------------------------- My room
async function loadRoom() {
  const room = await api.room(ROOM_ID);
  state.room = room;
  const s = roomStats(room);
  $("room-name").textContent = room.name;
  const est = room.accuracy_m >= 0.1 ? ` · ±${Math.round(room.accuracy_m * 100)} cm` : "";
  $("room-meta").textContent = `${s.W.toFixed(2)} × ${s.D.toFixed(2)} m · ${s.area.toFixed(1)} m² · ${room.height ?? 2.4} m ceiling · ${room.furniture?.length ?? 0} pieces${est}`;
  inset();
  await viewer.setRoom(room);
  $("view").classList.add("ready");
}

$("btn-check").onclick = async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  try {
    const { findings } = await api.analyse(state.room.id, roomWithPiece());
    setFindings(findings);
    show("verdict");
    renderVerdict();
  } catch (err) { toast(err.message); }
  b.disabled = false;
};

$("btn-photo").onclick = async (e) => {
  const b = e.currentTarget;
  b.disabled = true;
  b.textContent = "Rendering…";
  try {
    const { image } = await api.render(state.room.id, viewer.snapshot());
    if (image) { $("still").src = image; $("still").hidden = false; }
  } catch (err) { toast(err.message); }
  b.disabled = false;
  b.textContent = "Photo view";
};

// the room as it would be with the piece in its spot (for /api/analyse)
function roomWithPiece() {
  const room = structuredClone(state.room);
  const spot = state.placement?.spots?.[state.spot] ?? state.placement?.best;
  if (state.piece && spot) {
    const p = state.piece;
    room.furniture = [...(room.furniture ?? []), { id: p.id, name: p.name, category: p.category, at: spot.at, size: p.size, rot: spot.rot, on_floor: true }];
  }
  return room;
}

// ---------------------------------------------------------------- Add piece
function busy(step, sub = "", img) {
  $("add-pick").hidden = !!step;
  $("add-busy").hidden = !step;
  if (!step) return;
  $("busy-step").textContent = step;
  $("busy-sub").textContent = sub;
  if (img !== undefined) { $("busy-img").hidden = !img; if (img) $("busy-img").src = img; }
}

async function fromFile(file, kind = "photo") {
  if (!file) return;
  show("add");
  try {
    busy("Reading the photo…", "", null);
    const image = await imageToDataURL(file);
    busy("Reading the photo…", "Finding the piece, its size and style.", image);
    await addPiece(() => api.newPiece(image, kind));
  } catch (err) { fail(err); }
}

$("in-camera").onchange = (e) => fromFile(e.target.files[0], "photo").finally(() => (e.target.value = ""));
$("in-upload").onchange = (e) => fromFile(e.target.files[0], guessKind(e.target.files[0])).finally(() => (e.target.value = ""));
// screenshots are usually PNG; camera photos JPEG/HEIC
const guessKind = (f) => (f && /png/.test(f.type) ? "screenshot" : "photo");

$("btn-sample").onclick = async () => {
  try {
    busy("Reading the tag…", "Green velvet sofa, from a shop tag.", null);
    await addPiece(() => api.piece("fixture-sofa-84"));
  } catch (err) { fail(err); }
};

$("find").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("find-q").value.trim();
  if (!q) return;
  try {
    busy("Looking for one that fits…", `“${q}”`, null);
    const { pieces } = await api.find(state.room.id, q);
    if (!pieces?.length) throw new Error("Nothing found that fits. Try other words.");
    await addPiece(async () => pieces[0]);
  } catch (err) { fail(err); }
};

// the whole flow: read → build (spinner while model.status is building) → place → drop → verdict
async function addPiece(read) {
  let piece = await read();
  busy("Building it in 3D…", `${piece.name} · ${size(piece)}`);
  if (params.get("fake") === "building" && piece.model) piece = await fakeBuild(piece);
  piece = await untilBuilt(piece, (p) => busy("Building it in 3D…", `${p.name} · ${size(p)}`));
  state.piece = piece;
  busy("Finding the best spot…", `${piece.name} · ${size(piece)}`);
  const [placement] = await Promise.all([api.place(state.room.id, piece), viewer.showPiece(piece)]);
  state.placement = placement;
  state.spot = 0;
  viewer.clearFindings();
  viewer.drop(placement);
  busy(null);
  $("verdict-dot").hidden = false;
  show("verdict");
  renderVerdict();
  // then the room's findings with the piece in it
  try {
    const { findings } = await api.analyse(state.room.id, roomWithPiece());
    setFindings(findings);
    renderVerdict();
  } catch (err) { toast(err.message); }
}

// dev only (?fake=building): pretend the model takes a few seconds, to see the spinner on the stubs
async function fakeBuild(piece) {
  const ready = piece.model;
  piece = { ...piece, model: { ...ready, status: "building" } };
  for (let i = 3; i > 0; i--) {
    busy("Building it in 3D…", `${piece.name} · ${size(piece)} · ${i}…`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  return { ...piece, model: ready };
}

function fail(err) {
  busy(null);
  toast(err.message || String(err));
}

const size = (p) => `${p.size[0].toFixed(2)} × ${p.size[1].toFixed(2)} × ${p.size[2].toFixed(2)} m${/estimate|default/.test(p.size_source) ? " (estimated)" : ""}`;

// ---------------------------------------------------------------- Verdict
function setFindings(findings) {
  state.findings = findings ?? [];
  viewer.showFindings(state.findings, (f, i) => focusFinding(i));
}

function focusFinding(i) {
  const f = state.findings[i];
  show("verdict");
  renderVerdict();
  document.querySelectorAll(".findings li").forEach((li, j) => li.classList.toggle("on", j === i));
  if (f?.at) viewer.focus(f.at, 1.4);
  if (f) toast(f.say, 4500);
}

function renderVerdict() {
  const p = state.placement;
  const hasAny = p || state.findings.length;
  $("verdict-empty").hidden = !!hasAny;
  $("verdict-body").hidden = !hasAny;
  if (!hasAny) return;
  const chip = $("verdict-chip");
  if (p) {
    const spot = p.spots?.[state.spot] ?? p.best;
    const verdict = state.spot === 0 ? p.verdict : spot?.verdict ?? p.verdict;
    chip.hidden = false;
    chip.textContent = verdict;
    chip.className = `chip ${{ "Fits": "fits", "Just fits": "just", "Doesn't fit": "no" }[verdict] ?? "just"}`;
    $("verdict-say").textContent = state.spot === 0 ? p.say : `${verdict}. ${spot?.reasons?.join(" ") ?? ""}`;
    const bits = [state.piece?.name, state.piece && size(state.piece)];
    if (spot?.clearance_m != null) bits.push(`${Math.round(spot.clearance_m * 100)} cm to walk past`);
    if (state.piece?.source?.price) bits.push(state.piece.source.price);
    $("verdict-piece").textContent = bits.filter(Boolean).join(" · ");
    $("btn-next").hidden = !(p.spots?.length > 1);
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
    const kind = f.kind === "design" && f.probability != null ? ` · ${Math.round(f.probability * 100)}% sure` : "";
    li.innerHTML = `<b>${i + 1}</b><span></span>`;
    li.querySelector("span").textContent = f.say;
    const small = document.createElement("small");
    small.textContent = `${f.kind === "design" ? "Design" : "Rule"}${kind}${f.fix ? " · green pin shows the fix" : ""}`;
    li.querySelector("span").append(small);
    li.onclick = () => focusFinding(i);
    return li;
  }));
}

$("btn-next").onclick = () => {
  const p = state.placement;
  if (!p?.spots?.length) return;
  state.spot = (state.spot + 1) % p.spots.length;
  viewer.drop({ ...p, best: p.spots[state.spot], verdict: p.spots[state.spot].verdict });
  renderVerdict();
};

$("btn-remove").onclick = () => {
  viewer.clearPiece();
  viewer.clearFindings();
  Object.assign(state, { piece: null, placement: null, spot: 0, findings: [] });
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
  } catch (err) { toast(err.message); }
}

try {
  await loadRoom();
} catch (err) {
  $("loading").textContent = `Couldn't load the room: ${err.message}`;
  throw err;
}
if (params.has("shared")) await takeShared();
else if (params.get("tab")) show(params.get("tab"));
