// Pocket Room app: the screens (My room · Add piece · Find for me · Verdict · Talk) round the 3D view.
// Works against the API in contract/api.md.
import { firstPaint } from "./kit/real.js";
import { Viewer } from "./viewer.js";
import { api, untilBuilt, imageToDataURL, fileAsDataURL } from "./api.js";
import { roomStats } from "./room3d.js";
import { spotOf, hiddenIds, analyseBody, placeBody, chanceWords, sizeCm } from "./scene-state.js";
import { fixBody, applyFix, undoStack, withFixed, previewMoves } from "./fix-state.js";
import { nextShot, CORNERS, MAX_PHOTOS, parseLength, formatLength, editLength, accuracyWords, roomSize, sortRooms, PHOTO_STEPS, PLAN_STEPS, seenShare, spotUnseen } from "./new-room.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEFAULT_ROOM = "hoskins-living";

// what the browser keeps: rooms built here (the server forgets them when it restarts), the current room, ft or m
const LOCAL = { rooms: "pocket-room.rooms", room: "pocket-room.room", unit: "pocket-room.unit" };
const keep = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
function keepRoom(room) {
  const rooms = keep.get(LOCAL.rooms, {});
  rooms[room.id] = room;
  const ids = Object.keys(rooms).sort().reverse();
  for (const id of ids.slice(12)) delete rooms[id];   // the newest dozen
  keep.set(LOCAL.rooms, rooms);
}

// A call that names the room by id. If the server forgot a room built here (it restarted), put it back
// and try once more; if it won't take it, send the room whole from then on.
async function withRoom(call) {
  try { return await call(); }
  catch (err) {
    if (!/^no room /.test(err.message) || !state.room || state.room.source === "prebuilt") throw err;
    try { await api.keepRoom(state.room); } catch { state.saved = false; }
    return call();
  }
}
const desktop = matchMedia("(min-width: 900px)");

const fixCache = new Map(), undo = undoStack();   // tap an issue → fixes, and what Apply changed
const state = { room: null, saved: true, piece: null, placement: null, spot: 0, findings: [], run: 0, fixOpen: null, fixSel: null, fixed: null };

await firstPaint();
const viewer = new Viewer($("view"), $("labels"));
window.pocketRoom = { viewer, state, loadRoom: (id) => loadRoom(id), setFindings: (f) => { setFindings(f); renderVerdict(); } };   // for the console and tests

