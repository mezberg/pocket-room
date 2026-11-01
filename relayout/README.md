# relayout — Rearrange my room

When small fixes aren't enough, rearrange the whole room as a designer would: move whole zones (the sofa with its
coffee table, side table and TV; the dining table with its chairs; the desk with its chair), move or put away single
pieces, and if that still isn't enough, take one piece out or swap it for a smaller one. Code finds and measures every
layout with rules/ (the same overlaps, door swings and walkway grid as Check my room). The Decisions API only picks
which measured plan comes first.

```js
import { relayout } from "./relayout/index.mjs";
await relayout(room, { focus: finding, pinned: [ids] })  // → { plans, none?, before, zones, decision }   POST /api/relayout
```
Each plan has `kind` (`rearrange` | `remove` | `swap`), `say`, `moves` (one sentence per zone), `steps` (fix steps,
so the app's `applyFix` / `previewMoves` take them as they are), `after` (`problems`, `blocked`, `tight`, `overlaps`,
`narrowest_m`, `sofa_to_tv_m`, `zones_in_daylight`) next to the room's `before`, and `clears_focus` when a problem was
tapped. A `swap` plan also has `shop` (a Find for me size). `none` comes only when even a re-layout can't open the
room, and says why ("…stays at 54 cm at best: the built-in cupboard can't move, and the room is too narrow beside it").

## Why the fix search never moved the sofa (hoskins-living)
| limit | where |
|---|---|
| only the pieces named by one finding plus anything within 70 cm of its marker, at most 4 | `fixes/search.mjs:73`, `:79` |
| moves only away from the marker: the best 3 of 8 directions | `fixes/search.mjs:150-151` |
| moves up to 1 m, 5 cm steps, cheapest first; a sofa weighs 2.2× a stool | `fixes/search.mjs:114`, `:148`, `:176` |
| a piece bumped on the way may only be nudged ≤ 30 cm (the sofa 50 cm south hits the side table, then the floor lamp) | `fixes/search.mjs:91` |
| zones don't move together: the coffee table and TV stay while the sofa moves | `fixes/search.mjs:30-37` (only dining sets group) |
| nothing may get worse: any other walkway narrowing below min(before, 75 cm) rejects the move, even one that opens the room | `fixes/search.mjs:131`, `fixes/measure.mjs:43` |
| one finding at a time; "fixed" means that finding only, never the room's total | `fixes/search.mjs:49-66` |
| a 2.5–4 s budget, stop at 4 fixes | `fixes/index.mjs:50`, `fixes/search.mjs:175` |
| stop-list: sofas, tables, shelves never leave | `fixes/search.mjs:16` |
| the designer's move-then-place won't move sofas or anything over 1.2 m² | `designer/plan.mjs:15-16` |
| rules' own fix: one piece, ≤ 25 tries, only when the gap is < 60 cm short | `rules/check.mjs:57`, `:283`, `:294` |

On Kate's flat the room is actually cut in two (hall door → balcony 17 cm: sofa, coffee table, chair 3, the dining
set, the airer and the TV-side plants form one wall). Opening it needs the seating group to slide ~1.2 m south as one
— five limits above at once.

## Approaches compared
| | zone planning (rules of thumb) | global search over layouts (this) | a model proposes moves, code checks |
|---|---|---|---|
| fixes | what the templates foresee | anything a sequence of zone/piece moves can reach; take-out and smaller-piece tiers | whatever it imagines; measured 0/2 valid on the blocked way (issue-fix-options notes) |
| quality | predictable, rigid; fails on odd rooms (photo rooms, L-shapes) | all numbers measured; whole room scored (walls of furniture, squeezes, overlaps, door swings, TV facing, daylight, a light per zone, how much moves) | inventive but invents sizes; needs repair loops |
| latency | < 1 s | ~7 s for Kate's flat, ~9 s for the Zoopla room (5 × 1100 annealing steps, ~1200–1300 layouts measured at ~3 ms) + ~0.5 s Decisions | 15–35 s per proposal |
| cost | none | one Decisions call | 1+ Responses calls per try |
| effort | medium, grows per room type | done here (≈ 600 lines) | medium + repair code |
| risk | brittle templates | long step lists; tuning weights | invalid layouts, can't be trusted |

