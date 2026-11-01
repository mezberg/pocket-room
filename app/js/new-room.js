// The "New room" flow's words and numbers. Pure functions (no DOM, no three.js), tested in node.

// The corner shots, in order round the room (clockwise, photo 1 from a corner of the near wall).
export const CORNERS = [
  { say: "Stand in a corner, back to the wall, and aim at the opposite corner.", at: [0, 0] },
  { say: "Walk to the next corner on your left. Aim across the room again.", at: [0, 1] },
  { say: "Next corner along. Same again: floor and ceiling both in frame.", at: [1, 1] },
  { say: "Last corner. Now the room is seen from every side.", at: [1, 0] },
];
export const MAX_PHOTOS = 6;

// What to show for the next shot: n photos taken so far.
export function nextShot(n) {
  if (n >= CORNERS.length) return { title: `${n} photos. That's plenty`, say: "Build the room, or retake any photo by tapping it.", corner: null };
  const c = CORNERS[n];
  return { title: `Photo ${n + 1} of ${CORNERS.length}`, say: c.say, corner: n };
}

/**
 * A length typed by hand -> metres, or null. unit "m" or "ft". Takes "3.8", "3,8 m", "380 cm",
 * "12' 6\"", "12ft 6in", "12 6" (ft), "150 in". A unit in the text wins over the picker.
 */
export function parseLength(text, unit = "m") {
  const s = String(text ?? "").trim().toLowerCase().replace(/,/g, ".").replace(/[’′]/g, "'").replace(/[”″]/g, '"');
  if (!s) return null;
  let m;
  if ((m = /^(\d+(?:\.\d+)?)\s*(?:'|ft|feet|foot)\s*(?:(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)?)?$/.exec(s))) return round((+m[1] * 12 + +(m[2] ?? 0)) * 0.0254);
  if ((m = /^(\d+(?:\.\d+)?)\s*(?:"|in|inch|inches)$/.exec(s))) return round(+m[1] * 0.0254);
  if ((m = /^(\d+(?:\.\d+)?)\s*cm$/.exec(s))) return round(+m[1] / 100);
  if ((m = /^(\d+(?:\.\d+)?)\s*mm$/.exec(s))) return round(+m[1] / 1000);
  if ((m = /^(\d+(?:\.\d+)?)\s*m$/.exec(s))) return round(+m[1]);
  if (unit === "ft" && (m = /^(\d+(?:\.\d+)?)(?:\s+(\d+(?:\.\d+)?))?$/.exec(s))) return round((+m[1] * 12 + +(m[2] ?? 0)) * 0.0254);
  if ((m = /^(\d+(?:\.\d+)?)$/.exec(s))) return round(+m[1] > 40 ? +m[1] / 100 : +m[1]);   // "380" is centimetres
  return null;
}
const round = (v) => Math.round(v * 1000) / 1000;

// metres -> text in the picked unit: "3.80 m" or "12′ 6″"
export function formatLength(m, unit = "m") {
  if (m == null || !isFinite(m)) return "";
  if (unit !== "ft") return `${m.toFixed(2)} m`;
  let inches = Math.round(m / 0.0254);
  return `${Math.floor(inches / 12)}′ ${inches % 12}″`;
}

// The value to put in an input for editing: "3.80" or "12' 6"" (parseLength reads both back).
export const editLength = (m, unit = "m") => (unit === "ft" ? formatLength(m, "ft").replace("′", "'").replace("″", '"') : m.toFixed(2));

/**
 * How sure the room's size is, in plain words, from accuracy_m. { level: exact|good|fair|rough, short, say }
 */
export function accuracyWords(room) {
  const a = room?.accuracy_m;
  if (a == null) return { level: "good", short: "", say: "" };
  const cm = Math.max(5, Math.round(a * 100 / 5) * 5);
  if (room.source === "prebuilt") return { level: "exact", short: `within ${cm} cm`, say: `Exact: within about ${cm} cm.` };
  if (a <= 0.06) return { level: "exact", short: `within ${cm} cm`, say: `Measured: within about ${cm} cm.` };
  if (a <= 0.15) return { level: "good", short: `within ~${cm} cm`, say: `Good: within about ${cm} cm. Measure two walls to make it exact.` };
  if (a <= 0.5) return { level: "fair", short: `±${cm} cm`, say: `Close: within about ${cm} cm. Measure two walls to tighten it.` };
  const m = a < 10 ? a.toFixed(1).replace(/\.0$/, "") : Math.round(a);
  return { level: "rough", short: `rough, ±${m} m`, say: `Rough: could be ${m} m out. Measure two walls to tighten it.` };
}

// The plan size of a room (any outline): its x and y extents in metres.
export function roomSize(room) {
  const xs = room.walls.flatMap((w) => [w.a[0], w.b[0]]), ys = room.walls.flatMap((w) => [w.a[1], w.b[1]]);
  return { width: Math.max(...xs) - Math.min(...xs), depth: Math.max(...ys) - Math.min(...ys) };
}

// The room switcher: the flat's rooms first (living room on top), then built ones, newest first.
export function sortRooms(rooms) {
  const flat = rooms.filter((r) => r.source === "prebuilt" || /^hoskins-/.test(r.id));
  const built = rooms.filter((r) => !flat.includes(r));
  flat.sort((a, b) => (a.id === "hoskins-living" ? -1 : b.id === "hoskins-living" ? 1 : a.name.localeCompare(b.name)));
  built.sort((a, b) => (b.id > a.id ? 1 : -1));
  return { flat, built };
}

// The progress words while a room is read from photos (ms after the call went out).
export const PHOTO_STEPS = [
  [0, "Reading the walls…"], [3500, "Measuring against doors, bricks and chairs…"], [8000, "Placing the doors and windows…"],
  [12000, "Putting in the furniture…"], [16000, "Building it in 3D…"], [24000, "Almost there…"],
];
export const PLAN_STEPS = [
  [0, "Reading the plan…"], [4000, "Tracing the walls…"], [9000, "Finding the doors…"], [14000, "Building it in 3D…"], [30000, "Plans take a little longer…"],
];