// ---------------------------------------------------------------- tabs and sheet
const sheet = $("sheet");
function show(tab) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.dataset.screen !== tab;
  for (const b of document.querySelectorAll(".tabs button")) {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  sheet.classList.remove("folded");
  if (tab === "verdict") $("verdict-dot").hidden = true;
  closeMenu();
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

function toast(msg, ms = 3600, action) {
  const t = $("toast");
  t.textContent = msg;
  if (action) {
    const b = document.createElement("button");
    b.className = "toast-act";
    b.textContent = action.label;
    b.onclick = () => { t.hidden = true; action.run(); };
    t.append(b);
  }
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
// A room by id: the server's store, else the copy this browser kept (put back on the server if it forgot it).
async function fetchRoom(id) {
  try { return { room: await api.room(id), saved: true }; }
  catch (err) {
    const kept = keep.get(LOCAL.rooms, {})[id];
    if (!kept) throw err;
    try { await api.keepRoom(kept); return { room: kept, saved: true }; }
    catch { return { room: kept, saved: false }; }   // sent whole with each call instead
  }
}

async function loadRoom(id, { fresh } = {}) {
  const t0 = performance.now();
  let got = fresh ? { room: fresh, saved: true } : null;
  if (!got) {
    try { got = await fetchRoom(id); }
    catch (err) { if (id === DEFAULT_ROOM) throw err; toast(`That room is gone. Back to ${"your flat"}.`); got = await fetchRoom(DEFAULT_ROOM); }
  }
  const { room, saved } = got;
  // a new room: whatever was placed in the old one goes
  state.run++;
  viewer.clearPiece();
  viewer.clearFindings();
  viewer.setHidden([]);
  Object.assign(state, { room, saved, piece: null, placement: null, spot: 0, findings: [], fixed: null });
  closeFix(); undo.clear();
  $("verdict-building").hidden = true;
  $("verdict-dot").hidden = true;
  $("still").hidden = true;
  renderVerdict();
  showRoomFacts();
  keep.set(LOCAL.room, room.id);
  const url = new URL(location.href);
  if (room.id === DEFAULT_ROOM) url.searchParams.delete("room"); else url.searchParams.set("room", room.id);
  history.replaceState(null, "", url);
  layout();
  await viewer.setRoom(room);
  $("view").classList.add("ready");
  lookLoop(room);
  console.log(`[pocket-room] room ${room.id} ready ${Math.round(performance.now() - t0)} ms after the script ran, ${Math.round(performance.now())} ms after navigation`);
}

// A photo room's own furniture is rebuilt in 3D from its photos (item.piece). When each model is in, astra's
// work is checked: the model rendered on its own next to the crop it was built from (POST /pieces/:id/look).
// A model that doesn't look like it is rebuilt with what the check said, and checked again (two rebuilds at most).
const looked = new Set();
async function lookLoop(room) {
  if (room.source !== "photo" || !room.furniture?.some((i) => i.piece) || looked.has(room.id)) return;
  looked.add(room.id);
  try {
    let pieces = await viewer.loadItemModels(room);
    const checked = new Map();   // piece id → the model it was checked on: only new models are checked again
    for (let round = 0; round < 3 && state.room?.id === room.id; round++) {
      const todo = pieces.filter((p) => p.model?.how === "image_to_3d" && p.model?.glb && checked.get(p.id) !== p.model.glb && p.look?.glb !== p.model.glb && viewer.models.has(p.id));
      todo.forEach((p) => checked.set(p.id, p.model.glb));
      const results = await Promise.all(todo.map((p) => api.pieceLook(p.id, viewer.modelShot(p.id)).then((r) => ({ p, r })).catch(() => null)));
      if (state.room?.id !== room.id) return;
      const again = results.filter((x) => x?.r.rebuilding);
      console.log("[pocket-room] look check", round + 1, results.filter(Boolean).map((x) => `${x.p.name}: ${x.r.verdict} ${x.r.issues}`));
      if (!again.length) { if (round) toast("Your furniture is rebuilt to look like your photos.", 4000); return; }
      toast(`Checked against your photos. Rebuilding ${again.map((x) => x.p.name.toLowerCase()).join(", ")} to look more like them.`, 6000);
      pieces = await viewer.loadItemModels(room);
    }
  } catch (err) { console.warn("look check", err); }
}

function showRoomFacts() {
  const room = state.room, s = roomStats(room);
  $("room-name").textContent = room.name;
  $("room-pick-name").textContent = room.name;
  const u = unit();
  const dims = u === "ft" ? `${formatLength(s.W, "ft")} × ${formatLength(s.D, "ft")}` : `${s.W.toFixed(2)} × ${s.D.toFixed(2)} m`;
  $("room-meta").textContent = `${dims} · ${s.area.toFixed(1)} m² · ${room.height ?? 2.4} m ceiling · ${room.furniture?.length ?? 0} pieces`;
  const built = room.source !== "prebuilt";
  const sure = accuracyWords(room);
  $("room-sure").hidden = !built;
  $("room-sure").dataset.level = sure.level;
  $("room-sure-text").textContent = sure.say;
  const share = seenShare(room);
  $("room-unseen").hidden = !share;
  if (share) $("room-unseen-text").textContent = `Grey is what your photos didn't show (${Math.round((1 - share.walls) * 100)}% of the walls, ${Math.round((1 - share.floor) * 100)}% of the floor): a guess, not your room. Add photos from the other corners to fill it in.`;
  $("btn-fix-size").hidden = !built;
  $("btn-fix-size").textContent = sure.level === "exact" ? "Change the size" : "Fix the size";
  $("size-form").hidden = true;
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
  const busyEl = $("findings-busy");
  busyEl.lastChild.textContent = state.piece ? " Checking the room with it in…" : " Checking your room: walkways, doors, light, flow…";
  busyEl.hidden = false;
  renderVerdict();
  try {
    const spot = state.piece ? spotOf(state.placement, state.spot) : null;
    const { findings } = await withRoom(() => api.analyse(analyseBody(state.room, state.piece, spot, { saved: state.saved })));
    if (run !== state.run) return;   // the piece or spot changed meanwhile
    setFindings(withFixed(findings, state.fixed?.finding, state.fixed?.option));
    prefetchFixes(run);
  } finally {
    $("findings-busy").hidden = true;
    renderVerdict();
  }
}

$("btn-new-room").onclick = () => openNewRoom();
$("btn-fix-size").onclick = () => {
  const { width, depth } = roomSize(state.room), u = unit();
  $("fix-w").value = editLength(width, u);
  $("fix-d").value = editLength(depth, u);
  $("size-form").hidden = false;
  $("fix-w").focus();
};
$("fix-cancel").onclick = () => ($("size-form").hidden = true);
$("size-form").onsubmit = async (e) => {
  e.preventDefault();
  const u = unit(), width_m = parseLength($("fix-w").value, u), depth_m = parseLength($("fix-d").value, u);
  if (!width_m || !depth_m) return toast(`Type both walls, like ${u === "ft" ? "12' 6\"" : "3.80"}.`);
  const btn = e.submitter ?? $("size-form").querySelector("[type=submit]");
  btn.disabled = true;
  try {
    const room = await withRoom(() => api.resizeRoom(state.room.id, { width_m, depth_m }));
    keepRoom(room);
    await loadRoom(room.id, { fresh: room });
    toast(`Resized to ${formatLength(width_m, u)} × ${formatLength(depth_m, u)}.`);
  } catch (err) { toast(plain(err)); }
  btn.disabled = false;
};

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
  const [placement] = await Promise.all([withRoom(() => api.place(placeBody(state.room, piece, { saved: state.saved }))), viewer.showPiece(piece)]);
  if (run !== state.run) return;
  Object.assign(state, { piece, placement, spot: 0, findings: [], fixed: null });
  closeFix();
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
    let ready = await untilBuilt(piece, () => {});
    if (run !== state.run) return;
    state.piece = ready;
    if (ready.model?.glb) { await viewer.swapModel(ready); toast("The real 3D model is in."); }
    // astra checks its model against the picture it was built from; a wrong one is rebuilt (twice at most)
    for (let round = 0; round < 2 && ready.model?.glb && run === state.run; round++) {
      const look = await api.pieceLook(ready.id, viewer.modelShot(viewer.pieceObj)).catch(() => null);
      console.log("[pocket-room] look check", ready.name, look);
      if (!look?.rebuilding) break;
      toast(`Rebuilding the 3D model: ${look.issues}`, 6000);
      ready = await untilBuilt(await api.piece(ready.id), () => {});
      if (run !== state.run) return;
      state.piece = ready;
      if (ready.model?.glb) await viewer.swapModel(ready);
    }
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
      const out = await withRoom(() => api.find({ roomId: state.room.id, query: q, room: state.saved ? undefined : state.room }));
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
      const acts = li.querySelector(".acts"), was = [...acts.childNodes];
      const note = (html) => { const s = document.createElement("span"); s.innerHTML = html; acts.replaceChildren(s); };
      const box = { show: () => note(`<span class="spin small"></span>Putting it in your room…`), hide: () => acts.replaceChildren(...was) };
      box.show();
      try { await addPiece(async () => p, box); }
      catch (err) { box.hide(); toast(plain(err)); }
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
  if (f && !f.pass) return openFix(i);
  closeFix();
  document.querySelectorAll(".findings li").forEach((li, j) => li.classList.toggle("on", j === i));
  if (f?.at) viewer.focus(f.at, 1.4);
}

// ---------------------------------------------------------------- tap an issue → fixes (fixes/, POST /api/fixes)
// Asked for as soon as the room is checked, one finding after another, so a tap usually finds them ready.
const fixKey = (f) => `${state.run}|${f.id}|${f.at?.join(",") ?? ""}|${(f.items ?? []).join(",")}`;
function loadFixes(f) {
  const k = fixKey(f);
  if (!fixCache.has(k)) {
    const spot = state.piece ? spotOf(state.placement, state.spot) : null;
    const p = withRoom(() => api.fixes(fixBody(state.room, state.piece, spot, f, { saved: state.saved })));
    p.then((r) => { p.settled = r; }, () => fixCache.delete(k));
    fixCache.set(k, p);
  }
  return fixCache.get(k);
}
async function prefetchFixes(run) {
  for (const f of state.findings.filter((x) => !x.pass)) {
    if (run !== state.run) return;
    await loadFixes(f).catch(() => {});
  }
}

function openFix(i) {
  const f = state.findings[i];
  state.fixOpen = i;
  state.fixSel = null;
  renderVerdict();
  if (f.at) viewer.focus(f.at, 1.4);
  const li = document.querySelectorAll(".findings li")[i];
  li?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  const run = state.run;
  loadFixes(f).then((res) => {
    if (run !== state.run || state.fixOpen !== i) return;
    const best = res.options.find((o) => o.best) ?? res.options.find((o) => o.steps.length);
    if (best) selectFix(i, best.id); else renderVerdict();
  }).catch((err) => { if (state.fixOpen === i) { state.fixErr = plain(err); renderVerdict(); } });
}
function closeFix() {
  state.fixOpen = state.fixSel = state.fixErr = null;
  viewer.clearPreview();
}
async function selectFix(i, id) {
  state.fixSel = id;
  const res = await loadFixes(state.findings[i]);
  const opt = res.options.find((o) => o.id === id);
  renderVerdict();
  // the options and Apply in view (on a phone the sheet is short)
  const open = document.querySelector(".findings li.open");
  if (open) { open.scrollIntoView({ block: "start", behavior: "smooth" }); open.querySelector(".fix .row")?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
  if (opt?.steps.length) viewer.previewFix(previewMoves(state.room, opt, { pieceId: state.piece?.id, spot: spotOf(state.placement, state.spot), piece: state.piece }));
  else viewer.clearPreview();
}

// the fix panel under a finding: the options (the Decisions pick first), Apply / Cancel, or why there's none
function fixPanel(f, i) {
  const box = document.createElement("div");
  box.className = "fix";
  box.onclick = (e) => e.stopPropagation();
  const cached = fixCache.get(fixKey(f));
  const res = cached?.settled;
  if (state.fixErr) { box.innerHTML = `<p class="meta"></p>`; box.firstChild.textContent = state.fixErr; return box; }
  if (!res) {
    box.innerHTML = `<p class="meta"><span class="spin small"></span> Looking for a fix: trying moves and measuring every walkway…</p>`;
    cached?.then(() => { if (state.fixOpen === i && !state.fixSel) renderVerdict(); }).catch(() => {});
    return box;
  }
  if (!res.options.length) {
    box.innerHTML = `<p class="fix-none"></p><div class="row"><button class="btn small">Close</button></div>`;
    box.querySelector(".fix-none").textContent = res.none;
    box.querySelector("button").onclick = () => { closeFix(); renderVerdict(); };
    return box;
  }
  const list = document.createElement("div");
  list.className = "fix-opts";
  list.setAttribute("role", "radiogroup");
  for (const o of res.options) {
    const b = document.createElement("button");
    b.className = "fix-opt";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(o.id === state.fixSel));
    const usable = res.options.filter((x) => x.steps.length).length;
    const tag = o.best ? (res.decision?.by && res.decision.by !== "rules" && o.probability != null ? `Designer's pick · ${Math.round(o.probability * 100)}% sure` : usable > 1 ? "Smallest change" : "Checked fix") : o.kind === "shop" ? "Shopping hint" : "";
    b.innerHTML = `${tag ? `<em></em>` : ""}<span></span>`;
    if (tag) b.querySelector("em").textContent = tag;
    b.querySelector("span").textContent = o.say + (o.after_m != null ? ` The way becomes ${Math.round(o.after_m * 100)} cm.` : "");
    b.onclick = () => selectFix(i, o.id);
    list.append(b);
  }
  const sel = res.options.find((o) => o.id === state.fixSel);
  const row = document.createElement("div");
  row.className = "row";
  row.innerHTML = `<button class="btn primary small" data-act="apply">Apply</button><button class="btn small" data-act="cancel">Cancel</button>`;
  const apply = row.querySelector('[data-act="apply"]');
  apply.disabled = !sel?.steps.length;
  if (sel && !sel.steps.length) apply.textContent = "Nothing to apply";
  apply.onclick = () => applyOption(f, sel).catch((err) => toast(plain(err)));
  row.querySelector('[data-act="cancel"]').onclick = () => { closeFix(); renderVerdict(); };
  box.append(list, row);
  return box;
}

// Apply: the room changes in 3D, the room is checked again (and the piece's verdict), Undo for 8 s.
async function applyOption(f, opt) {
  const spot = state.piece ? spotOf(state.placement, state.spot) : null;
  undo.push({ room: state.room, saved: state.saved, placement: state.placement, fixed: state.fixed });
  const next = applyFix(state.room, opt, { pieceId: state.piece?.id, spot });
  closeFix();
  state.room = next.room;
  state.saved = false;                     // the server's copy is the room before the fix: send it whole
  state.fixed = { finding: f, option: opt };
  if (spot && next.spot !== spot) setSpot(next.spot);
  state.run++;
  setFindings([]);
  await viewer.updateItems(state.room);
  if (next.spot?.moved) viewer.movePiece(next.spot.at, next.spot.rot ?? 0);
  toast(`Done: ${opt.say}`, 8000, { label: "Undo", run: () => undoFix().catch((err) => toast(plain(err))) });
  await refreshPlacement();
  await checkRoom();
}

async function undoFix() {
  const prev = undo.pop();
  if (!prev) return;
  closeFix();
  Object.assign(state, { room: prev.room, saved: prev.saved, placement: prev.placement, fixed: prev.fixed });
  state.run++;
  setFindings([]);
  await viewer.updateItems(state.room);
  const spot = spotOf(state.placement, state.spot);
  if (state.piece && spot) viewer.movePiece(spot.at, spot.rot ?? 0);
  renderVerdict();
  await checkRoom();
}

// the spot on show, replaced (a fix moved the new piece)
function setSpot(spot) {
  const p = state.placement;
  const spots = [...(p.spots ?? [])];
  spots[state.spot] = spot;
  state.placement = { ...p, spots, best: state.spot === 0 ? spot : p.best };
}

// With a piece placed, its verdict comes from rules/ for the room as it is now: the same spot measured again.
async function refreshPlacement() {
  if (!state.piece || !state.placement) return;
  const spot = spotOf(state.placement, state.spot);
  const run = state.run;
  const fresh = await withRoom(() => api.place({ ...placeBody(state.room, state.piece, { saved: state.saved }), replace: spot?.replaces ?? false }));
  if (run !== state.run) return;
  const same = (fresh.spots ?? []).filter((s) => s.rot === spot.rot && Math.hypot(s.at[0] - spot.at[0], s.at[1] - spot.at[1]) < 0.15)
    .sort((a, b) => Math.hypot(a.at[0] - spot.at[0], a.at[1] - spot.at[1]) - Math.hypot(b.at[0] - spot.at[0], b.at[1] - spot.at[1]))[0];
  if (!same) return;
  const upd = { ...same, at: spot.at, rot: spot.rot, decision: spot.decision };
  setSpot(upd);
  if (state.spot === 0) state.placement = { ...state.placement, verdict: upd.verdict, say: verdictSay(upd) };
  dropColor(upd.verdict);
  renderVerdict();
}
const verdictSay = (s) => `${s.verdict}. ${s.wall ? `On the ${s.wall} wall` : "In the middle of the room"}${s.replaces ? ", replacing the old one" : ""}${s.blocked ? `, but a way beside it is still blocked (${Math.round(s.blocked.after_m * 100)} cm)` : s.reasons?.[1] ? `: ${s.reasons[s.reasons.length - 1].toLowerCase()}` : ""}.`;
function dropColor(verdict) { viewer.setFootprintColor?.(verdict); }

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
    const unseen = spot ? spot.unseen ?? spotUnseen(state.room, spot) : null;   // the server marks it; same rule as room/photo/seen.mjs
    $("verdict-unseen").hidden = !unseen || /in your photos/.test($("verdict-say").textContent);   // the sentence may say it already
    $("verdict-unseen").textContent = unseen === "wall" ? "That stretch of wall wasn't in your photos, so we can't vouch for it: check it's clear before you buy."
      : unseen ? "That part of the floor wasn't in your photos, so we can't vouch for it: check it's clear before you buy." : "";
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
    small.textContent = f.fixed ? "Fixed · tap Undo to put it back" : `${f.kind === "design" ? "Design" : "Rule"}${chance ? ` · ${chance}` : ""}${f.pass ? "" : " · tap for a fix"}`;
    li.querySelector("span").append(small);
    li.onclick = () => (state.fixOpen === i ? (closeFix(), renderVerdict()) : focusFinding(i));
    if (state.fixOpen === i) { li.classList.add("on", "open"); li.querySelector("span").append(fixPanel(f, i)); }
    return li;
  }));
}