Recommendation: the global search (simulated annealing over zone moves, seeded so a room always gives the same plans),
with zones as the move unit (so it plans like a designer) and the Decisions API choosing among 2–3 measured plans. A
beam search was tried first and was myopic (a 30 cm nudge looked best and shut out the 1.2 m seating move).

## Ideas first, as a designer works
One search nudging zones from where they stand settles on one idea, so its runners-up are the same plan with small
changes. Now code proposes **concepts** from the room's own geometry, puts the zone there in one go, keeps it there,
and the search fits everything else round it:
- **Living area by the window**: the sofa back to the wall nearest the glass (not the glass wall), the TV across from
  it, slid along its wall if a radiator is in the way; a desk or dining set standing there swaps into the place the
  sofa leaves.
- **Dining table by the window**: the table a chair plus a walkway in from the widest glass.
- **Keep the furniture where it is, clear the clutter**: only small pieces move or are put away.
- whatever the free search found, if it is a different idea (named for what it moves: "Living area towards the window"),
  and its **quick version** when one does as much with at least two fewer steps.

Only ideas that work are offered: none worse anywhere, fewer problems, and every way open if any idea opens them all.
The rest go under **Also tried**, with what stopped them ("Dining table by the window: one way stays blocked (the
narrowest is 51 cm)"). Steps read like a person: "beside the sofa", "against the west wall", put-aways in one line,
distances to 10 cm.

## Measured (no model in the numbers)
| room | before | plans | after |
|---|---|---|---|
| hoskins-living | 6 problems, 1 blocked way, narrowest 17 cm, 1 overlap | **Living area towards the window**: sofa, side table and coffee table 120 cm south; dining set 30 cm east; bookshelf against the west wall; floor lamp beside the sofa; airer and bag put away | 0 problems, narrowest 77 cm |
| | | **Quick version** (3 steps instead of 5): sofa group 130 cm south with the TV bench; lamp 40 cm; box and bag put away | 0 blocked, 4 tight, narrowest 59 cm |
| | | Also tried: dining by the window (one way stays blocked, 51 cm); living area by the window with the desk where the sofa was (53 cm); clearing clutter only (17 cm) | |
| zoopla-openplan-blocked (from photos) | 6 problems, 1 blocked way (26 cm by the dining table) | **Move the living area east**: sectional and coffee table 30 cm east, media unit 60 cm with it; dining set 240 cm south | 0 blocked, narrowest 62 cm, 4 problems |
| | | **Dining table by the window**: dining set 310 cm west, to the glass; sectional 160 cm south-east, media unit with it | 0 blocked, narrowest 62 cm, 3 problems |

Time: about 10 s for Kate's flat, 8.5 s for the Zoopla room (searches) plus about 0.5 s for the Decisions pick.
Screen: `docs/screens/relayout-phone-1-plan.jpg` (the pick, 81% sure, with its ghosts in 3D).

## In the app
"Rearrange my room" under What's wrong (any rule problem, no new piece): a card with the plans (the pick first, its
steps, Problems / Blocked ways / Narrowest walkway before → after), ghosts and arrows in 3D, Apply the plan / Undo.
A fix card with no small fix now says so and offers "Rearrange the room", with the plans that clear that problem first.

## Left to do
- Apply / Undo from the card not clicked through in the browser yet (the card and the 3D preview are).
- More concepts: the sofa as a divider between dining and living, an L of sofa and armchair, the desk by the window.
- Long plans (6–7 steps): group the small "put away" steps.
- Floor lamps can travel 2 m; a "lamp belongs to its sofa" term would keep them close.
- The search is CPU-bound in the request (8–10 s); a worker or streaming the first plan would help.
