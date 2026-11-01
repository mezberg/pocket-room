// One room, one truth. A lamp is both furniture (it takes a spot) and a light (it lights its zone); rooms built from
// photos or a plan list the lamps they saw as furniture and record no lights. normalizeRoom() makes every lamp a
// light too, once, where a room enters the server, so no check reads half of it.

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// The room's light: the lights recorded with it plus every lamp standing in it.
export function lightsOf(room) {
  const lights = [...(room.lights ?? [])];
  for (const it of room.furniture ?? []) {
    if (it.category !== "lamp" || !it.at) continue;
    if (lights.some((l) => l.id === it.id || dist(l.at, it.at) < 0.5)) continue;
    const onTable = it.on_floor === false;
    lights.push({ id: it.id, kind: onTable ? "table_lamp" : "floor_lamp", at: it.at, h: onTable ? 1.0 : 1.4, from_item: true });
  }
  return lights;
}

export function normalizeRoom(room) {
  if (!room || !Array.isArray(room.walls)) return room;
  return { ...room, lights: lightsOf(room) };
}
