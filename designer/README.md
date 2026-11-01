# designer — the interior-designer flow

Build the room → see what's wrong (on the 3D, ranked) → bring in a piece the way a designer would.
Code measures every plan (rules/, fixes/); the Decisions API only chooses and ranks (CLAUDE.md).

```js
import { plan, advise } from "./designer/index.mjs";
await plan(room, piece)        // → { verdict, best, plans, say, decision }      POST /api/plan
await advise(room, findings)   // → { ranked: [{ index, id, p }], by }           POST /api/advice
```

## The flow in the app
1. **The room is in** (Kate's flat, or one built from photos or a plan by the New room flow): Check my room runs at
   once. Pieces in each other or in a doorway glow red; a blocked way is a red band on the floor along where it
   squeezes, a tight one amber; each problem has its numbered marker, and tapping one opens its fixes (fixes/).
2. **What's wrong with your room**: rules that stop the room working lead (pieces in each other, a blocked way or
   door, through a wall), then the Decisions API's order (`advice.mjs`: one `choice` over the checker's own
   sentences: getting in and around first, then comfort and light, then looks; `app/js/advice.js` merges them).
   The top three come first, marked "Fix first #1–3", each tied to its marker and its fixes; the rest fold under
   "More (n)". My room shows "8 things to fix · First: …".
3. **A piece**, three ways, all landing in the same plan: a photo (shop, tag), a screenshot or a pasted link
   (Add piece), or a question (Find for me: "an armchair", "a sofa for this wall"). Then `plan.mjs` weighs:
   - **place**: a free spot as the room is (rules/ `place()`, one per wall, up to 3);
   - **move, then place**: wall spots where only one or two movable pieces stand in the way (or in front, where
     you'd sit or open a drawer). Each is moved, with a dining table's chairs, to the nearest place that keeps
     every walkway at 60 cm or more and clear of doors; the spot is then measured by `place()` as if it were
     free. Only kept if it beats placing it as the room is. Not moved: beds, wardrobes, built-ins, sofas,
     anything over 1.2 m²;
   - **replace**: the old piece of the same kind goes (`place()` swap spots).
   `pick.mjs` writes what is true of each plan (what has to move and by how much, which way narrows, the old
   piece going, then best-spot's measured facts: faces the TV from 2.4 m, the most room to walk past, daylight…),
   and one Decisions request picks the plan (with its probability) and, per plan, the fact that matters most:
   the one-line reason. One plan: no call, its first measured fact is the reason. If the call fails, the
   measured order stands (verdict, fewer moves, the rules' score).
   No plan at all: "Doesn't fit. No spot, even after moving things: …" with what stopped it.
4. **The plan card**: the pick first ("Move, then place · Fits · Designer's pick · 78% sure"), its steps
   numbered, "Why: …", the other plans one tap away. Choosing one previews it in 3D: green ghosts where pieces
   go with dashed arrows, the piece it replaces tinted red, the new piece's ghost in its spot. **Apply the plan**
   slides the moved pieces, drops the piece in, and checks the room with it in; **Undo** (8 s) goes back to
   the plan.

## Tests
`designer/designer.test.mjs` (replace plan for the fixture sofa, move-then-place for an armchair in the
crowded living room, every plan legal once applied, the Decisions pick and its fallback, advice ranking, the
routes) and `app/js/plan-state.js`'s use there. End to end with the live models and the real UI:
`node scripts/flow-run.mjs http://localhost:8840` (server log in `docs/runs/`).
