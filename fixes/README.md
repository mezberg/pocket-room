# fixes — tap an issue, get a fix

Tap any red finding from Check my room (`/api/analyse`) and get up to three suggested fixes, each one measured.
Code proposes and measures; the Decisions API only chooses (docs/ENGINEERING.md: geometry from code, models judge).

```js
import { suggest } from "./fixes/index.mjs";
await suggest(room, finding, { piece, replaces })   // → { options, none?, decision }  (contract/api.md, "fixes")
```
`POST /api/fixes` (`server/routes/fixes.mjs`) wraps it with the same body as `/api/analyse` plus the finding.

## How
1. **Search** (`search.mjs`), per kind of finding:
   - overlaps, doors, through a wall, blocked and tight walkways, flow: move each piece involved (and anything movable
     within 70 cm of the marker) in 5 cm steps, cheapest first (a sofa costs more to shift than a stool); a dining
     table moves with its chairs; turn it; take it out (stop-list below). A move that bumps a small loose piece
     nudges that aside too (≤ 30 cm, up to two), or puts a loose thing away: the 3-step fix that opens the Hoskins
     living room ("dining table and chairs 15 cm east, coffee table 5 cm south, clothes airer 15 cm north").
   - dark zones / corners: a floor lamp at the nearest spot (10 cm grid, 2.5 m round) that lights it.
   - coffee table out of proportion: ½–⅔ of the sofa where it stands, else a shopping hint with the reason.
   - daylight, style, TV distance, too tall: no move changes them; `none` says so in plain words.
2. **Check** (`measure.mjs`): every candidate room is measured with rules/ (overlaps, doors, walls, every walkway on
   the 4 cm grid). Kept only if it clears the finding (overlap gone; a closed way ≥ 60 cm, a tight one ≥ 75 cm) and
   nothing else gets worse (no new overlap or blocked door, no walkway narrower than it was or than 75 cm).
3. **Pick** (`pick.mjs`): with two or more options, one Decisions `choice` question over the sentences code wrote;
   the pick gets `best` and its probability. If the call fails, the cheapest change stays first (`by: "rules"`).
4. **None**: nothing worked → why, from what the search saw ("moving X far enough opens it, but the way from A
   to B would drop to 58 cm", "…gets the way to 53 cm at best; it needs 60 cm").

Stop-list: only `other`, `plant`, `lamp`, `stool`, `chair` may leave the room. Never a table, desk, sofa, bed,
shelf, cupboard, TV, the new piece or a fixture. Fixtures never move.

## Speed (Hoskins living room, M-series laptop)
Search 0.04–1.4 s per finding; the Decisions pick adds 0.3–0.7 s. The app asks for every red finding's fixes right
after Check my room, one after another, so a tap usually finds them ready (0 ms). `analyse` itself went from
2.4 s to 0.36 s (4.1 s → 0.47 s with a sofa) once the walls-only grid was kept per outline (`rules/grid.mjs`).

## In the app
`app/js/fix-state.js` (pure, tested): the request, applying an option to the room (or to the new piece's spot),
the undo stack, and the "Fixed" marker. `main.js`: tap a marker or card → the card opens with the options, the
pick first; choosing one shows ghosts (green, see-through) where pieces go with a dashed arrow, a red tint on
what leaves; Apply slides the pieces, checks the room again (the piece's verdict too), the marker turns green;
Undo for 8 s. Phone: the card opens in the bottom sheet; desktop: in the panel.

Tests: `fixes/fixes.test.mjs` (checked fixes, multi-step, stop-list over the sample rooms, lamp, coffee table, no
easy fix, Decisions pick and fallback, the route), `app/js/fix-state.test.mjs` (apply, undo, Fixed).
