# Iteration 2 findings — confirm + promote

Higher-power A/B (8 games = 4 seeds × 2 seat arrangements) on the iteration-1
positives, refined. Sonnet 4.6, 4-player, 2 candidate vs 2 baseline.

## Results (clean 8-game runs)

| candidate | block | Δ/seat | b/w/t | sign-test p | mechanism (category deltas) |
|---|---|---|---|---|---|
| **cand-major-ability-cheatsheet** | rules | **+3.4** | 5/2/1 | 0.45 | Begging **+3.0**, Family +1.3, Rooms +1.1 — no collateral |
| cand-fill-additive | strategy | **−3.9** | 0/7/1 | **0.016** | Begging **−6.0**, Card −2.9, Rooms −2.4; Unused +2.6, Sheep +2.1 |
| cand-fill-additive-and-majors | strategy+rules | — | — | — | aborted: credential lapse caught by preflight (no contaminated data) |

## Decisions

- **PROMOTED `cand-major-ability-cheatsheet`** into the shipped prompt
  (`DEFAULT_BLOCKS.rules` in `src/agents/llm/prompt.ts`). It is a purely
  *informational* fix — the board renders majors as name/cost/vp only, so the
  model couldn't tell an animal-cooker (Fireplace/Hearth) from a grain-only oven
  (Clay/Stone Oven) and starved holding uncookable animals. Adding the
  engine-verified ability text cut begging consistently (+2.1/seat at n=4,
  +3.4/seat at n=8) with zero collateral damage. The sign test isn't p<0.05
  (won 5 of 8), but the effect is consistent across two independent runs, the
  mechanism is exactly the target, and showing the model accurate information
  carries essentially no downside risk. Every number was verified against
  `src/shared/engine/cards/majors.ts`.

- **ABANDONED the "fill the board" direction.** `cand-fill-additive` — even
  after reframing the targets as additive and explicitly protecting family
  growth + card play — was significantly *worse* (−3.9/seat, lost 7 of 8,
  p=0.016). Root cause: pushing the model to plow/sow/fence/stable trades away
  food security, and begging (−3/card) dominates (Begging −6.0). The board-fill
  goals (Unused +2.6, animals/pastures up) are real but not worth the food cost.
  Filling spaces is a *late-game-with-spare-resources* move, not a priority.

## Methodology note

The preflight credential check did its job: when SSO creds lapsed mid-batch, the
third A/B aborted loudly instead of silently running 8 games on the scripted
fallback and reporting garbage (the iteration-1 failure mode). No bad data
entered the ledger.

## Next (iteration 3)

The new baseline = baseline + majors cheatsheet. Re-run the `improve-autopilot`
workflow on fresh transcripts of the *new* baseline to find the next weakness.
Candidate directions not yet tried: feeding-time conversion discipline (convert
spare crops/animals before begging — a feeding-phase fix, lower behavioral cost
than the work-phase nudges that failed), and occupation/minor card valuation.
