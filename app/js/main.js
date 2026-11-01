// Pocket Room app: the screens (My room · New room · Add piece · Find for me · Verdict · Talk) round the 3D view.
// Works against the API in contract/api.md.
import { firstPaint } from "./kit/real.js";
import { Viewer } from "./viewer.js";
import { api, untilBuilt, imageToDataURL } from "./api.js";
import { roomStats } from "./room3d.js";
import { spotOf, hiddenIds, analyseBody, placeBody, chanceWords, sizeCm } from "./scene-state.js";
import { resizeRoom, removeItem, dims, parseLength, feetInches, sureWords, bothMeasured, LIMITS } from "./room-edit.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const DEFAULT_ROOM = "hoskins-living";
const ROOM_ID = params.get("room") || DEFAULT_ROOM;
const desktop = matchMedia("(min-width: 900px)");

// saved: the server keeps this room as it is (the prebuilt flat). Rooms built here go whole in each call, so an
// edit, a server restart or another server instance never loses them. revs: edits per room (Find's cache).
const state = { room: null, saved: true, piece: null, placement: null, spot: 0, findings: [], run: 0, revs: {}, list: [] };

await firstPaint();
const viewer = new Viewer($("view"), $("labels"));
window.pocketRoom = { viewer, state, draft: () => draft, setFindings: (f) => { setFindings(f); renderVerdict(); } };   // for the console and tests

// ---------------------------------------------------------------- tabs and sheet
const sheet = $("sheet");
function show(tab) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = s.dataset.screen !== tab;
  const tabOf = tab === "newroom" ? "room" : tab;   // New room opens from My room
  for (const b of document.querySelectorAll(".tabs button")) {
    if (b.dataset.tab === tabOf) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  }
  sheet.classList.remove("folded");
  if (tab === "verdict") $("verdict-dot").hidden = true;
  sheet.scrollTop = 0;
  layout();
}
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-tab]");
  if (!b) return;
  const current = !document.querySelector(`.screen[data-screen="${b.dataset.tab}"]`).hidden;
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
    // steps: [[ms, text, heading?], ...] move the sub line (and the heading) on while the call runs
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
      for (const [ms, t, head] of steps ?? []) timers.push(setTimeout(() => { sub.textContent = t; if (head) step.textContent = head; }, ms));
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
const addBusy = busyBox("add"), findBusy = busyBox("find"), roomBusy = busyBox("newroom");

// ---------------------------------------------------------------- header tools
$("btn-names").onclick = (e) => {
  const on = e.currentTarget.getAttribute("aria-pressed") !== "true";
  e.currentTarget.setAttribute("aria-pressed", String(on));
  viewer.showNames(on);
};
$("btn-home").onclick = () => viewer.home(true);

// ---------------------------------------------------------------- My room
// rooms built in this browser, kept so a reload or a restarted server still has them
const BUILT_KEY = "pocket-room:built";
function builtRooms() {
  try { return JSON.parse(localStorage.getItem(BUILT_KEY)) || {}; } catch { return {}; }
}
function keepBuilt(room) {
  try { localStorage.setItem(BUILT_KEY, JSON.stringify({ ...builtRooms(), [room.id]: room })); } catch {}
}
function forgetBuilt(id) {
  try { const all = builtRooms(); delete all[id]; localStorage.setItem(BUILT_KEY, JSON.stringify(all)); } catch {}
}
const isBuilt = (room) => room && room.source !== "prebuilt";

// the server's copy, else this browser's (sent back to the server so place / find / analyse know it by id too)
async function fetchRoom(id) {
  const local = builtRooms()[id];
  try {
    const room = await api.room(id);
    return local && isBuilt(room) ? local : room;   // this browser's edits are the latest
  } catch (err) {
    if (!local) throw err;
    api.saveRoom(local).catch(() => {});
    return local;
  }
}

async function loadRoom(id = ROOM_ID) {
  const t0 = performance.now();
  let room;
  try { room = await fetchRoom(id); }
  catch (err) { if (id === DEFAULT_ROOM) throw err; toast("That room isn't here any more. Showing the living room."); room = await fetchRoom(DEFAULT_ROOM); }
  await openRoom(room);
  console.log(`[pocket-room] room ready ${Math.round(performance.now() - t0)} ms after the script ran, ${Math.round(performance.now())} ms after navigation`);
}