$("btn-next").onclick = () => {
  const p = state.placement;
  if (!p?.spots?.length) return;
  state.spot = (state.spot + 1) % p.spots.length;
  state.run++;   // findings for the old spot no longer apply
  state.fixed = null; closeFix();
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
  Object.assign(state, { piece: null, placement: null, spot: 0, findings: [], fixed: null });
  closeFix();
  $("verdict-building").hidden = true;
  renderVerdict();
  show("add");
};

// ---------------------------------------------------------------- units (m or ft in), shared by every size field
const unit = () => keep.get(LOCAL.unit, "m");
function setUnit(u) {
  keep.set(LOCAL.unit, u);
  for (const seg of document.querySelectorAll("[data-units]"))
    for (const b of seg.querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.unit === u));
  const ph = u === "ft" ? ["12' 6\"", "17'"] : ["3.80", "5.20"];
  $("m-width").placeholder = ph[0]; $("m-depth").placeholder = ph[1];
  for (const id of ["fix-w", "fix-d"]) {   // convert what is typed
    const m = parseLength($(id).value, u === "ft" ? "m" : "ft");
    if (m) $(id).value = editLength(m, u);
  }
  if (state.room && $("size-form").hidden) showRoomFacts();
}
for (const seg of document.querySelectorAll("[data-units]")) seg.onclick = (e) => { const b = e.target.closest("[data-unit]"); if (b) setUnit(b.dataset.unit); };
setUnit(unit());

