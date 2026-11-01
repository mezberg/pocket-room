# Pocket Room

Hackathon project. Your flat in 3D; any piece of furniture you see (photo in a shop, a tag, a screenshot,
or one an agent finds) is built in 3D, placed in your room to scale, checked against the room's rules, and
you can talk to your room about it. Uses the OpenAI ecosystem: Responses (vision), Decisions API, Realtime
voice, gpt-image. Board: `pocket-room-notes/Pocket Room board.canvas` (Obsidian).

## How the work is split
- Lanes A–G run in parallel; each has a brief in `LANES.md` and owns its folders. Don't edit another
  lane's folders; if you need something from one, ask for it (or stub it in your own folder).
- `contract/` is the boundary: room and piece JSON, the API and the fixtures. Build and test against
  the fixtures. Change the contract only in its own commit with a note in the commit message, and keep
  it backwards compatible where you can.
- One branch per lane (`lane-a-room`, …), merged to `main` when it runs against the fixtures.
- `server/index.mjs` mounts one route file per lane (`server/routes/*.mjs`); edit only yours.

## Rules
- Geometry comes from code (`rules/`), never from a model. Models read pictures, judge soft things
  (style, light, priority) and explain. Every size, clearance and verdict is computed.
- Metres in the data, plan axes x east / y north (see `contract/README.md`). The UI may show ft/in.
- Verdict words, exactly: `Fits` · `Just fits` · `Doesn't fit`.
- OpenAI calls go through `server/openai.mjs`; models come from `.env`, never hard-coded.
- Never commit `.env` or keys. Never print a key.
- 3D look: the kit in `app/js/kit/` is copied from Misplaced (`real.js` renderer with sun, shadows, AO;
  `kit-real.js` parametric furniture; `shell.js` room shell; `palette.js` colours). Lane C owns it.

## Run
- `npm install`, `cp .env.example .env`, paste the key, `npm run check:openai`.
- `npm run dev` → http://localhost:8790 (preview config `pocket-room` in `.claude/launch.json`).
- `npm test` runs `node --test` (put tests next to the code as `*.test.mjs`).

## Assets outside the repo
- Kate's flat, built from the estate-agent plan (26 Sep 2026):
  `~/Documents/Work/AIInteriorDesigner/hoskins-street-flat/from_scratch_2026-09-26/` (README, IFC, `.blend`,
  `viewer/model.glb` + `manifest.json`, `fp3d/` build scripts, photoreal `.blend`). A copy of the GLB is
  `room/hoskins-flat.glb`.
- Floor-plan image → room graph in one VLM call: `~/Desktop/Coding projects/floorplan recognition pipeline`.
- Misplaced (the furniture-fit site, same 3D kit and solvers for rugs, TV, curtains, beds, desks):
  `~/Desktop/Coding projects/Misplaced`.
