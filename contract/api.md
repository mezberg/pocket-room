# Server API

JSON in, JSON out, under `/api`. Images go as data URLs or https URLs. Every route has a stub in
`server/routes/` that returns the fixtures, so the app can be built before the lanes land.

| Call | Lane | In | Out |
|---|---|---|---|
| `GET /api/rooms/:id` | A | | `room` |
| `POST /api/rooms/from-photo` | A | `{ images: [..], hint? }` | `room` (source `photo`, accuracy ~0.15) |
| `POST /api/rooms/from-plan` | A | `{ image, room?, px_per_m?, height_m? }` | `room` (source `floorplan`) + `_plan_rooms` |
| `GET /api/rooms` | A | | `{ rooms: [{ id, name, source }] }` |
| `POST /api/pieces` | B | `{ image, kind: photo\|shop_tag\|screenshot, hint? }` | `piece` (model.status may be `building`) |
| `GET /api/pieces/:id` | B | | `piece` (poll until model.status is `ready` or `failed`) |
| `POST /api/agent/find` | G | `{ roomId, wall?, query }` | `{ pieces: [piece] }`, each already known to fit |
| `POST /api/place` | D + E | `{ roomId, piece }` | `placement` |
| `POST /api/analyse` | D + E | `{ roomId, room? }` | `{ findings: [finding] }` |
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
```