// ---------------------------------------------------------------- the room menu (header) and switching rooms
let menuOpen = false;
function closeMenu() {
  if (!menuOpen) return;
  menuOpen = false;
  $("room-menu").hidden = true;
  $("btn-rooms").setAttribute("aria-expanded", "false");
}
async function openMenu() {
  menuOpen = true;
  $("room-menu").hidden = false;
  $("btn-rooms").setAttribute("aria-expanded", "true");
  renderMenu(knownRooms());
  try {
    const out = await api.rooms();
    planOk = out.from_plan !== false;
    renderMenu(knownRooms(out.rooms));
  } catch {}
}
// the server's list, plus rooms this browser built that the server forgot
let serverRooms = [];
function knownRooms(list) {
  if (list) serverRooms = list;
  const all = new Map(serverRooms.map((r) => [r.id, r]));
  for (const r of Object.values(keep.get(LOCAL.rooms, {}))) if (!all.has(r.id)) all.set(r.id, { id: r.id, name: r.name, source: r.source });
  if (state.room && !all.has(state.room.id)) all.set(state.room.id, { id: state.room.id, name: state.room.name, source: state.room.source });
  return [...all.values()];
}
const FLAT_NAMES = { "hoskins-living": "Living room" };
function renderMenu(rooms) {
  const { flat, built } = sortRooms(rooms);
  const item = (r) => {
    const li = document.createElement("li"), b = document.createElement("button");
    b.textContent = FLAT_NAMES[r.id] && !/living/i.test(r.name) ? `${r.name}` : r.name;
    const small = document.createElement("small");
    small.textContent = r.source === "photo" ? "from photos" : r.source === "floorplan" ? "from a plan" : "";
    b.append(small);
    b.setAttribute("aria-current", String(r.id === state.room?.id));
    b.onclick = () => switchRoom(r.id);
    li.append(b);
    return li;
  };
  $("menu-flat").replaceChildren(...flat.map(item));
  $("menu-built").replaceChildren(...built.map(item));
  $("menu-built-group").hidden = !built.length;
}
async function switchRoom(id) {
  closeMenu();
  if (id === state.room?.id) return;
  $("view").classList.remove("ready");
  $("loading-text").textContent = "Opening the room…";
  try { await loadRoom(id); show("room"); }
  catch (err) { toast(plain(err)); $("view").classList.add("ready"); }
}
$("btn-rooms").onclick = (e) => { e.stopPropagation(); menuOpen ? closeMenu() : openMenu(); };
$("menu-new").onclick = () => { closeMenu(); openNewRoom(); };
document.addEventListener("click", (e) => { if (menuOpen && !e.target.closest("#room-menu")) closeMenu(); });
addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });

