# Contract

The boundary between the lanes. Every lane reads and writes these shapes and nothing else; a lane
can be built and tested on the fixtures alone. Change a shape only by editing this folder in its own
commit and telling every lane.

## Units and axes
- Metres everywhere. Angles in degrees.
- Plan coordinates: `x` east, `y` north, on the floor. Height `h` up from the finished floor.
- three.js: `(x, h, -y)`. Only the app converts.
- `rot` is the turn of a piece's front away from south (0 = faces south, 90 = faces east), counter-clockwise
  seen from above. A piece's local frame: width along x, depth along y, front at −y.

## Files
- `room.schema.json`: one room (walls, openings, fixed fixtures, existing furniture).
- `piece.schema.json`: one piece of furniture, from any source.
- `api.md`: the server calls.
- `fixtures/hoskins-living-room.room.json`: Kate's living room, approximate (from the viewer manifest);
  lane A replaces it with the exact export. `fixtures/sofa-84.piece.json`: a sofa read from a shop photo.

## Words
Verdict: `Fits` · `Just fits` · `Doesn't fit` (exact strings). Minimum walkway 0.75 m (30 in);
"just fits" means 0.6–0.75 m.

## Rule
Geometry comes from code (`rules/`), never from a model. Models read pictures, judge soft things
(style, light, priority) and explain.

## What was seen
Rooms built from photos are boxes whose unseen parts are a guess. `walls[].seen` lists the spans of a wall the
photos showed (metres from `a`), `floor_seen` the part of the floor they showed. Absent means fully known
(the prebuilt rooms, plans). The app draws the rest grey; rules may treat a spot on an unseen span as unchecked.