// Make a room "my room": the 3D, the sheet, the switcher; any piece on show goes (it was placed in the old room).
async function openRoom(room, { keepView = false } = {}) {
  state.run++;
  Object.assign(state, { room, saved: !isBuilt(room), piece: null, placement: null, spot: 0, findings: [] });
  viewer.clearPiece();
  viewer.clearFindings();
  viewer.setHidden([]);
  $("verdict-building").hidden = true;
  if (!keepView) $("still").hidden = true;
  if (isBuilt(room)) keepBuilt(room);
  if (!state.list.some((r) => r.id === room.id)) state.list.push({ id: room.id, name: room.name, source: room.source });
  renderRoomInfo();
  renderSwitcher();
  renderVerdict();
  const q = new URLSearchParams(location.search);
  if (room.id === DEFAULT_ROOM) q.delete("room"); else q.set("room", room.id);
  q.delete("tab");
  history.replaceState(null, "", `${location.pathname}${q.size ? `?${q}` : ""}`);
  layout();
  await viewer.setRoom(room, { keepView });
  $("view").classList.add("ready");
}

const m2 = (v) => `${v.toFixed(2)} m`;
function renderRoomInfo() {
  const room = state.room, s = roomStats(room), d = dims(room);
  $("room-name").textContent = room.name;
  const n = (room.furniture?.length ?? 0) + (room.fixtures?.length ?? 0);
  $("room-meta").textContent = `${s.W.toFixed(2)} × ${s.D.toFixed(2)} m (${feetInches(s.W)} × ${feetInches(s.D)}) · ${s.area.toFixed(1)} m² · ${d.height.toFixed(2)} m ceiling · ${n} ${n === 1 ? "piece" : "pieces"}`;
  const built = isBuilt(room);
  const sure = sureWords(room);
  $("room-sure").hidden = !built || !sure.text;
  $("room-sure").className = `sure ${sure.level}`;
  $("room-sure").querySelector(".sure-text").textContent = `Size ${sure.text}`;
  $("room-nudge").hidden = !built || !sure.nudge;
  $("room-nudge").querySelector("p").textContent = sure.nudge;
  $("nudge-photo").hidden = room.source !== "photo";
  $("room-fix").hidden = !built;
  if (built) renderFix();
  renderPlanRooms();
}

