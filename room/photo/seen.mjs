// What the photos showed (walls[].seen, floor_seen; see contract/README.md) and the spots that stand on it.
// A spot against a wall nobody saw looks free only because nobody saw what is there.

/** "wall" if the spot backs onto an unseen stretch of its wall, "floor" if it stands outside the seen floor, else null. */
export function spotUnseen(room, spot) {
  if (!room || !spot?.at) return null;
  const [x, y] = spot.at;
  const w = spot.wall && room.walls?.find((v) => v.id === spot.wall);
  if (w?.seen) {
    const dx = w.b[0] - w.a[0], dy = w.b[1] - w.a[1], len = Math.hypot(dx, dy);
    const t = ((x - w.a[0]) * dx + (y - w.a[1]) * dy) / len;
    if (!w.seen.some(([a, b]) => t >= a - 0.1 && t <= b + 0.1)) return "wall";
  }
  const f = room.floor_seen;
  if (f?.length >= 3) {
    let inside = false;
    for (let i = 0, j = f.length - 1; i < f.length; j = i++)
      if ((f[i][1] > y) !== (f[j][1] > y) && x < ((f[j][0] - f[i][0]) * (y - f[i][1])) / (f[j][1] - f[i][1]) + f[i][0]) inside = !inside;
    if (!inside) return "floor";
  }
  return null;
}

/**
 * Spots on what the photos showed come first (the rest keep their order), each spot says `unseen` when it
 * isn't. When the best spot changes, `best` and `say` follow; when no spot was seen, `say` says so.
 */
export function preferSeen(room, placement) {
  if (!placement?.spots?.length || !(room?.floor_seen || room?.walls?.some((w) => w.seen))) return placement;
  const spots = placement.spots.map((s) => ({ ...s, unseen: spotUnseen(room, s) }));
  const ordered = [...spots.filter((s) => !s.unseen), ...spots.filter((s) => s.unseen)];
  const best = ordered[0];
  let say = placement.say;
  if (best.unseen) say = `${say} That spot wasn't in your photos, so check it's clear.`;
  else if (spots[0].unseen) say = `${best.verdict}. Put it ${best.wall ? `on the ${best.wall} wall` : "there"}, where your photos show the room.`;
  return { ...placement, spots: ordered, best, verdict: best.verdict ?? placement.verdict, say };
}
