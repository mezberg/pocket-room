// Problems drawn on the room itself, from Check my room's findings. Pure (no three.js), tested in node.
//   glow:  pieces to tint red (in each other, standing in a doorway, against a radiator, through a wall)
//   bands: walkways to draw on the floor: a blocked way red, a tight one amber, along where it squeezes
// A finding that passes (or was just fixed) draws nothing, so the highlight clears when the room is checked again.
const GLOW = new Set(["overlap", "door_blocked", "on_radiator", "through_wall"]);

export function highlightsOf(findings = []) {
  const glow = [], bands = [];
  for (const f of findings) {
    if (f.pass) continue;
    if (GLOW.has(f.id)) for (const id of f.items ?? []) if (!glow.includes(id)) glow.push(id);
    if ((f.id === "path_blocked" || f.id === "walkway_tight") && f.path?.length > 1) {
      const path = pinch(f.path, f.at, f.id === "path_blocked" ? 1.3 : 0.9);
      if (path.length < 2) continue;
      bands.push({ id: f.id, path, color: f.id === "path_blocked" ? "red" : "amber", width: f.id === "path_blocked" ? 0.24 : 0.1, width_m: f.width_m });
    }
  }
  return { glow, bands };
}

// The stretch of a way around its narrowest point (the marker): the band sits between the pieces that pinch it,
// not along the whole route from the door. The run of path points within `r` of the marker that holds it.
export function pinch(path, at, r = 0.9) {
  if (!at) return path;
  const d = (p) => Math.hypot(p[0] - at[0], p[1] - at[1]);
  let k = 0;
  for (let i = 1; i < path.length; i++) if (d(path[i]) < d(path[k])) k = i;
  let a = k, b = k;
  while (a > 0 && d(path[a - 1]) <= r) a--;
  while (b < path.length - 1 && d(path[b + 1]) <= r) b++;
  const out = path.slice(a, b + 1);
  return out.length >= 2 ? out : path.slice(Math.max(0, k - 1), k + 2);
}
