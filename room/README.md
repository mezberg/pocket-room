# room (lane A)

Rooms as `contract/room.schema.json`. Brief: LANES.md, section A.

## Kate's flat, exact (`hoskins/`)
`node room/hoskins/export.mjs` rebuilds:
- `contract/fixtures/hoskins-living-room.room.json` (`hoskins-living`)
- `hoskins/rooms/hoskins-{bedroom,hall,kitchen,bathroom}.room.json`

Source: the 26 Sep 2026 build (`~/Documents/Work/AIInteriorDesigner/hoskins-street-flat/from_scratch_2026-09-26/`).
`plan.mjs` has its px → metre mapping (`fp3d/solved.json`). `living.mjs` and `flat.mjs` hold the wall corners
(inner faces of the `build_ifc.py` wall rectangles), the door spans, hinges and swings (`build_ifc.py` `door()` calls),
and each piece's facing as `furniture.py` builds it. Footprint centres and boxes come from `hoskins/manifest.json`
(a copy of `viewer/manifest.json`). Heights are the piece's own top, not the mugs and vases on it.
Plan up is taken as north, so the balcony glazing is the living room's south wall.

- Walls are inner faces, so rooms with nibs, an alcove or a riser have more than four walls. Walls run CCW.
- The hall and the entrance lobby are one room (`hoskins-hall`). `into: false` marks a door in this room's wall
  that swings into the neighbour.
- Not known from the build: which way the balcony door swings (`swing: null`; the plan's chevron is ambiguous).
- `accuracy_m` 0.04: the plan's drawing tolerance (reception 6.74 x 3.44 drawn, 6.70 x 3.40 printed).
- Shell GLB: `hoskins-flat.glb` (same coordinates; three.js `(x, h, -y)`).

## From photos (`photo/`)
`POST /api/rooms/from-photo { images: [dataURL|url, ...≤8], hint?: "text" | { text?, width_m?, depth_m?, height_m? } }`

1. `read.mjs`: one Responses call (vision, `OPENAI_MODEL_TEXT`, reasoning low, strict JSON schema), all photos in it.
   The model does not give metres. It measures spans in multiples of named references ("the far wall is about
   9 door widths", "52 brick courses"), and each reading says which photo it is from and what share of the
   room's extent its span covers. Then doors, windows and big objects with positions as fractions of the room.
   Several photos are taken from the corners going round clockwise (the app guides this); photo 1 sets the frame.
2. `build.mjs`: code turns that into metres (`refs.mjs` holds the sizes). Each reading stands for
   reading / share of the room. One photo: the median, error = half the spread + half the unseen part (0.15 m min).
   Several photos: each photo gives its own median, the room takes the median of the photos, and the error is the
   spread between photos (/ √(n−1)) plus what no photo saw (0.10 m min). A box room (camera at the south wall
   looking north), openings, furniture and columns.
   Hand-measured `width_m` / `depth_m` in `hint` win (0.05). One measured wall scales the other by the photo's
   proportions (the shape reads better than the size). `_derived` shows the arithmetic, per-photo values and caveats.
3. `resizeRoom` (`PATCH /api/rooms/:id`): fix the size by typing. Any outline: walls stretch about the plan's
   bounding box, door and window centres keep their share along the wall (widths stay), furniture centres move
   (sizes stay, kept inside), columns stay floor to ceiling. Both walls given → 0.05.

Venue tests (2026-11-01, `room/venue/venue-chesterfields-2026-11-01.jpg`, one photo of one wall, sent at 1280 px):
14.4–16.6 s server side, 16.4 s from the app's button to the room in 3D. 9.7 x 6.3 x 3.6 m and 8.7 x 5.8 x 3.8 m
on two runs (an earlier prompt gave no depth readings once; the prompt now insists on all three extents),
three windows on the far wall, chesterfields, tables, column. `accuracy_m` 2.3–3.5 m: most of the room is out of frame,
and the app says "Rough: could be 3 m out. Measure two walls to tighten it." With the sofa close-up as photo 2
(17.5 s), that photo gives no wall readings and photo 1 stands alone, as it should.
Kate's living room (`agent/assets/hoskins-living-room.jpg`, a render, one photo): 19.7 s, 3.26 x 5.66 m against the
exact 3.44 x 6.74 m (5% and 16% short), `accuracy_m` 0.84, so the truth is inside the stated error.

`schema-check.mjs`: a small JSON Schema checker for the contract (no dependency).

## From a fire-escape or estate-agent plan (`fireplan/`)
`POST /api/rooms/from-plan { image: dataURL, room?: "r3", px_per_m?, height_m?, name? }` → `room` with `source: "floorplan"`.

1. `run.mjs` runs `~/Desktop/Coding projects/floorplan recognition pipeline` (`FLOORPLAN_PIPELINE` to move it) with its own
   `venv` (`FLOORPLAN_PYTHON` to override). Its stage 1 is one VLM recolour call on the pipeline's own OpenRouter key;
   the rest is local. Results are cached by image hash in the temp folder, so a re-sent plan is instant.
2. `convert.mjs`: the picked room's traced floor polygon (inner faces, jitter removed), doors projected onto its walls,
   walls named by the way they face. Scale: `px_per_m` if given, else the median door opening = 0.82 m.
   `accuracy_m` from the spread of the door widths (about ±10%). Without `room` it takes the largest; `_plan_rooms`
   lists the others with their areas so the UI can ask for one.

Checked on Kate's own plan (`fp3d/plan.png`), 13.5 s cold: room `r1` comes out 3.63 x 6.80 m against the exact
3.44 x 6.74 m. On the sample plan in `fireplan/fixtures`, the bedrooms come out 3.80 x 3.62 (printed 3.67 x 3.45) and
4.28 x 2.94 (printed 4.82 x 3.00). The pipeline finds doors, not windows. Door swings are not read (`swing: null`).
The largest region can be two rooms the trace merged (on Kate's plan, r0), so pick by `_plan_rooms` (the app asks).
`GET /api/rooms` says `from_plan: false` when the pipeline isn't on the server (hosted); from-plan then answers 501
and the app offers photos instead.
