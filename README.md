# Pocket Room

Your flat in 3D. Any piece of furniture you see (a shop photo, a tag, a screenshot, or one an agent finds)
is built in 3D, dropped into your room to scale, checked against the room's rules, and you can talk to
your room about it.

OpenAI: Responses (vision) · Decisions API · Realtime voice · gpt-image.

## Start
```
npm install
cp .env.example .env      # paste your OpenAI key
npm run check:openai      # what the key can reach, incl. the Decisions API
npm run dev               # http://localhost:8790
```

## Map
- `contract/`: room + piece JSON, the API, fixtures. The boundary between lanes.
- `LANES.md`: the seven parallel lanes (A room, B furniture, C app, D rules, E decisions, F render, G agent).
- `server/`: Express; one route file per lane, all stubbed with the fixtures.
- `app/`: the web app (no build step), with the 3D kit from Misplaced in `app/js/kit/`.
- `pocket-room-notes/`: Obsidian vault with the project board.
