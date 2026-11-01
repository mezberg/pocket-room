# furniture · lane B

Picture (shop photo, shop tag, screenshot) → `piece.json` (contract/piece.schema.json) → a 3D model.

```
POST /api/pieces      { image: dataURL|URL, kind: photo|shop_tag|screenshot, hint?, mode?: auto|parametric|image_to_3d }
GET  /api/pieces/:id  → piece (poll while model.status = "building")
GET  /api/pieces/:id/model.glb, /api/pieces/:id/image
GET  /api/pieces/viewer?id=…   three.js page: photo, facts, the GLB and the kit piece side by side, upload form
```

## Image → 3D: what works (tested 1 Nov 2026)

**gpt-6-astra has no mesh output.** It is visible to our key, but OpenAI's model page lists text-only output and
only `v1/responses`, `v1/chat/completions` and `v1/batch` (developers.openai.com/api/docs/models/gpt-6-astra).
Probes: `/v1/3d/generations` and `/v1/meshes/generations` 404; `/v1/images/generations` rejects the model. OpenAI
describes astra's 3D work as *writing geometry code* (CAD code for BenchCAD, Blender `bpy` scripts in their
architectural-visualisation post), not generating a mesh. The "openai/gpt-6-astra/image-to-3d" listing on
WaveSpeed is WaveSpeed's own wrapper ($8/run listed; its docs page 404s), not an OpenAI endpoint.

**So we use astra the way OpenAI does: it writes the geometry.** `astra3d.mjs` sends the photo plus the computed
size to astra (Responses, structured output, `reasoning.effort: low`) and gets back 15–60 primitive parts (box,
rounded box, cylinder, sphere, each with size, position, rotation and a colour sampled from the photo).
`glb.mjs` turns the parts into a mesh in code, and `normalise()` fits it to the piece's size. The model draws the
shape; code sets the size.

| test picture | read (terra) | astra model | parts → GLB | result |
|---|---|---|---|---|
| Chesterfield 2-seat photo | 10 s | 34 s | 38k tris, 0.5 MB | rolled arms, two seat cushions, tufted back, bun feet: reads as *that* sofa |
| Shop-tag armchair (HALDEN) | 6 s | 16–20 s | 16k tris, 0.2 MB | tub shape, wraparound back, oak plinth and legs |
| Instagram sideboard (ARVID) | 6 s | 31 s | 2.6k tris, 0.08 MB | three slatted doors, top, black tapered legs |

**Latency** 15–35 s per model (plus 5–10 s to read the picture). **Quality:** a clean, low-poly "kit-style"
proxy, the right silhouette, proportions and colours, no textures or fine surface detail. That fits the
app's look (`kit-real.js`) better than a scanned-looking textured mesh would. Cost: about 1k input + 2–4k output
tokens per model, roughly $0.10–0.20.

Not tested: **Meshy** (`meshy.mjs` is written against their documented API and switches on when
`MESHY_API_KEY` is set; no key yet). **Hunyuan3D** was not run locally (no disk space for weights).
**WaveSpeed** was not run (no key; $8/run).

## Pipeline

1. **Read** (`vision.mjs`, `OPENAI_MODEL_TEXT`, structured output): category, name, style tags, colours,
   material, price/shop, closest kit template and how well it fits, and any printed dimensions **copied verbatim**.
2. **Size** (`sizes.mjs`, code only): parse the printed text (`W 78 cm D 82 cm H 74 cm`, `160 × 45 × 70 cm`,
   `84"W x 36"D x 33"H`, mm/cm/m/in/ft) → `size_source: tag` (on a shop tag) or `product_page` (product page or
   the seller's own caption). Otherwise the model's estimate, clamped to the category's range →
   `vision_estimate`. Otherwise `category_default`. The raw text is kept in `size_text`.
3. **Model**, first that applies (`pieces.mjs`):
   - `db_match`: a GLB in `library/manifest.json` with the same category and ≥ 2 shared style tags (plus its
     `must` tag), normalised to this piece's size. The library holds the astra Chesterfield.
   - `parametric`: the kit template fits well (`kit_fit: good`). `model.parametric` =
     `{ template, module, args, fit }`, with args computed from the size.
   - `image_to_3d`: async. The piece comes back with `status: building` (and the kit piece in `parametric` as a
     stand-in), then turns `ready` with `glb`. If the build fails, it falls back to the kit piece
     (`how: parametric`, `error` set).
4. **Normalise** every GLB (`glb.mjs`): flatten the node tree and bake transforms; scale each axis to `size`
   (width → x, height → y, depth → z); centre on x/z; base at y = 0; front stays +z (plan −y). Then dedup, and
   simplify with meshoptimizer when over 40k triangles. Optional `yaw` for generators whose front isn't +z.

## For lane C (app)
- GLB: load `model.glb` as is. It is already at size, centred, on the floor, front +z.
- Kit piece: `import(\`/js/kit/${module}\`)`, call `[template](args)`, then **multiply** the group's scale so its
  precise bounding box equals `fit` (`[x, y, z]`), and drop it on the floor. `chesterfieldLoveseat` scales its
  own root, so don't overwrite the scale. `viewer.html` `fitTo()` is a working example.

## Run
- `.env`: `OPENAI_MODEL_3D=gpt-6-astra` turns on astra image-to-3D. Optional: `MESHY_API_KEY`,
  `PIECES_IMAGE_TO_3D=meshy|off`.
- `npm test` (no network). `node --env-file=.env furniture/try.mjs [auto|parametric|image_to_3d]` runs the three
  test pictures live and checks each piece against the schema.
- Pieces, images and GLBs go to `furniture/out/` (git-ignored; `PIECES_OUT` moves it).
- Test pictures: the Chesterfield is a real photo. The shop-tag and Instagram pictures were made with
  gpt-image-2 for testing (tag says W 78 D 82 H 74 cm, £449; caption says 160 × 45 × 70 cm).
