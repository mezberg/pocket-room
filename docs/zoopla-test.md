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

## Kate's review: the room as built must pass Check my room
"The table is half the room, there are overlaps in the basic model, caught by the check." Right: before anything
was added, Check my room found pieces through each other, a kitchen in a door and a guessed 1.6 m table in a 3 m
room. That is a build bug, not "rough positions". `room/photo/settle.mjs` now runs after every photo build with the
rules' own geometry (`rules/geom.mjs`) and walkway check (`rules/check.mjs`), and repairs what the reading got wrong:
short legal moves (never off a wall), a kitchen run cut back to the door it runs into, guessed sizes shrink
(default dining table 1.6 → 1.2 m), an L-shaped sofa as arm + chaise (chaise away from the coffee table in its
crook), a door slid along its wall when a measured piece stands in it, pieces a little off a wall put back, gaps
under 60 cm opened, and the pinches the walkway check names opened by ≤ 30 cm. A piece is left out only when nothing
else works, and the caveats say so. `_derived.repairs` lists every change. Cost: 1–3 s on a 20–35 s build.

Check my room on the rooms as built (fresh `POST /api/rooms/from-photo` runs, no piece added):

| room | before | after (runs) |
|---|---|---|
| Room B, 1 photo | sofa / table overlap 20 cm, plant overlaps, 1.6 m table | 0 rule findings (4 runs) |
| Room A, photo 1 | coffee table "on" the L-sofa, sofa in the bedroom opening | no overlap / door / wall; 1 tight walkway warning, 1 run with a 35 cm warning |
| Room A, 5 photos | 3 overlaps, kitchen in the glazed door, 3 blocked ways | no overlap / door / wall, nothing left out (3 runs); 2 of 3 with no blocked way, one with 3 around the balcony door |
| Venue | — | 0 (3 runs); red chesterfields keep `#80272e` / `#74272d` |

The open-plan room is the hard case: five listing photos not taken corner to corner, so the balcony door and the
entry door land on different walls run to run, and one run still has blocked ways there.

## Kate's review 2: "this is ridiculously not like the kitchen on photo"
Nothing in a photo room came from astra: the reading gave boxes, the app drew every cupboard as a white wardrobe kit,
and nothing compared the 3D with the photo. Now:
1. The reading says which photo shows each object, its box there and what it looks like; a fitted kitchen is one
   run up to its wall units (`room/photo/read.mjs`).
2. `room/photo/models.mjs` crops each big item out of its photo and astra builds it from the crop at the size code
   computed (`furniture/pieces.mjs` `createPieceForItem`); `item.piece` links it, the app swaps it in when ready.
3. Astra checks its own work: the app renders each model on its own (`viewer.modelShot`) and
   `POST /api/pieces/:id/look` puts it next to the picture it was built from (`furniture/look.mjs`):
   matches / wrong (what to fix) / can't tell. Wrong → rebuilt with that feedback, twice at most; each model is
   checked once (the verdict is kept on the piece). Pieces added from shop photos get the same check.

Zoopla open plan in the app (5 photos): room in 42 s (the read is slower with boxes and looks: 37–43 s against
20–30 s), 7 models from crops in 13–31 s, checks 2–6 s each. 4 of 7 judged wrong and rebuilt once, then all matched:
the kitchen ("smaller-scale herringbone; the tall cabinet at the end"), the L-sofa sections (arm on the wrong end,
back cushions), the coffee table top colour. `docs/screens/zoopla-kitchen-photo-vs-3d.jpg`,
`docs/screens/zoopla-desktop-6-room-a-astra-models.jpg`.
Left: the oven tower stands apart from the run (the reading put the balcony door there, settle moved it); a check
of the whole room against the photo needs the photo's viewpoint, which listing photos don't give (tried, judged
"not visible" for everything, dropped).

## Fixed (room/, furniture/, contract), with tests — `npm test` 148/148
- **Colours lost** (the red sofa → beige): photo rooms kept no colour per piece, so the app painted every sofa linen.
  The reading now gives each object its colour; items carry `color` (contract: optional, additive, own commit).
