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

1. `read.mjs`: one Responses call (vision, `OPENAI_MODEL_TEXT`, reasoning low, strict JSON schema). The model does not
   give metres. It measures spans in multiples of named references ("the far wall is about 9 door widths",
   "52 brick courses") and says how much of the room is in frame, then lists doors, windows and big objects
   with positions as fractions of the room and which way they face.
2. `build.mjs`: code turns that into metres (`refs.mjs` holds the sizes): median of the readings, divided by the share seen,
   then a box room (camera at the south wall looking north), openings, furniture and columns.
   `accuracy_m` = the larger of the width and depth errors (half the spread of the readings plus half the unseen part,
   0.15 m minimum). Hand-measured `width_m` / `depth_m` in `hint` win, and then it is 0.05.
   `_derived` shows the arithmetic and the model's caveats.

Venue test (`room/venue/venue-chesterfields-2026-11-01.jpg`, one photo of one wall): 14–17 s, a valid room about
9–11 x 6–6.5 x 4.1–4.2 m with three windows, the chesterfields, tables and a column. `accuracy_m` comes out near 3 m
because most of the room is out of frame. Take 3–4 photos from the corners (or measure two walls) for a tighter box.

`schema-check.mjs`: a small JSON Schema checker for the contract (no dependency).