// ---------------------------------------------------------------- New room: photos from the corners, or a plan
const newBusy = busyBox("new");
const shots = [];          // { file, url (thumbnail), data (JPEG data URL, made once) }
let retakeAt = null;       // a thumbnail tapped: the next photo replaces it
let planOk = true;         // the server can read plans (needs the local plan reader)
let lastTab = "room";

function openNewRoom() {
  lastTab = document.querySelector(".tabs [aria-current=page]")?.dataset.tab ?? "room";
  show("new");
  newBusy.hide();
  $("new-planrooms").hidden = true;
  setMode("photos");
  renderShots();
  api.rooms().then((out) => { planOk = out.from_plan !== false; renderPlanNote(); serverRooms = out.rooms ?? serverRooms; }).catch(() => {});
}
for (const b of document.querySelectorAll("[data-cancel]")) b.onclick = () => show(lastTab === "new" ? "room" : lastTab);

function setMode(mode) {
  for (const b of $("new-modes").querySelectorAll("button")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  $("new-photos").hidden = mode !== "photos";
  $("new-plan").hidden = mode !== "plan";
  renderPlanNote();
}
$("new-modes").onclick = (e) => { const b = e.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode); };

function renderPlanNote() {
  $("plan-tile").setAttribute("aria-disabled", String(!planOk));
  $("plan-in").disabled = !planOk;
  $("plan-note").textContent = planOk
    ? "We trace the walls and doors and scale them by the doors (about ±10%). Then fix the size by typing two walls if you know them."
    : "Plans are read by a tool that runs on Kate's laptop, not on this server. Use photos of the room here.";
}

