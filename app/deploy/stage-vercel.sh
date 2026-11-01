#!/bin/sh
# Assemble a Vercel bundle from the repo without changing it: static app in public/, the lane route
# files behind one function (api/index.mjs). Usage: app/deploy/stage-vercel.sh [out-dir]
# Then: cd out-dir && vercel link --yes --project pocket-room && vercel deploy   (preview; never --prod)
set -e
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT=${1:-"${TMPDIR:-/tmp}/pocket-room-vercel"}
rm -rf "$OUT"; mkdir -p "$OUT/api" "$OUT/public"
cp -R "$ROOT/app/." "$OUT/public/"
rm -rf "$OUT/public/deploy" "$OUT/public/chesterfield-preview.html" "$OUT/public/js/chesterfield-preview.js"
mkdir -p "$OUT/public/contract" "$OUT/public/room"
cp -R "$ROOT/contract/." "$OUT/public/contract/"
cp "$ROOT/room/hoskins-flat.glb" "$OUT/public/room/" 2>/dev/null || true
cp -R "$ROOT/server" "$ROOT/contract" "$OUT/"
for d in rules decisions furniture agent render; do [ -d "$ROOT/$d" ] && cp -R "$ROOT/$d" "$OUT/"; done
rm -f "$OUT/server/index.mjs"
cp "$ROOT/app/deploy/api-index.mjs" "$OUT/api/index.mjs"
cp "$ROOT/app/deploy/vercel.json" "$OUT/vercel.json"
node -e 'const p=require(process.argv[1]+"/package.json"); console.log(JSON.stringify({name:"pocket-room",private:true,type:"module",engines:{node:">=22"},dependencies:p.dependencies},null,2))' "$ROOT" > "$OUT/package.json"
echo "Staged in $OUT"
