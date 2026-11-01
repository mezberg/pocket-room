# Demo video

Drives the real app (live models, nothing mocked) in headless Google Chrome, saves every painted frame
(CDP screencast) with its time, then cuts the video: live waits on the models are sped up with their real
length on screen, captions on the frames, the Photo view render full size, then two slides.

The cut: Kate's living room → Check my room (pins) → Find for me "a floor lamp" (three real products, one
placed) → Add piece: the Chesterfield photo (gpt-6-astra's model of that photo, from the library, so no
stand-in) → tap an issue, the Decisions API's pick, Apply (furniture moves, room checked again) → fly to eye
height → Photo view (gpt-image) → phone scene: in the IKEA aisle, Camera on the side table → "Doesn't fit"
→ slide: the OpenAI APIs and what each does → slide: the Obsidian board.

Off camera, before filming, the room is tidied with the app's own Check → Fix → Apply (the blocked way to
the sofa, the chair overlapping the coffee table), so the starting room makes sense.

```
cd scripts/demo && npm install && cd ../..                    # playwright-core only; uses installed Chrome
PORT=8850 node --env-file=.env server/index.mjs               # fresh server: Find caches answers for an hour
node scripts/demo/record.mjs desktop /tmp/pr-desktop          # ~2.5 min, ~5 500 frames
node scripts/demo/record.mjs phone /tmp/pr-phone
END=0 node scripts/demo/compose.mjs /tmp/pr-desktop /tmp/desk.mp4 docs/demo/still
END=0 CAPS=1.5 node scripts/demo/compose.mjs /tmp/pr-phone docs/demo/pocket-room-demo-phone.mp4
node scripts/demo/assemble.mjs /tmp/desk.mp4 docs/demo/pocket-room-demo-phone.mp4 docs/demo/pocket-room-demo-desktop.mp4
```

Script-only touches (no UI for them): the eye-height camera uses the viewer's own `flyTo`, and the pins are
cleared (`pocketRoom.setFindings([])`) before it; the render leaves pins out anyway. Assets: `ikea-aisle.jpg`
(the aisle), `ikea-side-table.jpg` (the camera's framing of it), `board.jpg` (Kate's board screenshot).
Needs ffmpeg with libx264. Delete the frame folders afterwards.