// the guide: the room from above, corners done in green, the next one dark with the way to aim
function renderGuide(next) {
  const P = [[14, 86], [14, 14], [86, 14], [86, 86]];   // CORNERS order: near-left, far-left, far-right, near-right
  const done = Math.min(shots.length, CORNERS.length);
  let svg = `<rect class="cg-room" x="14" y="14" width="72" height="72" rx="2"/>`;
  if (next != null) {
    const [x, y] = P[next], [tx, ty] = P[(next + 2) % 4];
    const nx = (tx - x) / Math.hypot(tx - x, ty - y), ny = (ty - y) / Math.hypot(tx - x, ty - y);
    const L = 44, sp = 0.5;   // a cone of view
    const c = Math.cos(sp), s = Math.sin(sp);
    const a1 = [x + L * (nx * c - ny * s), y + L * (nx * s + ny * c)], a2 = [x + L * (nx * c + ny * s), y + L * (-nx * s + ny * c)];
    svg += `<path class="cg-cone" d="M${x} ${y}L${a1}L${a2}Z"/><path class="cg-ray" d="M${x} ${y}L${x + nx * 52} ${y + ny * 52}"/>`;
  }
  P.forEach(([x, y], i) => { svg += `<circle class="cg-dot ${i < done ? "done" : i === next ? "next" : ""}" cx="${x}" cy="${y}" r="${i === next ? 8 : 6}"/>`; });
  $("corner-guide").innerHTML = svg;
}

