# render (lane F)

A screenshot of the 3D view, plus an optional real photo, turned into a photograph of the same room with the
new piece in place: "your room with this sofa, Sunday morning". One gpt-image edit, about 15 s.

## API
`POST /api/render` `{ roomId, view: dataURL, photo?: dataURL, prompt?: string, preset?: string, quality?: string }`
→ `{ image: dataURL (jpeg), model, ms, size }`

- `view` is the first image, so it sets the camera and the layout. Output size follows its aspect (long edge 1536).
- `photo` is a reference for materials only (the real sofa from a shop photo, or the real room). The prompt tells
  the model never to take its layout, camera or people.
- `preset`: `sunday-morning` (default), `evening` (lamps on, dusk outside), `daylight`, or any free text.
- `prompt`: extra words appended ("a cat on the sofa").
- `quality`: `medium` by default (`RENDER_QUALITY` in `.env` changes it).
- Model: `OPENAI_MODEL_RENDER` from `.env`, falling back to `OPENAI_MODEL_IMAGE`. **Set
  `OPENAI_MODEL_RENDER=gpt-image-2.5-flare`** (the winner below); without it you get `gpt-image-2`, twice as slow.

Code: `render.mjs` (prompt, presets, sizes, the call), `../server/routes/render.mjs` (the route),
`render.test.mjs` (mocked client, no network; `npm test`).

## Test bench
`GET /api/render/view` (`view.html`): the flat GLB (`/room/hoskins-flat.glb`) with its sofa swapped for a kit
piece, a fixed camera from the dining end looking south, and a Render button that posts the canvas to
`/api/render`. `?piece=chesterfield` (default, the venue Chesterfield proxy) or `?piece=sofa` (fixture sofa-84).

From files: `node --env-file=.env render/try.mjs --view render/samples/inputs/view-chesterfield.jpg
--photo render/samples/inputs/photo-chesterfield.jpg --preset evening --out /tmp/out.jpg` (prints the time).

## Model comparison (1 Nov 2026, 1536x1152, quality medium, 3 runs in parallel)
| Model | Sofa-84 view | Chesterfield + photo | Faithful to the view | Look |
|---|---|---|---|---|
| **gpt-image-2.5-flare** (default) | 14.4 s | 17.6 s | Best: same framing, every piece where it was | Warm sun patches, real leather, believable |
| gpt-image-2.5-sunburst | 21.4 s | 21.8 s | Adds things: a rug, a picture on the wall, books | Prettiest styling, but not your room |
| gpt-image-2 | 33.1 s | 33.1 s | Widens the lens: room looks longer, pieces smaller | Good, slightly flatter light |

Flare quality: `low` 16.1 s and drifts (wider framing, invented pictures); `medium` 13–18 s, the sweet spot;
`high` 23 s, adds a rug. End to end through the endpoint from the test bench: 14.7 s.
The photo matters: without it the Chesterfield comes out a brighter, newer red; with it, the worn oxblood leather.

Samples (`samples/`, 1024 px): `chesterfield-sunday-flare.jpg`, `chesterfield-evening-flare.jpg`,
`chesterfield-sunday-flare-nophoto.jpg`, `sofa84-sunday-flare.jpg`, `sofa84-evening-flare.jpg`,
`living-sunday-flare.jpg` and `living-sunday-gpt-image-2.jpg` (from the Blender preview still),
`compare-models.jpg` (rows: sofa-84, Chesterfield; columns: gpt-image-2, flare, sunburst),
`compare-flare-variants.jpg` (low, high, evening / sofa evening, living, no photo).
Inputs in `samples/inputs/`: the two three.js views, the preview still, and the venue photo cropped to the sofa
(no people).

## Backup: the photoreal Blender file
`~/Documents/Work/AIInteriorDesigner/hoskins-street-flat/from_scratch_2026-09-26/hoskins_street_2026-09-26_photoreal.blend`
has Cycles materials, day and evening HDRIs and cameras (`fp3d/photoreal_cams.json`; the living room one is
`living_room_balcony`, close to the test-bench view). Headless:

```
cd ~/Documents/Work/AIInteriorDesigner/hoskins-street-flat/from_scratch_2026-09-26
PR_MODES=day PR_CAMS=living_room_balcony PR_SAMPLES=64 PR_SCALE=50 PR_OUT=/tmp/pr \
  blender -b hoskins_street_2026-09-26_photoreal.blend -P fp3d/render_cycles.py
```

To show a new piece: import its GLB (from lane B, or export the kit piece with three's GLTFExporter), hide the
old sofa (the `sofa_*` objects in the viewer export; check the names in the .blend), place it at the room spot (plan x, y → Blender x, y; the GLB is Y-up so rotate X 90°), then
render. Minutes per frame on the GPU, not seconds, so it is for a hero still, not the live demo.
Existing renders: `previews/cycles/day_living_room_cupboards.jpg`, `evening_living_room_balcony.jpg`.
