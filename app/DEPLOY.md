# Deploy (Vercel)

The app is static (no build step; three.js from jsDelivr via the import map). The API is the Express
routers in `server/routes/`. On Vercel: the app is served from `public/`, and every `/api/*` call goes to
one Node function that mounts the same routers.

## How
`app/deploy/stage-vercel.sh [out]` builds a bundle without touching the repo:
- `public/` = `app/` + `contract/` + `room/hoskins-flat.glb`
- `api/index.mjs` = `app/deploy/api-index.mjs`: the route files of `server/index.mjs`, `export default app`
  instead of `app.listen`
- `server/`, `contract/` and the lane folders (`rules/`, `decisions/`, …) next to it, included in the
  function (`vercel.json` `includeFiles`, since `fixtures.mjs` reads JSON with `fs`)

Then, preview only:
```
cd "$TMPDIR/pocket-room-vercel" && vercel link --yes --project pocket-room && vercel deploy
```
Env vars on the project (Preview): `OPENAI_API_KEY`, `OPENAI_MODEL_TEXT`, `OPENAI_MODEL_DECISIONS`,
`OPENAI_MODEL_IMAGE`, `OPENAI_MODEL_REALTIME` (`vercel env add … preview`). Never `--prod` until the team says so.

Checked locally: the staged function answers `/api/rooms/:id` and `/api/place` from the fixtures.
Not yet deployed (creating the project needs Kate's OK).

## Better, once the lanes agree
- `server/index.mjs` exports `app` and only listens when run directly; then `api/index.mjs` is one line
  (`export { default } from "../server/index.mjs"`) and the copy in `app/deploy/` goes.
- Body limit: Vercel functions take 4.5 MB per request. The app sends photos as JPEG data URLs at most
  1600 px (~0.6 MB), so it fits; room photos (lane A, several images) should stay under it too.
- Long jobs (image-to-3D) must not hold a request open: `POST /api/pieces` returns `building` and the app polls
  `GET /api/pieces/:id` (already how the app works). Job state needs a store across function calls (Vercel KV /
  Blob), not memory.
- Realtime voice: the browser talks to OpenAI over WebRTC with an ephemeral key from a small `/api/realtime/session`
  route; nothing long-lived runs on Vercel.

## PWA share target
`manifest.webmanifest` declares a `share_target` (POST multipart to `/share`); `sw.js` keeps the picture in a
cache and opens `/?shared=1`, which runs Add piece on it. Works on Android Chrome once the app is installed
(HTTPS, so on the Vercel URL, not localhost on a phone). iOS has no Web Share Target: there, Upload / Camera.
