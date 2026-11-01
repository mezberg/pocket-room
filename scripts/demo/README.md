# Demo video

Drives the real app (live models, nothing mocked) in headless Google Chrome, saves every painted frame
(CDP screencast) with its time, then cuts the video: live waits on the models are sped up with their real
length on screen, captions at the bottom (top on the phone), the Photo view render full size, an end card.

```
cd scripts/demo && npm install && cd ../..                    # playwright-core only; uses installed Chrome
PORT=8850 node --env-file=.env server/index.mjs               # fresh server: Find caches answers for an hour
node scripts/demo/record.mjs desktop /tmp/pr-desktop          # ~2.5 min, ~6 500 frames (~1 GB)
node scripts/demo/compose.mjs /tmp/pr-desktop docs/demo/pocket-room-demo-desktop.mp4 docs/demo/still
node scripts/demo/record.mjs phone /tmp/pr-phone              # restart the server first
node scripts/demo/compose.mjs /tmp/pr-phone docs/demo/pocket-room-demo-phone.mp4
```

The photo upload adds `mode: "image_to_3d"` to POST /api/pieces, so gpt-6-astra builds the model live;
without it the Chesterfield photo matches the library model astra built from the same photo earlier.
Needs ffmpeg with libx264. Delete the frame folders afterwards.
