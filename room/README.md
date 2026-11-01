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

In the app: My room → "+ New room" (1–4 photos, or a plan photo when `GET /api/rooms/options` says `plan`;
optional measured width / length in m or ft/in; optional name). The built room becomes "my room". "Fix the room"
resizes it and takes out wrong objects in code (`app/js/room-edit.js`, no model call) and saves it back with
`PUT /api/rooms/:id`. The app also keeps built rooms in the browser and sends them whole with each call, so a
restarted server doesn't lose them.

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
The largest region can be two rooms the trace merged (on Kate's plan, r0), so pick by `_plan_rooms`.
