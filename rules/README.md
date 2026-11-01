# rules — lane D

Pure functions on `room` + `piece` JSON (`contract/`). No network, no models: every size, clearance and
verdict comes from here. Brief: `LANES.md`, section D.

```js
import { place, analyse, freeFloor } from "./rules/index.mjs";
place(room, piece, { replace })  // -> placement (contract/api.md)
analyse(room)                    // -> { findings } (kind "model" only)
freeFloor(room)                  // -> clearance grid + free_m2 / floor_m2 / share
```

`server/routes/place.mjs` wraps these for `POST /api/place` and `POST /api/analyse`. The room comes from
`body.room`, a sample room by `roomId` (`tiny`, `typical`, `crowded`, from `sample-rooms.mjs`) or the fixture.

## How it measures
- **Free-floor grid** (`grid.mjs`), 4 cm cells. Each floor cell holds its clearance: distance to the
  nearest solid wall or piece, negative inside a piece. Doorways are cut out of the walls and get a
  "porch" outside so a door is not its own bottleneck. Rugs and things off the floor don't block;
  wall-hung radiators do.
- **Walkways**: from every door (door, glazed door, opening) to every other door, every window and every
  place you need to reach (front of a sofa, armchair, desk, shelf, cupboard, TV; both sides of a bed —
  the 0.9 m use area along that face). A widest-path search (max-min Dijkstra) gives the widest way and its
  width = 2 × the smallest clearance on it; then A* on the cells at least that clear traces the shortest
  such way, and its narrowest point is the marker. ≥ 0.75 m fits, 0.6–0.75 just fits, < 0.6 is closed.
- **Spots** (`place.mjs`): back to every wall at 10 cm steps (plus tight into each corner), front into the
  room, and the room's centroid in each wall direction. Legal = inside the walls, no overlap, doorway
  (0.6 m deep) and door swing clear, 10 cm off radiators, enough room in front to use it (sofa 30 cm, desk
  60 cm, wardrobe 60 cm…) and no walkway pushed below 0.6 m. If the room already has a sofa / bed / desk /
  TV / wardrobe and the new piece is one too, spots replacing each old one are offered as well.
- **Model check** (`check.mjs`): through the wall / off the floor / taller than the ceiling, overlaps (chairs
  may tuck under tables ≥ 65 cm high), against a radiator, door swing or doorway blocked, closed and tight
  walkways. Closed ways are grouped by the floor area they cut off, so "the room is cut in two" is one
  finding, not ten.
- **Fixes**: the smallest move (5 cm steps, 8 directions) of one movable piece that clears the problem and
  is checked: still inside, no new overlap, doors clear, and for walkways that way reaches 75 cm with no
  other way getting worse. No fix when no single move does it.

## Output beyond the contract (all optional, backwards compatible)
- `spot.replaces`: id of the piece this spot replaces (it is left out of the room for that spot).
- `spot.front_m`: free distance in front of the piece (capped at 2 m).
- `spot.narrows`: the walkway the piece narrows most `{ from, to, before_m, after_m, at }`.
- `finding.width_m`, `finding.path` (walkway findings): the width and the way, as plan points, for drawing.
- `spot.clearance_m` = the narrowest walkway the piece touches: any way it narrows and the way to reach it.
- `spot.blocked`: a way that was already under 60 cm before the piece came and is still closed beside it
  `{ from, to, before_m, after_m, at, already: true }`. Such a spot is "Just fits" at best, scores lower, and the
  sentence says the way was already blocked, so the verdict agrees with Check my room.

## For lane E
`server/routes/place.mjs` imports `decisions/hooks.mjs` if it exists; export `choose(room, piece, placement)`
to pick/reorder among `placement.spots` (all legal; scores here are geometric only) and
`design(room, findings)` to return `kind: "design"` findings. No need to edit the route.

## Tests
`npm test` (`rules.test.mjs`): geometry, the tiny / typical / crowded sample rooms, fixes that really fix,
and the fixture sofa in the fixture living room. `place` takes ~0.1 s, `analyse` ~0.4 s on the fixture (~0.5 s with a
new sofa): the walls-only part of the grid is built once per outline and kept, each candidate only stamps the pieces.
Tap-an-issue fixes beyond the one-move `fix` here: `fixes/`.
