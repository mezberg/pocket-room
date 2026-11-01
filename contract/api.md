# Server API

JSON in, JSON out, under `/api`. Rooms are resolved by `roomId` from one store (`server/rooms-store.mjs`:
the prebuilt Hoskins rooms and rooms built this session); a `room` in the body wins (unsaved rooms). Images go as data URLs or https URLs. Every route has a stub in
`server/routes/` that returns the fixtures, so the app can be built before the lanes land.

| Call | Lane | In | Out |
|---|---|---|---|
| `GET /api/rooms/:id` | A | | `room` |
| `POST /api/rooms/from-photo` | A | `{ images: [..≤8], hint?: text \| { width_m?, depth_m?, height_m? }, name? }` | `room` (source `photo`; `accuracy_m` from the spread between photos; a measured wall wins) |
| `POST /api/rooms/from-plan` | A | `{ image, room?, px_per_m?, height_m? }` | `room` (source `floorplan`) + `_plan_rooms` |
| `GET /api/rooms` | A | | `{ rooms: [{ id, name, source }], from_plan: boolean }` (`from_plan` false: this server can't read plans; from-plan answers 501) |
| `PATCH /api/rooms/:id` | A | `{ width_m?, depth_m?, height_m?, name? }` | `room` resized by code (walls stretch, opening and furniture centres move with them; both walls → `accuracy_m` 0.05). Built rooms only |
| `PUT /api/rooms/:id` | A | `room` | `{ id }`: puts back a built room the app kept after the server forgot it (restart). Schema-checked; not the flat's rooms |
| `POST /api/pieces` | B | `{ image, kind: photo\|shop_tag\|screenshot, hint? }` | `piece` (model.status may be `building`) |
| `POST /api/pieces/from-link` | B (+ G's page reader) | `{ url }` | `piece` (source `link`, size from the page; 422 if the page doesn't state it) |
| `GET /api/pieces/:id` | B | | `piece` (poll until model.status is `ready` or `failed`) |
| `POST /api/agent/find` | G | `{ roomId, room?, wall?, query }` | `{ pieces: [piece] }`, each already known to fit |
| `POST /api/place` | D + E | `{ roomId, room?, piece, replace? }` | `placement` |
| `POST /api/analyse` | D + E | `{ roomId, room?, piece?, replaces? }` | `{ findings: [finding] }` (piece with `at`/`rot` = the new piece in its spot; `replaces` = the item it takes out) |
| `POST /api/fixes` | fixes/ | `{ roomId, room?, piece?, replaces?, finding }` | `fixes` for one finding from `/api/analyse` (same room and piece) |
| `POST /api/render` | F | `{ roomId, view: dataURL, photo?, prompt? }` | `{ image: dataURL }` |

```ts
placement = {
  verdict: "Fits" | "Just fits" | "Doesn't fit",
  best: spot | null,
  spots: spot[],            // legal spots, best first
  say: string               // one plain sentence: "Just fits. Put it on the long wall."
}
spot = { at: [x, y], rot, wall?: string, score: 0..1, clearance_m, verdict, reasons: string[] }

finding = {
  id: string,               // "path_blocked", "walkway_tight", "rug_floats", "dark_corner", ...
  kind: "model" | "design", // model = code rule, pass/fail (5a); design = Decisions grade (5b)
  pass: boolean,
  severity: "info" | "warn" | "fail",
  probability?: number,     // design findings, from the Decisions API
  at?: [x, y],              // where the 3D marker goes
  items?: string[],         // ids of the furniture involved
  say: string,              // "The walkway by the door is 55 cm. Move the chair 20 cm."
  fix?: { item: string, at: [x, y], rot?: number }
}

fixes = {                   // POST /api/fixes: each option is measured (clears the finding, nothing else worse)
  finding: string,          // the finding's id
  options: option[],        // 0–3, the Decisions pick first
  none?: string,            // no option: why, in plain words ("No easy fix: …")
  decision?: { by: string, ms?: number, error?: string }   // by = model, or "rules" (one option, or the call failed)
}
option = {
  id: string, kind: "move" | "turn" | "remove" | "add" | "resize" | "shop",
  say: string,              // "Move the dining chair 3 10 cm north."
  steps: step[],            // empty for "shop": a hint, nothing to apply
  items: string[],
  best?: true, probability?: number,   // the Decisions pick
  after_m?: number,         // walkway findings: the width once applied
  shop?: { category, name, size: [w, d, h] }
}
step = { item, at, rot } | { item, remove: true } | { item, size: [w, d, h] } | { add: item, light?: light }
```

`spot.blocked` (optional, from `/api/place`): a way that was already under 60 cm before the piece came and is
still closed beside this spot, `{ from, to, before_m, after_m, at, already: true }`. Such a spot is never `Fits`.