function renderShots() {
  const n = retakeAt ?? shots.length;
  const shot = retakeAt != null ? { title: `Retake photo ${retakeAt + 1}`, say: CORNERS[retakeAt]?.say ?? "Take it again from the same spot.", corner: retakeAt < 4 ? retakeAt : null } : nextShot(n);
  $("shot-title").textContent = shot.title;
  $("shot-say").textContent = shot.say;
  renderGuide(shot.corner);
  $("shot-camera").querySelector("span").textContent = retakeAt != null ? "Retake" : shots.length ? "Next photo" : "Take photo";
  $("btn-build").disabled = !shots.length;
  $("btn-build").textContent = shots.length && shots.length < 3 ? `Build from ${shots.length} photo${shots.length > 1 ? "s" : ""}` : "Build my room";
  $("thumbs").replaceChildren(...shots.map((s, i) => {
    const li = document.createElement("li");
    li.innerHTML = `<img alt="Photo ${i + 1}" title="Tap to retake"><b>${i + 1}</b><button type="button" aria-label="Remove photo ${i + 1}">×</button>`;
    li.querySelector("img").src = s.url;
    li.querySelector("img").onclick = () => { retakeAt = retakeAt === i ? null : i; renderShots(); if (retakeAt != null) $("room-camera").click(); };
    li.querySelector("button").onclick = () => { URL.revokeObjectURL(s.url); shots.splice(i, 1); retakeAt = null; renderShots(); };
    if (retakeAt === i) li.querySelector("img").style.outline = "3px solid var(--fg)";
    return li;
  }));
}