// ---------------------------------------------------------------- room switcher
const shortName = (r) => r.name.replace(/, Hoskins Street$/, "").replace(/ \(from (photo|plan)\)$/, "");
function renderSwitcher() {
  const el = $("room-switch");
  const add = document.createElement("button");
  add.className = "new";
  add.textContent = "+ New room";
  add.onclick = () => startNewRoom();
  // rooms built here first (newest first, next to "New room"), then the flat
  const rooms = [...state.list.filter((r) => r.source !== "prebuilt").reverse(), ...state.list.filter((r) => r.source === "prebuilt")];
  // the same room built twice gets a number: "Room r0", "Room r0 · 2"
  const seenName = {};
  const label = new Map([...rooms].reverse().map((r) => { const n = shortName(r); seenName[n] = (seenName[n] ?? 0) + 1; return [r.id, seenName[n] > 1 ? `${n} · ${seenName[n]}` : n]; }));
  const chips = rooms.map((r) => {
    const b = document.createElement("button");
    b.setAttribute("role", "listitem");
    b.textContent = label.get(r.id);
    b.title = r.name;
    if (r.source !== "prebuilt") b.classList.add("built");
    if (r.id === state.room?.id) b.setAttribute("aria-current", "true");
    b.onclick = async () => {
      if (r.id === state.room?.id) return;
      try { await openRoom(await fetchRoom(r.id)); } catch (err) { toast(plain(err)); }
    };
    return b;
  });
  el.replaceChildren(add, ...chips);
  el.querySelector('[aria-current="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

async function loadRoomList() {
  let server = [];
  try { ({ rooms: server } = await api.rooms()); } catch {}
  const local = Object.values(builtRooms()).map(({ id, name, source }) => ({ id, name, source }));
  const seen = new Set();
  state.list = [...server, ...local, ...state.list].filter((r) => !seen.has(r.id) && seen.add(r.id));
  renderSwitcher();
}

// ---------------------------------------------------------------- fix the room (code only: no model call)
const STEP = { width: 0.1, depth: 0.1, height: 0.05 };
function renderFix() {
  const d = dims(state.room);
  for (const el of document.querySelectorAll(".stepper")) {
    const k = el.dataset.dim, input = el.querySelector("input");
    if (document.activeElement !== input) input.value = d[k].toFixed(2);
    el.querySelector("small").textContent = feetInches(d[k]);
    el.querySelector('[data-d="-1"]').disabled = d[k] <= LIMITS[k][0];
    el.querySelector('[data-d="1"]').disabled = d[k] >= LIMITS[k][1];
  }
  $("fix-measured").checked = bothMeasured(state.room);
  const items = [...(state.room.furniture ?? []), ...(state.room.fixtures ?? [])];
  $("objs-lead").textContent = items.length ? `What the ${state.room.source === "floorplan" ? "plan" : "photo"} found (tap × to take out a wrong one):` : "No furniture in this room yet.";
  $("objs").replaceChildren(...items.map((it) => {
    const li = document.createElement("li");
    li.innerHTML = `<span></span><small></small><button aria-label="Take it out">×</button>`;
    li.querySelector("span").textContent = it.name;
    li.querySelector("small").textContent = sizeCm(it.size.slice(0, 2));
    li.querySelector("button").onclick = () => { editRoom(removeItem(state.room, it.id)); toast(`${it.name} taken out.`); };
    return li;
  }));
}

let saveTimer;
async function editRoom(room) {
  state.revs[room.id] = (state.revs[room.id] ?? 0) + 1;
  await openRoom(room, { keepView: true });
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.saveRoom(state.room).catch((e) => console.warn("[pocket-room] room not saved on the server:", e.message)), 500);
}
const measuredNow = () => ($("fix-measured").checked ? ["width", "depth"] : []);
$("steppers").addEventListener("click", (e) => {
  const b = e.target.closest(".step");
  if (!b) return;
  const k = b.closest(".stepper").dataset.dim;
  const v = Math.round((dims(state.room)[k] + Number(b.dataset.d) * STEP[k]) * 100) / 100;
  editRoom(resizeRoom(state.room, { [k]: v }, { measured: measuredNow() }));
});
$("steppers").addEventListener("change", (e) => {
  const input = e.target.closest("input");
  if (!input) return;
  const k = input.closest(".stepper").dataset.dim, v = parseLength(input.value, "m");
  if (v) editRoom(resizeRoom(state.room, { [k]: v }, { measured: measuredNow() }));
  else { input.value = dims(state.room)[k].toFixed(2); toast("Type a size in metres, like 4.2."); }
  input.blur();
});
$("fix-measured").onchange = () => editRoom(resizeRoom(state.room, {}, { measured: measuredNow() }));
$("nudge-measure").onclick = () => {
  $("room-fix").open = true;
  $("room-fix").scrollIntoView({ behavior: "smooth", block: "start" });
  setTimeout(() => $("steppers").querySelector("input")?.focus(), 350);
  toast("Type the width and length you measured, then tick “I measured”.", 4500);
};
$("nudge-photo").onclick = () => { startNewRoom({ more: true }); $("in-room").click(); };

// a plan with more than one room: build another one from the same plan (the pipeline caches it: instant)
const planImages = {};   // room id → the plan it came from (kept in memory only)
const roomPhotos = {};   // room id → its first photo, for Photo view (memory only)
function renderPlanRooms() {
  const box = $("plan-rooms"), room = state.room, plan = planImages[room.id];
  const others = (room._plan_rooms ?? []).filter((r) => !r.picked && r.area_m2 >= 2);
  box.hidden = !plan || !others.length;
  if (box.hidden) return;
  box.querySelector(".chips").replaceChildren(...others.map((r) => {
    const b = document.createElement("button");
    b.className = "chip-btn";
    b.textContent = `${r.id.toUpperCase()} · ${r.area_m2.toFixed(0)} m²`;
    b.onclick = async () => {
      b.disabled = true;
      try {
        const next = await api.fromPlan({ image: plan, room: r.id });
        planImages[next.id] = plan;
        await openRoom(next);
      } catch (err) { toast(plain(err)); b.disabled = false; }
    };
    return b;
  }));
}

// ---------------------------------------------------------------- New room
// draft: up to 4 room photos (JPEG data URLs) or one plan; replaces = the room these photos built before
const draft = { photos: [], plan: null, replaces: null, unit: "m" };
const MAX_SHOTS = 4;
let options = { photo: true, plan: false };
api.roomOptions().then((o) => { options = o; $("plan-entry").hidden = !o.plan; }).catch(() => {});

function startNewRoom({ more = false } = {}) {
  if (!more || draft.replaces !== state.room?.id) {
    // a new room starts from an empty form (the last room's measurements would stretch this one)
    Object.assign(draft, { photos: [], plan: null, replaces: null });
    for (const id of ["m-width", "m-depth", "room-name-in"]) $(id).value = "";
    for (const id of ["m-width", "m-depth"]) readMeasured(id);
    $("measured").open = false;
  }
  if (more && isBuilt(state.room)) $("room-name-in").value = state.room.name.replace(/ \(from (photo|plan)\)$/, "");
  roomBusy.hide();
  renderDraft();
  show("newroom");
}

function renderDraft() {
  const shots = draft.photos.map((src, i) => {
    const d = document.createElement("div");
    d.className = "shot";
    d.innerHTML = `<img alt="Room photo ${i + 1}"><b>${i + 1}</b><button aria-label="Remove photo ${i + 1}">×</button>`;
    d.querySelector("img").src = src;
    d.querySelector("button").onclick = () => { draft.photos.splice(i, 1); renderDraft(); };
    return d;
  });
  const add = $("add-shot");
  add.hidden = !!draft.plan || draft.photos.length >= MAX_SHOTS;
  add.querySelector("span").textContent = draft.photos.length ? "Another corner" : "Take or add photos";
  $("shots").replaceChildren(...shots, add);
  $("shots").hidden = !!draft.plan;
  $("plan-pick").hidden = !draft.plan;
  if (draft.plan) $("plan-pick").querySelector("img").src = draft.plan;
  $("plan-entry").hidden = !options.plan || !!draft.plan;
  $("btn-build").disabled = !draft.photos.length && !draft.plan;
  $("btn-build").textContent = draft.plan ? "Build from the plan" : draft.photos.length > 1 ? `Build from ${draft.photos.length} photos` : "Build my room";
}

$("in-room").onchange = async (e) => {
  const files = [...e.target.files].slice(0, MAX_SHOTS - draft.photos.length);
  e.target.value = "";
  if (e.target.files.length > files.length) toast(`Up to ${MAX_SHOTS} photos; we kept the first ${files.length}.`);
  draft.plan = null;
  for (const f of files) {
    try { draft.photos.push(await imageToDataURL(f, 1280)); } catch { toast("That file isn't a photo we can read."); }
    renderDraft();
  }
};
$("in-plan").onchange = async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try { draft.plan = await imageToDataURL(f, 2000); draft.photos = []; } catch { toast("That file isn't a picture we can read."); }
  renderDraft();
};
$("plan-clear").onclick = () => { draft.plan = null; renderDraft(); };
$("btn-newroom-cancel").onclick = () => show("room");

