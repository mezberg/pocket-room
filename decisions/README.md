# decisions · lane E

The Decisions API answers bounded questions about an input, with probabilities. Pocket Room uses it in three
places. Code measures every number first, and the model only judges those numbers (docs/ENGINEERING.md, "Rules").

| Where | Function | Questions per request | Live latency |
|---|---|---|---|
| `POST /api/place` | `chooseBest(placement, { room, piece })` | 1 choice (which spot) + 1 choice per spot (which fact decides) | 0.6–1.1 s |
| `POST /api/analyse` | `gradeDesign(room, { piece, replaces })` | 6 (one per design check), in one request | 0.25–0.7 s, ~1.7k tokens |
| voice (lane C) | `routeUtterance(sentence, { selected, room })` | 1 choice: move / swap / ask / render | ~0.3 s |

Import from `decisions/index.mjs`. Live check: `node --env-file=.env decisions/smoke.mjs`. Tests (network mocked):
`npm test`.

## The API: `POST /v1/decisions`

This is real and usable with our key and `gpt-6-luna`. The shape below comes from the typings in `openai`
7.47 (`node_modules/openai/resources/decisions.d.ts`, called `openai.decisions.create`), and every part of it was
confirmed by live probes on 2026-11-01. No fallback to the Responses API was needed.

```js
await openai.decisions.create({
  model: "gpt-6-luna",                 // the only model it accepts (gpt-6.1-terra → 404)
  input: "text" | [message, ...],      // messages: role user|developer|system|assistant;
                                       // user content parts: input_text, input_image {image_url, detail}, input_json {data}
  questions: [                         // 1–400 questions; answers come back in the same order
    { name: "cozy",  type: "predicate", instructions: "The room will feel cozy." },
    { name: "best",  type: "choice",    instructions: "Which spot?", choices: [{ value: "east" }, { value: "west", description: "…" }] },  // 2–255
    { name: "light", type: "score",     instructions: "How well lit?", levels: [{ label: "dark" }, { label: "ok" }, { label: "bright" }] },  // ≥ 2
  ],
  prompt_cache_key: "…",               // optional; also prompt_cache_options, safety_identifier
});
```

Response:

```json
{ "model": "gpt-6-luna",
  "answers": [
    { "type": "predicate", "name": "cozy", "probability": 0.5 },
    { "type": "choice", "name": "best", "choice": "west", "confidence": 0.34,
      "probabilities": [{ "value": "east", "probability": 0.33 }, { "value": "west", "probability": 0.67 }] },
    { "type": "score", "name": "light", "score": 0.54, "confidence": 0.19,
      "probabilities": [{ "label": "dark", "value": 0, "probability": 0.49 }, { "label": "ok", "value": 1, "probability": 0.48 }, …] },
    { "type": "refusal", "name": "…" }
  ],
  "usage": { "input_tokens": 430, "output_tokens": 0, "total_tokens": 430, … } }
```

What the probes showed:
- `score` is the expected level index (0 … n−1), not a 0–1 number. `client.mjs` divides by n−1 to get `p`.
- It writes no text and no explanation (output tokens are 0). A "reason" therefore has to be a choice among
  sentences that code wrote, which is what best-spot does.
- Latency is ~0.3 s for one question and ~1.5 s for 20 predicates. One request with all the questions beats
  several requests.
- Errors are plain 400s that name the field (`questions[0].choices: array too short …`).

## Files

- `client.mjs`: `decide({ input, questions, cacheKey })` → answers by name, each with `p` (predicate: probability;
  choice: probability of the chosen value; score: expected level / (n−1)). It goes through `server/openai.mjs`,
  the model comes from `OPENAI_MODEL_DECISIONS`, and tests swap the network with `setTransport`.
- `geom.mjs`: footprints, fronts, openings, distances (metres, contract axes).
- `best-spot.mjs`: for each legal spot, code measures how far the TV is and how far off-axis, the gap to the
  glazing (and whether the piece blocks it), the gap to the radiator, the doors and the lamps. From those numbers it
  writes the true reasons ("faces the TV from 2.4 m", "covers the radiator"). Decisions picks the spot and, for each
  spot, the reason that matters most. If the call fails, the rules' own order is kept (`decision.by: "rules"`).
- `design.mjs`: the six checks below, then one request, then `finding`s.
- `route.mjs`: voice intent.
- `fixtures/placement-sofa-84.json`: a mock of lane D's placement for the fixture sofa. Replace it once `rules/`
  lands.

## Design checks (5b)

| id | Code measures | Decisions judges |
|---|---|---|
| `daylight` | glazing reach (2 × head height), share of floor in reach, each zone's distance to the glass | score poor/fair/good |
| `lamps_per_zone` | lights within 2 m of the sofa, dining table and desk; each corner's distance to a light | predicate: every zone lit, no dark corner |
| `flow` | widest route hall door → balcony door on a 5 cm grid: narrowest gap, what's either side, detour | predicate: easy and direct |
| `tv_distance` | sofa front to TV, off-axis angle, screen sizes for that distance (Misplaced `tvdistance.js` rule) | predicate: comfortable to watch |
| `coffee_table` | table length / sofa length, gap from sofa front (rule: ½–⅔, 35–45 cm) | predicate: in proportion, in reach |
| `style` | new piece's tags, colours and material, the room's style and furniture names, plus the photo if there is one | score clashes/neutral/matches |

A finding passes when `p ≥ 0.5`. Below 0.5 its severity is `warn`, and below 0.25 it is `fail`. `say` is written by
code from the measured numbers. `at` and `items` point the 3D marker. The model never sees the positions.

On the fixture, with the new sofa placed on the west wall, the checks give: daylight warn (the dining table is 5.0 m
from the glass, past the 4.6 m reach), lamps fail (the desk has no light), flow fail (32 cm between dining chair 3
and the sofa; the fixture's chair boxes are rough), TV pass, coffee table fail (42% of the sofa), style neutral.

## Hook for lane D (`server/routes/place.mjs`)

```js
import { chooseBest, gradeDesign } from "../../decisions/index.mjs";

r.post("/place", async (req, res, next) => { try {
  const room = /* the room */, piece = req.body.piece;
  let placement = /* rules/: { verdict, best, spots, say } */;
  placement = await chooseBest(placement, { room, piece });   // reorders spots, sets best + say, adds spot.decision
  res.json(placement);
} catch (e) { next(e); } });

r.post("/analyse", async (req, res, next) => { try {
  const room = req.body.room ?? /* load roomId */;
  const model = /* rules/ findings, kind "model" */;
  const { findings } = await gradeDesign(room, { piece: req.body.piece, replaces: req.body.replaces });
  res.json({ findings: [...model, ...findings] });
} catch (e) { next(e); } });
```

`chooseBest` never throws on an API failure; it falls back to the rules' order instead. `gradeDesign` does throw,
so wrap it in a try/catch if `/analyse` has to answer without it. Extra fields (`spot.decision`, `placement.decision`)
are additions and the contract shapes are otherwise unchanged.
