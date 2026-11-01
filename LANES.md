# Lanes (phase 1, all in parallel)

Each lane needs only `contract/` and the fixtures. "Done" means it runs against the fixtures with a test,
on its own branch, merged to `main`. Then phase 2 joins them: the add-a-piece loop (A B C D E G) and the
analysis view (C D E).

## A · Room (`room/`, `server/routes/rooms.mjs`)
- Export Kate's living room (then the whole flat) from the 26 Sep build to `room.json` exactly: walls,
  openings with door swings, radiator, built-ins, furniture footprints with true facing, lights. Replace
  `contract/fixtures/hoskins-living-room.room.json` (keep the same ids where they exist). Shell GLB in `room/`.
- Live room from a photo / short video: Vision → room W × L × H, doors, windows, big objects as boxes →
  `room.json` with `source: "photo"`, `accuracy_m` ≈ 0.15. `POST /api/rooms/from-photo`.
- Fire-plan shortcut: a photo of an evacuation plan through the floorplan recognition pipeline → room.json.
- Hackathon room: on arrival, measure + photograph the venue, build it, then compare the live photo
  build against it.
- Done: `GET /api/rooms/hoskins-living` returns the exact export; from-photo returns a usable box room in
  under a minute.

## B · Furniture (`furniture/`, `server/routes/pieces.mjs`)
- Read the picture (photo, tag, screenshot) with Vision → `piece.json`: category, name, style, colours, size
  with `size_source` (tag / product page beat estimates; category defaults last).
- Model, in order: match a GLB we already have (`room/` models, Poly Haven) → a parametric kit piece
  (`kit-real.js`: sofa, armchair, tables, desk, bed, shelf, rug, lamp, plant) sized to the piece → image-to-3D.
- Image-to-3D: no confirmed OpenAI endpoint, but `gpt-6-astra` is visible to our key and is the model a
  third-party listing calls "openai/gpt-6-astra/image-to-3d": check first whether it does image → 3D through
  the OpenAI API. Then test the others on day 1 (Meshy, Hunyuan3D, the WaveSpeed
  listing that claims an OpenAI model), within the hackathon's rules. Async: `model.status` building → ready.
- Normalise every GLB: scale to `size`, base on the floor, front at −y, centred, decimated.
- Done: three test pictures (shop photo, tag, Instagram screenshot) each give a correct piece.json and a
  model that loads.

## C · App (`app/`, deploy)
- Phone-first web app, no build step, three.js via the import map. Viewer: room from `room.json` (+ GLB),
  furniture as kit pieces or GLBs, the sun/shadow/AO look from `kit/real.js`, orbit camera, labels.
- Inputs: camera, upload, PWA share target (a screenshot shared from Instagram lands in "Add piece").
- Screens: My room · Add piece (spinner while the model builds) · Verdict + advice markers (red problem,
  green fix) · Talk (placeholder for lane 6 voice).
- Deploy (Vercel) with the server.
- Done: the fixture room and sofa render on a phone, the stub verdict and finding show as markers.

## D · Rules in code (`rules/`)
- Pure functions on `room` + `piece`, no network. Free-floor grid; candidate spots along every wall and the
  centre; legal = no overlap, inside the walls, door swings and openings clear, not over a radiator.
- Walkways: shortest path (grid A*) from every door to every room zone, each bed side, each window; width
  ≥ 0.75 m fits, 0.6–0.75 just fits.
- Model check (5a): overlaps, pieces through walls, pieces off the floor, blocked doors, closed paths →
  `finding` with `kind: "model"`.
- Done: `npm test` covers a tiny, a typical and a crowded room; `/api/place` and `/api/analyse` return
  computed spots and model findings.

## E · Decisions (`decisions/`)
- The Decisions API (`/v1/decisions`, public beta, model `gpt-6-luna`): bounded answers with probabilities.
  The endpoint answers our key (it needs `input`). Find the request shape in the docs first; fall back to structured output from the Responses API if it isn't reachable.
- Best spot: choose among lane D's legal spots ("best wall: one of […]"), with probability.
- Design grade (5b): a question set per room (light: daylight reach, lamps per zone, dark corners; flow;
  proportion: rug vs sofa, TV height; style: does the new piece match) → `finding` with `kind: "design"`.
  Code passes the measured numbers in; Decisions judges.
- Voice routing for lane 6: each sentence → move / swap / ask / render.
- Done: on the fixtures, place returns a reasoned best spot and analyse returns 4–6 design findings.

## F · Render (`render/`, `server/routes/render.mjs`) · stretch
- gpt-image edit: a screenshot of the 3D view (+ a room photo) → "your room with this sofa, Sunday morning".
  Backup: the photoreal Blender file of the flat.
- Done: `POST /api/render` returns an image for the fixture view.

## G · Agent finds furniture (`agent/`, `server/routes/agent.mjs`)
- "Find me a sofa for this wall": web search in shops → product image + dimensions → `piece.json`
  (source `agent`, url, price). Keep only pieces that fit the spot (ask lane D's rules) and match the
  room's style.
- Done: for the fixture room, three real products that fit, each with a link and a size from the page.
