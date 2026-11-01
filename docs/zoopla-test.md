# Zoopla screenshots through the app (1 Nov 2026)

Kate's screenshots of Zoopla listings and shop pages, run through the app's own pipeline and the live models
(server on a spare port, every endpoint and model call logged). No room, piece or finding was written or patched
by hand. Inputs (≤1600 px) are in `docs/test-inputs/zoopla/`, the request log is
`docs/test-inputs/zoopla/requests-2026-11-01.jsonl`, screens are `docs/screens/zoopla-*.jpg`.

## What the screenshots are
| file | what |
|---|---|
| `room-a-openplan-1..5.jpg` (14.52.56 – 14.53.11) | one listing (18 photos): open-plan living / dining / kitchen in a tower, floor-to-ceiling windows |
| `room-b-living-1.jpg` (14.53.25) | another listing (12 photos): small living room, sofa, bay of windows, radiator |
| `piece-ikea-styrspel-chair-a/b.jpg` (14.44.11, 14.52.00) | IKEA STYRSPEL gaming chair, red |
| `piece-ikea-poang-armchair.jpg` (14.52.24) | IKEA POÄNG armchair, birch / Gunnared beige |
| `other-roomvo-visualizer-1/2.jpg` (14.54.34, 14.54.40) | Zoopla's Roomvo visualizer (a bedroom restyled, "shop similar" list): what users see today; not an input |

