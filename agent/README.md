# agent · lane G · the agent finds furniture

`POST /api/agent/find { roomId, wall?, query }` → `{ pieces, space, style, rejected }`. `pieces` are three
real products from UK shops that fit the chosen wall, each a `piece.json` with `source.kind: "agent"`,
`url`, `price`, `shop`, `image`, `size_source: "product_page"`, plus an `agent` block:
`{ reason, fit: { verdict, wall, at, rot, spare_m, depth_spare_m }, quotes }`.

Example (fixture living room, 2026-11-01): [`example-find.json`](example-find.json).

## How
1. **Space** (`space.mjs`, code only). `freeSpace(room, wall, { replace })` → free runs along the wall
   (doors and their swing, low windows, radiators and anything within 30 cm of the wall block it; the old
   piece of the same category is being replaced so it doesn't). Each run knows what's in front of it, and
   `fitIn()` slides the piece along to keep the 75 cm walkway (45 cm to a coffee table). Verdict words from
   the contract; "Just fits" when the walkway drops to 60–75 cm. No wall named → the longest free run.
   **Lane D's `rules/` replaces this**: `find.mjs` only calls `freeSpace` / `bestWall` / `fitIn`.
2. **Style** (`models.mjs` `readRoomStyle`). The room's `style` if it has one, else one Vision read of the
   room's picture (`assets/hoskins-living-room.jpg`, a render of Kate's living room), cached per room.
3. **Search** (Responses API + `web_search`, located London/GB): ten product pages in UK shops,
   sized for the run.
4. **Read** each page ourselves (`page.mjs`): a plain GET; non-200 = dropped (that's the link check).
   Image and price from the page's og: tags / JSON-LD. The model gets only the size parts of the page text
   and copies width, depth, height **with the exact quote**; `checkedSize()` keeps a size only if the quote
   is on the page and holds the number. Anything without all three stated sizes is dropped.
5. **Fit** by `fitIn`, **style** by the model (match 0–1 and a short note, no numbers), pick three,
   one per shop where possible. The reason's numbers come from code: "2.07 m wide, fits the west wall
   with 60 cm to spare; light beige upholstery suits your bright white walls".

Shops: IKEA (gb), John Lewis, Habitat, Dunelm, MADE, sofa.com, Furniture Village, M&S. Next, Argos, Loaf,
Wayfair, Heal's and Swyft answer 403/429 to a plain GET, so they're out. Nothing is bought, no login.

**3D from the product picture.** The route hands each result to lane B (`registerProductPiece` in
`furniture/pieces.mjs`), the same path as a pasted link: kept under its `agent-…` id so `GET /api/pieces/:id`
serves it, `model.status: "building"` with the kit piece standing in, and the mesh built from the product
picture (fetched as JPEG/PNG/WebP) in the background, at most three at once. Builds start as soon as find
returns, so the one you tap is usually ready within seconds; the same product at the same size reuses its model.

Takes ~35 s live (one search, ~10 page reads in parallel, one style call); the route caches answers for an
hour (`fresh: true` to skip the cache).

## Run
- `npm test` — `agent.test.mjs`, OpenAI and fetch faked.
- `node --env-file=.env agent/run.mjs "find me a sofa for this wall" [wall]` — live, prints the JSON.