- **Heights and depths**: every cupboard was 2 m (low TV units, kitchen runs) and every table 0.74 × 0.8 m.
  Objects now get depth and height readings; a cupboard named low/TV/media/sideboard without one is 0.5 m; a TV
  is not on the floor (it sits on its unit).
- **Misread references**: a reading 1.5× off the median of three or more is dropped and marked in `_derived`;
  the prompt says table_height means a dining table, not a coffee table. Room A photo 1: ±1.33 → ±0.60 m.
- **The room as built fails Check my room** (overlaps, doorways, guessed sizes, blocked ways): see above.
- **Chair height range** 1.2 → 1.5 m (office chairs with a headrest).

## Left for the other areas (not edited here)
- **App** (`app/js/furniture.js` `fromCategory`): use `item.color` for room furniture; today sofas are always "linen",
  armchairs "clay", chairs "moss". This is the visible half of the red-sofa bug.
- **App**: on a 375 px phone the piece label ("GREY CUSHIONED BENTWOOD A… · 0.68 × 0.82 M · BUILDING 3D…") runs off
  both edges of the screen.
- **App/furniture handoff**: the stand-in for an office chair is a dining chair kit piece (kit has no office chair
  template; `app/js/furniture.js` has `officeChair()` only for room items).
- **Place**: "Fits. Put it there, where your photos show the room." names no wall or spot (room B).
- **Rules/analyse**: a window behind a 40 cm media unit counts as unreachable ("no way from the glazed door to
  window 1, by the low media unit"); a coffee table 40–50 cm in front of a sofa is legroom, not a blocked way.
- **App**: walkway warnings (60–62 cm, "Rule") get the same red markers as failures.
- **Decisions**: "No lights are recorded for this room yet" still grades as a 100% fail in every photo room.
- **Test flake**: `server/rooms-store.test.mjs` "/analyse without the replace" fails with "fetch failed" about one
  run in two under the full `npm test`; passes 4/4 alone.
- **Room reading, not fixed**: with listing photos (not taken corner to corner, clockwise) the 5-photo room puts
  the entry door and balcony door on different walls on different runs. The size is stable (4.9–5.3 × 5.0–5.6 m);
  the openings are not. Corner shots, as the app guides, avoid this.
- **Link colours** come from the page text as named colours (`#F5F5DC` beige, `#D2B48C` tan), not sampled from
  the product picture (lane G's `readProductPage`).

## Request log (proof the app did the work)
`docs/test-inputs/zoopla/requests-2026-11-01.jsonl`, 15:19–16:16, 380 lines: every `/api` request (method, path,
status, ms) and every OpenAI call (model, ms, tokens). One terra call is marked `diag`: a direct read to see the
model's raw chair estimate before the clamp. One raw-PNG room read went to another session's server on the same
port and is not in this log.

| call | n | median s | max s | tokens in / out |
|---|---|---|---|---|
| POST /api/rooms/from-photo | 46 | 20.6 | 36.9 | |
| POST /api/pieces | 6 | 5.2 | 5.9 | |
| POST /api/pieces/from-link | 2 | 3.9 | 3.9 | |
| POST /api/place | 8 | 0.9 | 7.2 | |
| POST /api/analyse | 42 | 0.7 | 6.8 | |
| POST /api/fixes (the app, after Check my room) | 15 | 0.3 | 1.1 | |
| GET /api/pieces/:id (poll) | 120 | 0.0 | 0.0 | |
| PUT /api/rooms/:id (app puts rooms back after a restart) | 6 | 0.0 | 0.0 | |
| OpenAI gpt-6.1-terra (room + piece + page reads) | 54 | 19.2 | 31.9 | 306,422 / 76,725 |
| OpenAI gpt-6-astra (3D parts) | 8 | 37.3 | 49.4 | 22,190 / 27,162 |
| OpenAI gpt-6-luna (Decisions) | 52 | 0.7 | 5.2 | 47,134 / 0 |
