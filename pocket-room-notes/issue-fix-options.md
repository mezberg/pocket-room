# Tap an issue → get a fix: options

Kate wants to tap any finding in "Check my room" and get a suggested fix. This note sets out the options so she can
choose one. Nothing here has been built. The only code written was throwaway prototypes in a scratchpad, to answer
feasibility questions. Measured on main at 9f7dbb8 with the `hoskins-living` room, 1 Nov 2026.

## 1. What exists today

### Kate's living room, "Check my room" with no new piece (9 findings, 8 of them red)

| # | id | kind | sev | Says | Fix today? |
|---|---|---|---|---|---|
| 1 | overlap | model | fail | Coffee table and dining chair 3 overlap by 10 cm | **Yes**: move chair 3 10 cm NW |
| 2 | path_blocked | model | fail | No proper way from the hall door to the sofa, cupboards, bookshelf and 4 more: widest gap 49 cm, by the sofa and dining chair 2 | No |
| 3 | walkway_tight | model | warn | Balcony door → desk (and 2 more) 67 cm, by the leather bag and floor lamp | **Yes**: move the bag 10 cm SE |
| 4 | walkway_tight | model | warn | Hall door → ladder bookshelf 60 cm | No |
| 5 | daylight | design | warn p .45 | Daylight reaches 71% of the floor; the dining table (4.9 m) sits past it | No |
| 6 | lamps_per_zone | design | fail p 0 | North-west corner is 2.8 m from any light | No |
| 7 | flow | design | fail p 0 | Hall door → balcony door narrowest gap 17 cm, by the sofa | No |
| 8 | tv_distance | design | pass p .99 | Sofa 2.2 m from the TV: a 40–55″ screen suits | (passes) |
| 9 | coffee_table | design | warn p .45 | Coffee table is 38% of the sofa's length | No |

Timing: `analyse` takes 2.4 s and the Decisions grade 0.8 s, run in parallel.

### How fixes work now
- `rules/check.mjs` attaches `fix: { item, at, rot }` when **one move of one movable piece** (5 cm steps, 8
  directions, `nudge()`) clears the problem and is checked: still inside, no new overlap, doors clear, and for
  walkways the way reaches 75 cm with no other way getting worse. It covers overlap, through_wall, door_blocked
  and walkway_tight. It never rotates, removes, moves pieces as a group (a table with its chairs) or swaps.