function addShots(files) {
  for (const file of files) {
    if (!file || !/^image\//.test(file.type || "image/")) continue;
    const shot = { file, url: URL.createObjectURL(file) };
    if (retakeAt != null) { URL.revokeObjectURL(shots[retakeAt].url); shots[retakeAt] = shot; retakeAt = null; }
    else if (shots.length < MAX_PHOTOS) shots.push(shot);
    else { toast(`${MAX_PHOTOS} photos is the most we read.`); break; }
  }
  renderShots();
}
$("room-camera").onchange = (e) => { addShots([...e.target.files]); e.target.value = ""; };
$("room-upload").onchange = (e) => { retakeAt = null; addShots([...e.target.files]); e.target.value = ""; };

// what the user measured: { width_m?, depth_m? }, or an error to show
function measured() {
  const u = unit(), out = {};
  for (const [id, k] of [["m-width", "width_m"], ["m-depth", "depth_m"]]) {
    const t = $(id).value.trim();
    if (!t) continue;
    const v = parseLength(t, u);
    if (!v || v < 1 || v > 40) return { error: `Can't read "${t}" as a wall length. Try ${u === "ft" ? "12' 6\"" : "3.80"}.` };
    out[k] = v;
  }
  return out;
}

$("btn-build").onclick = async () => {
  const known = measured();
  if (known.error) return toast(known.error);
  const name = $("new-name").value.trim() || undefined;
  const go = async () => {
    const t0 = performance.now();
    try {
      newBusy.show(PHOTO_STEPS[0][1], `${shots.length} photo${shots.length > 1 ? "s" : ""}${known.width_m || known.depth_m ? " and your measurements" : ""}.`, { img: shots[0].url });
      for (const s of shots) s.data ??= await imageToDataURL(s.file, 1280);   // ~0.25 MB each
      newBusy.show(PHOTO_STEPS[0][1], "Looking for doors, bricks and chairs to measure by.", { img: shots[0].url, steps: [] });
      stepWords(PHOTO_STEPS, t0);
      const room = await api.fromPhoto(shots.map((s) => s.data), { ...known }, name);
      await roomIsIn(room, t0);
      for (const s of shots) URL.revokeObjectURL(s.url);
      shots.length = 0;
      $("m-width").value = $("m-depth").value = $("new-name").value = "";
      $("measured").open = false;
    } catch (err) { stopSteps(); newBusy.fail(err, go); }
  };
  await go();
};

// the big words move on while the server reads
let stepTimers = [];
function stepWords(steps, t0) {
  stopSteps();
  const step = $("new-busy").querySelector(".busy-step");
  for (const [ms, text] of steps) stepTimers.push(setTimeout(() => (step.textContent = text), Math.max(0, ms - (performance.now() - t0))));
}
const stopSteps = () => { stepTimers.forEach(clearTimeout); stepTimers = []; };

async function roomIsIn(room, t0) {
  stopSteps();
  newBusy.show("Building it in 3D…", room.name, {});
  keepRoom(room);
  $("view").classList.remove("ready");
  $("loading-text").textContent = "Building your room…";
  await loadRoom(room.id, { fresh: room });
  newBusy.hide();
  show("room");
  const secs = ((performance.now() - t0) / 1000).toFixed(0);
  toast(`Your room is in${secs >= 2 ? `, ${secs} s` : ""}. ${accuracyWords(room).say}`, 5200);
  console.log(`[pocket-room] new room ${room.id} in ${secs} s, accuracy ±${room.accuracy_m} m`, room._derived);
}

// a plan: one picture; when it holds several rooms, ask which
$("plan-in").onchange = async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  let image;
  planList = [];
  const go = async (pick) => {
    const t0 = performance.now();
    try {
      $("new-planrooms").hidden = true;
      show("new");
      const url = URL.createObjectURL(file);
      newBusy.show(PLAN_STEPS[0][1], "Floor plans take 15–30 seconds the first time.", { img: url });
      image ??= /^image\/(png|jpeg|webp)$/.test(file.type) && file.size < 3e6 ? await fileAsDataURL(file) : await imageToDataURL(file, 2000);
      stepWords(PLAN_STEPS, t0);
      const room = await api.fromPlan(image, pick, planName(pick));
      await roomIsIn(room, t0);
      if (!pick && (room._plan_rooms ?? []).length > 1) offerPlanRooms(room, go);
    } catch (err) { stopSteps(); newBusy.fail(err, () => go(pick)); }
  };
  await go();
};

// "Room from your plan" (the first), "Room 2 from your plan, 24 m²" (one picked from the list)
let planList = [];
function planName(pick) {
  const i = planList.findIndex((r) => r.id === pick);
  return i < 0 ? "Room from your plan" : `Room ${i + 1} from your plan, ${Math.round(planList[i].area_m2)} m²`;
}

// the plan held several rooms and we took the largest: is that the one?
function offerPlanRooms(room, go) {
  const list = (room._plan_rooms ?? []).filter((r) => r.picked || r.area_m2 >= 2).sort((a, b) => b.area_m2 - a.area_m2);   // slivers out
  planList = list;
  const picked = list.find((r) => r.picked);
  show("new");
  $("new-pick").hidden = true;
  $("new-planrooms").hidden = false;
  $("new-planrooms").querySelector(".meta").textContent =
    `The plan has ${list.length} rooms. This is the largest${picked ? ` (${Math.round(picked.area_m2)} m²)` : ""}. Is it the one you want?`;
  const yes = document.createElement("button");
  yes.className = "chip-btn";
  yes.textContent = "Yes, this one";
  yes.onclick = () => { $("new-planrooms").hidden = true; $("new-pick").hidden = false; show("room"); };
  $("planroom-chips").replaceChildren(yes, ...list.map((r, i) => [r, i]).filter(([r]) => !r.picked).map(([r, i]) => {
    const b = document.createElement("button");
    b.className = "chip-btn";
    b.textContent = `Room ${i + 1} · ${Math.round(r.area_m2)} m²`;
    b.onclick = () => go(r.id);
    return b;
  }));
}

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
  await loadRoom(params.get("room") || keep.get(LOCAL.room, null) || DEFAULT_ROOM);
} catch (err) {
  $("loading-text").textContent = `Couldn't load the room: ${plain(err)}`;
  throw err;
}
if (params.has("shared")) await takeShared();
else if (params.get("tab")) show(params.get("tab"));