// measured walls: metres or feet and inches
const unitButtons = document.querySelectorAll(".units button");
for (const b of unitButtons) b.onclick = () => {
  draft.unit = b.dataset.unit;
  unitButtons.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  for (const id of ["m-width", "m-depth"]) { $(id).placeholder = draft.unit === "ft" ? `e.g. ${id === "m-width" ? "13' 9\"" : "11' 10\""}` : `e.g. ${id === "m-width" ? "4.2" : "3.6"}`; readMeasured(id); }
};
function readMeasured(id) {
  const input = $(id), small = input.nextElementSibling, text = input.value.trim();
  const v = parseLength(text, draft.unit);
  const ok = v && v >= LIMITS.width[0] && v <= LIMITS.width[1];
  small.className = text && !ok ? "bad" : "";
  small.textContent = !text ? "" : ok ? `= ${m2(v)} (${feetInches(v)})` : draft.unit === "ft" ? "Type it like 13' 9\" or 13 9" : "Type it in metres, like 4.2";
  return ok ? v : null;
}
for (const id of ["m-width", "m-depth"]) $(id).oninput = () => readMeasured(id);

$("btn-build").onclick = async () => {
  const width = readMeasured("m-width"), depth = readMeasured("m-depth");
  const name = $("room-name-in").value.trim() || undefined;
  const plan = draft.plan, photos = [...draft.photos], replaces = draft.replaces;
  const go = async () => {
    const t0 = performance.now();
    try {
      let room;
      if (plan) {
        roomBusy.show("Reading the plan…", "Tracing the walls and doors…", { img: plan, steps: [
          [5000, "Sizing it from the door widths…"], [10000, "Turning the trace into walls…", "Building your room…"], [30000, "Still tracing: a big plan takes longer…"]] });
        room = await api.fromPlan({ image: plan, name });
        planImages[room.id] = plan;
        // a wall the reader taped pins the scale (code, not the model)
        const measured = [width && "width", depth && "depth"].filter(Boolean);
        if (measured.length) {
          room = resizeRoom(room, { width: width ?? undefined, depth: depth ?? undefined }, { measured });
          api.saveRoom(room).catch(() => {});
        }
      } else {
        const n = photos.length;
        roomBusy.show("Reading the walls…", `${n === 1 ? "One photo" : `${n} photos`}: counting door widths, bricks and chairs along each wall…`, { img: photos[0], steps: [
          [5000, "Finding the doors, windows and big furniture…"], [10000, "Turning the counts into metres…", "Building your room…"],
          [17000, "Putting the furniture in…"], [30000, "Still reading: more photos take a little longer…"]] });
        const hint = width || depth ? { width_m: width ?? undefined, depth_m: depth ?? undefined } : undefined;
        room = await api.fromPhoto({ images: photos, hint, name });
        roomPhotos[room.id] = photos[0];
      }
      const secs = Math.round((performance.now() - t0) / 100) / 10;
      console.log(`[pocket-room] built ${room.id} in ${secs} s (${plan ? "plan" : `${photos.length} photo${photos.length > 1 ? "s" : ""}`}), ±${room.accuracy_m} m`);
      if (replaces && replaces !== room.id) {   // more photos of the same room: the new build takes its place
        forgetBuilt(replaces);
        state.list = state.list.filter((r) => r.id !== replaces);
      }
      Object.assign(draft, { replaces: plan ? null : room.id });
      await openRoom(room);
      roomBusy.hide();
      show("room");
      toast(`Built in ${secs} s. Turn it with a finger; fix the size below if it's off.`, 5000);
    } catch (err) { roomBusy.fail(err, go); }
  };
  await go();
};

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
    // a room built from photos lends its own first photo, so the picture keeps its real floor and walls
    const { image } = await api.render(state.room.id, viewer.snapshot(), undefined, roomPhotos[state.room.id]);
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
const searched = new Set();
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
      // an edited room keeps its id: ask afresh the first time after an edit, not the cached answer
      const key = `${state.room.id}:${state.revs[state.room.id] ?? 0}:${q.trim().toLowerCase()}`;
      const fresh = (state.revs[state.room.id] ?? 0) > 0 && !searched.has(key);
      const out = await api.find({ roomId: state.room.id, query: q, room: state.saved ? undefined : state.room, fresh: fresh || undefined });
      searched.add(key);
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
  loadRoomList();
} catch (err) {
  $("loading-text").textContent = `Couldn't load the room: ${plain(err)}`;
  throw err;
}
if (params.has("shared")) await takeShared();
else if (params.get("tab") === "newroom") startNewRoom();
else if (params.get("tab")) show(params.get("tab"));