- Design findings (`decisions/design.mjs`) never carry a fix. Their `say` sometimes hints at one ("A lamp there
  would help").
- The app (`viewer.showFindings`) draws a red numbered pin per finding. When there is a fix it adds a green pin and a
  dashed arrow to `fix.at`, and the card says "green pin shows the fix". A tap focuses the camera on the pin and
  shows `say` in a toast. Nothing can be applied, previewed or undone. The viewer already has `ghost()` and
  `setHidden()`, which a preview can reuse.

### What prototyping showed
1. **The biggest finding has no simple fix.** Hall door → balcony door is 17 cm. I searched 202 candidates (moves of
   10–60 cm in 8 directions for the sofa, chair 2, the dining set as a group and the coffee table; rotations; removing
   chair 2, chair 3, the airer or the coffee table). Fifty were legal and **none** opened the way to 60 cm.
   Removing single pieces shows the culprits: without the sofa the way is 59 cm, without chair 3 it is 45 cm, and
   without any other piece it stays at 17 cm. The best two-step fix (tuck chair 3 30 cm under the table, then move
   the sofa 20 cm west) reaches only 59 cm. Kate walks through this room every day, so this is mostly **rough chair
   boxes in the room model**, not a real problem. A fix that says "move your sofa" would look wrong in the demo.
   The search took 1.6–4 s (one `routes()` takes 60–100 ms).
2. **Two findings describe one problem with two different numbers.** `path_blocked` (49 cm, by the sofa and
   chair 2) and `flow` (17 cm, by the sofa) are the same blockage. Lane D's grid and lane E's grid measure
   differently.
3. **A model can propose sensible fixes, but slowly.** gpt-6.1-terra with the room JSON and the overlap finding
   returned 3 fixes ("move the coffee table 16 cm south", "rotate it and move it south", "remove chair 3") in
   **14.8 s** (990 tokens in, 1,109 out, 996 of them reasoning), about **$0.007 per call**. Code confirmed that
   the first two clear the overlap. Each proposal still has to go through the full legality check.

## 2. What a fix can be, per finding type

| Finding | Natural fixes | Code can generate | Needs a product |
|---|---|---|---|
| overlap, through_wall, door_blocked, on_radiator | move or rotate one piece | yes (exists for most) | no |
| walkway_tight | move one piece, tuck chairs | yes (exists), tuck is new | no |
| path_blocked / flow | several moves, tuck chairs, remove a small piece, swap the sofa for a shorter one | partly (multi-move search is slow and often fails, see above) | a shorter sofa |
| too_tall | swap for a lower piece | target size only | yes |
| lamps_per_zone | add a floor lamp at the dark corner or zone | spot + size via `place()` | yes |
| coffee_table | swap for a table ½–⅔ the sofa's length (1.18–1.57 m here), set 35–45 cm off | target size + spot | yes |
| tv_distance | move the sofa, or a screen size | move, size | maybe (TV) |
| daylight | move the dining zone nearer the glass, add a lamp | big rearrange, poor | lamp |
| style | swap the piece or its colour | no | yes |

## 3. The approaches

Prices used: terra $1/$5 per M tokens in/out, luna $0.10/$0.50, astra $10/$50, render about $0.05/image.

### A · Code searches for the fix (extend `rules/`)
Each finding type gets a candidate generator: nudge (exists), rotate 90/180, tuck chairs under their table, move a
table with its chairs as a group, remove a light piece (bag, box, airer, plant), and for lamps "a 30 × 30 cm lamp
here" placed by `place()`. Each candidate is checked by re-running the check that raised the finding plus
`legal()`. Up to 3 verified fixes come back per finding, smallest change first.
- **Good at:** overlaps, walls, doors, tight walkways and lamps. It is deterministic, never wrong about geometry,
  and works offline.
- **Bad at:** path_blocked/flow (the prototype found nothing in 202 candidates), and taste ("remove the bag" and
  "rotate the sofa" score the same). It has no OpenAI story.
- **Latency** 0.1–4 s per finding. Precomputed during analyse it would add a few seconds; on tap it is instant
  for simple findings and about 2 s for walkways. **Cost** $0. **Effort** 5–7 h (rules 4 h, tests 1–2 h).
  **Demo risk** low.
- **Example:** "Dining chair 3 overlaps the coffee table by 10 cm" → (1) tuck chair 3 under the dining table,
  (2) move it 10 cm north-west, (3) rotate the coffee table to face the sofa. A ghost chair appears in each spot.

### B · Code generates the candidates, Decisions picks (A + gpt-6-luna) ← same pattern as best-spot
A builds the verified candidates. One Decisions request then asks, per finding, one `choice`: which fix best
keeps the room liveable. Code writes the facts for each candidate: cm moved, whether it blocks the TV view, light
or radiator, whether a piece is removed, and the walkway width after. The answer comes back with probabilities
("82% this one"). The best-spot code (`decisions/best-spot.mjs`) already does this for placing a piece, so the
same code can be reused. All findings go in one request, running alongside the design grade.
- **Good at:** everything A is good at, plus a ranked choice that shows real OpenAI use, with a visible confidence
  ("Decisions: 82% prefers tucking the chair").
- **Bad at:** what A can't generate, Decisions can't invent. It also adds a second place where things can fail
  (that falls back to A's order, as `choose` already does).
- **Latency** +0.3–0.7 s, in parallel with analyse. **Cost** about 2k tokens of luna ≈ **$0.0002 per check**.
  **Effort** A + 2 h. **Demo risk** low.
- **Example:** coffee table / chair 3 → candidates: tuck chair (moves 25 cm, frees 30 cm of walkway), move chair
  10 cm NW, rotate the coffee table (blocks nothing). Decisions picks "tuck chair 3", 0.71.

### C · A reasoning model proposes, code verifies (gpt-6.1-terra)
Terra gets the room JSON and the finding (or all findings at once) and returns up to 3 fixes as moves, rotations,
removals or swaps. Code checks each one (`legal()` plus the finding's own check, as in A) and drops the ones that
fail. Optionally it retries once, telling the model why a fix failed.
- **Good at:** creative, several-piece fixes and plain-language reasons ("swap the 2.4 m sofa for a 2 m one and the
  path opens"), and anything A has no generator for.
- **Bad at:** speed (**15 s measured**; a phone user won't wait after a tap), and repeatability (different fixes each
  run). Some proposals fail verification. It can only be instant if precomputed in the background after "Check
  my room".
- **Cost** about $0.007 per finding, or about $0.02 for all of them in one call. **Effort** 4–6 h. **Demo risk**
  medium-high: latency, and a fix might move the sofa into the TV.
- **Example:** overlap → "Move the coffee table 16 cm south" (verified ✓), "Rotate the coffee table and move it
  south" (✓), "Remove dining chair 3" (✓, but not something Kate wants).

### D · The fix is a product (Find for me with the gap's size)
For findings whose fix is a thing: lamp, coffee table, too tall, style, a shorter sofa for path_blocked. Code
works out the target (where it goes, max width × depth, size guide), and the card offers "Find one that fits".
That calls `POST /api/agent/find` with the size and spot already filled in, and the result places itself.
- **Good at:** the most "magic" demo moment, and the OpenAI story runs end to end: web search, page reading and
  rules fit. It turns soft design findings into actions ("a floor lamp ≤ 30 cm fits in the north-west corner:
  IKEA HEKTAR £35").
- **Bad at:** slow (about 50 s, per the board), and it depends on the live web. It is only useful for 3–4 finding
  types.
- **Cost** roughly $0.05–0.15 per find (terra + web search, several page reads). **Effort** 3–4 h (target per
  finding + wiring the existing Find). **Demo risk** medium. Pre-warm or cache one result for the demo.
- **Example:** "The coffee table is 38% of the sofa's length" → "A coffee table 1.2–1.5 m long, 35–45 cm from the
  sofa, would be in proportion" → Find → 3 tables, tap → placed, re-checked, finding goes green.

### How a fix shows (shared by all four, about 3–4 h of app work)
- **Tap a pin or card** → the bottom sheet opens to that finding: the sentence, then 1–3 fix chips ("Tuck chair 3",
  "Move 10 cm", "Find a bigger table").
- **Preview:** tapping a chip shows a translucent ghost of the piece at its new place (`viewer.ghost`), with the
  original dimmed and the dashed arrow (already drawn). A before/after toggle is the same thing on a switch.
- **Apply** moves the piece in `state.room` (it becomes an unsaved room, which the API already accepts) and
  re-runs "Check my room", so the pin turns green or disappears. **Undo** is one level: the previous room
  is kept in memory.
- **On a phone:** chips are thumb-sized in the sheet, the camera flies to the finding, and the ghost shows the
  change. Kate does not have to read cm. Desktop uses the same list panel.

## 4. Cutting the 10 findings down for the demo

1. **Merge duplicates:** `flow` folds into `path_blocked` when they share an item or are within 1 m (here: both "by
   the sofa"). Use one number, the rules' one. 9 → 8.
2. **Severity order:** model `fail`, then design `fail`, then `warn`. Show the **top 3** as cards and pins; the rest
   go under "3 more things to look at" (collapsed, no pins until opened).
3. **Passes:** one green line ("TV distance is right"), not a card or a pin.
4. **Near-threshold warns go quiet:** a walkway ≥ 60 cm (it "just fits"), or a design finding with p 0.4–0.5, goes into
   "more", never into the top 3.
5. **Prefer findings with a fix** when ranking within a severity, so every top card has a button.
6. **Clean the room data** (lane A, not this session): chair 3 sits inside the coffee table, and the rough chair boxes
   cause the "room cut in two" finding. With them corrected, the real-room check drops to about 4 honest findings.

Result for Kate's room: **(1)** chair 3 overlaps the coffee table → *tuck it under the table* ·
**(2)** north-west corner is dark → *find a floor lamp that fits there* · **(3)** coffee table too small for the sofa →
*find a 1.2–1.5 m table*. Below that: "3 more" (bag in the desk walkway, daylight, bookshelf 60 cm), and one green
line for the TV.

## 5. Recommendation

**B + D, built in that order, behind the new tap-to-fix sheet, with the top-3 cut.**
- B for the geometric findings: instant, always right, and it shows the Decisions API choosing with a
  confidence. It reuses the best-spot pattern, so the risk is low.
- D for the 2–3 design findings whose fix is a product (lamp, coffee table). That gives the demo's wow moment,
  and Find for me already exists.
- path_blocked stays without a fix ("needs a rearrange: ask the room"), and the room data is corrected so it
  stops appearing.
- Skip C for the demo: 15 s per tap and non-deterministic. Keep it as the voice answer to "how would you fix
  this?" later.

Rough effort: rules generators 4 h + Decisions pick 2 h + sheet/ghost/apply/undo 3–4 h + product targets 3 h + top-3
cut 1 h ≈ **13–14 h**. B alone with the sheet and top-3 is about 8 h.