## Results
| input | how | what the app built | time | verdict |
|---|---|---|---|---|
| Room B, 1 photo | API, before fixes | 3.16 × 3.53 × 2.46 m, ±0.42; window + radiator on the far wall; sofa, dining table, chair, plants, "TV cabinet" **2 m tall**, sofa/table **overlapping** | 18.7 s | size right (radiator ~1 m under a 2.2 m window, 2.46 m ceiling); heights and overlaps wrong |
| Room B, 1 photo | app, phone 375×812, after fixes | 3.00 × 3.75 × 2.52 m, "Rough: could be 0.6 m out", 45% of walls / 28% of floor grey; "Low TV unit" now 0.5 m | 20 s (button → 3D) | right; the sofa is drawn beige, it is sage (app ignores the new `item.color`) |
| Room A, photo 1 only | API, before fixes | 3.12 × 4.05 × 2.70, ±1.33; one width reading "7.5 × table_height = 5.55 m" (a coffee table read as a dining table) | 17.9 s | wrong error and height: one misread reference |
| Room A, photo 1 only | API, after fixes | 3.38 × 3.83 × 2.45, ±0.60; coffee table 0.45 m high, media unit 0.45 m, colours read | 21.6 s | right for the living end it shows |
| Room A, 5 photos | API, before fixes | 4.91 × 5.06 × 2.46, ±1.14; kitchen run 3.69 m long but **2 m tall**, media cabinet 2 m, coffee table 0.74 m | 18.0 s | size plausible; heights wrong |
| Room A, 5 photos | app, desktop 1440×900, after fixes | 5.25 × 5.00 × 2.59 m, "Close: within about 45 cm", 7% walls / 5% floor grey; kitchen 0.89 m, oven housing 2.14 m | 29 s | size plausible for a ~26 m² open plan; wall assignment of doors changes run to run (listing photos aren't corner shots) |
| Venue (chesterfield photo, the "red sofa beige" case) | API, after fixes | sofa `#74272d`, armchair `#80272e` in the room JSON | 15.6 s | colour now kept in the data; the app still paints room sofas "linen" |
| STYRSPEL a (screenshot) | API | chair, 0.70 × 0.70 × **1.20** (`vision_estimate`), red `#B32B2C`, astra GLB 37k tris, red | 5.2 s read, 35 s model | height cut by the chair range (model said 1.30) → fixed |
| STYRSPEL b (raw 2.5 MB PNG) | API | same, 5.6 s read, 57 s total | | resizing makes no measurable difference to the read (5.2 vs 5.6 s); not a bug |
| STYRSPEL a | app, desktop, room A | 0.70 × 0.70 × 1.30 m, red stand-in then red astra model; "Fits. Put it on the south wall" + 13 findings | 47 s to the model | right |
| POÄNG (screenshot) | API + app phone, room B | armchair 0.68 × 0.82 × 1.00 (`vision_estimate`, = IKEA's 68 × 82 × 100), greys + birch; "Fits. On the east wall: daylight 117 cm away" | 5 s read, ~60 s model | right |
| POÄNG link (ikea.com/ie and /gb) | API `from-link` | 0.68 × 0.82 × 1.00, `product_page`, "Width 68 cm · Depth 82 cm · Height 100 cm", astra model ready | 3.9 s + 34–38 s | right |
| STYRSPEL, POÄNG in `hoskins-living` | API place | "Doesn't fit" (POÄNG: best spot leaves 48 cm by the balcony door) | 0.1–1.3 s | plausible: the room already holds 19 pieces |
| Place + Check my room in rooms A, B | API + app | run; findings include overlaps and doorways caused by rough photo positions | place 0.9 s, analyse 4–7 s | rules right on the data they get |

## Fixed (room/, furniture/, contract), with tests — `npm test` 121/121
- **Colours lost** (the red sofa → beige): photo rooms kept no colour per piece, so the app painted every sofa linen.
  The reading now gives each object its colour; items carry `color` (contract: optional, additive, own commit).
- **Heights and depths**: every cupboard was 2 m (low TV units, kitchen runs) and every table 0.74 × 0.8 m.
  Objects now get depth and height readings; a cupboard named low/TV/media/sideboard without one is 0.5 m; a TV
  is not on the floor (it sits on its unit).
- **Misread references**: a reading 1.5× off the median of three or more is dropped and marked in `_derived`;
  the prompt says table_height means a dining table, not a coffee table. Room A photo 1: ±1.33 → ±0.60 m.
- **Overlapping pieces** from rough positions: pushed apart by the shortest step (either piece), inside the walls,
  never more than 60 cm, never pulling a piece off the wall it stands against; chairs may stay tucked under tables,
  rugs under things. `_derived.moved` lists each move.
- **Chair height range** 1.2 → 1.5 m (office chairs with a headrest).

## Left for the other areas (not edited here)
- **App** (`app/js/furniture.js` `fromCategory`): use `item.color` for room furniture; today sofas are always "linen",
  armchairs "clay", chairs "moss". This is the visible half of the red-sofa bug.
- **App**: on a 375 px phone the piece label ("GREY CUSHIONED BENTWOOD A… · 0.68 × 0.82 M · BUILDING 3D…") runs off
  both edges of the screen.
- **App/furniture handoff**: the stand-in for an office chair is a dining chair kit piece (kit has no office chair
  template; `app/js/furniture.js` has `officeChair()` only for room items).
- **Place**: "Fits. Put it there, where your photos show the room." names no wall or spot (room B).
- **Rules/analyse**: an L-shaped sectional is one box, so it "overlaps" the coffee table in its crook and
  "stands in" a nearby opening. Room side could split it into two boxes later; rules could tolerate rug/table in
  a sofa's crook.
- **Decisions**: "No lights are recorded for this room yet" still grades as a 100% fail in every photo room.
- **Test flake**: `server/rooms-store.test.mjs` "/analyse without the replace" fails with "fetch failed" about one
  run in two under the full `npm test`; passes 4/4 alone.
- **Room reading, not fixed**: with listing photos (not taken corner to corner, clockwise) the 5-photo room puts
  the entry door and balcony door on different walls on different runs. The size is stable (4.9–5.3 × 5.0–5.6 m);
  the openings are not. Corner shots, as the app guides, avoid this.
- **Link colours** come from the page text as named colours (`#F5F5DC` beige, `#D2B48C` tan), not sampled from
  the product picture (lane G's `readProductPage`).

## Request log (proof the app did the work)
`docs/test-inputs/zoopla/requests-2026-11-01.jsonl`, 15:19–15:54, 211 lines: every `/api` request (method, path,
status, ms) and every OpenAI call (model, ms, tokens). One terra call is marked `diag`: a direct read to see the
model's raw chair estimate before the clamp. One raw-PNG room read went to another session's server on the same
port and is not in this log.

| call | n | median s | max s | tokens in / out |
|---|---|---|---|---|
| POST /api/rooms/from-photo | 11 | 19.7 | 29.5 | |
| POST /api/pieces | 6 | 5.2 | 5.9 | |
| POST /api/pieces/from-link | 2 | 3.9 | 3.9 | |
| POST /api/place | 8 | 0.9 | 7.2 | |
| POST /api/analyse | 6 | 4.0 | 6.8 | |
| GET /api/pieces/:id (poll) | 120 | 0.0 | 0.0 | |
| PUT /api/rooms/:id (app puts rooms back after a restart) | 4 | 0.0 | 0.0 | |
| OpenAI gpt-6.1-terra (room + piece + page reads) | 19 | 15.5 | 29.5 | 87,162 / 19,359 |
| OpenAI gpt-6-astra (3D parts) | 8 | 37.3 | 49.4 | 22,190 / 27,162 |
| OpenAI gpt-6-luna (Decisions) | 12 | 0.9 | 4.0 | 11,268 / 0 |
