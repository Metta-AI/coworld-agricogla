# Autopilot prompt optimization — summary

A systematic, A/B-tested loop improved the Bedrock LLM autopilot policy over four
iterations. Full method in `README.md`; per-iteration detail in
`findings-iter1.md`..`findings-iter4.md`; the raw ledger in `log.md`.

## Headline result

**Fully-optimized policy vs the original pre-optimization prompt (Sonnet 4.6,
4-player, 8 games):**

| | mean score / seat | win share | paired |
|---|---|---|---|
| **optimized** | **+12.7** | **75%** | won 7 of 8 |
| original | −0.9 | 25% | — |

**Δ = +13.6 points/seat** (sign-test p=0.07). The original prompt scored roughly
break-even; the optimized policy scores solidly positive. Category deltas show
every shipped change contributing: Begging +6.2, Unused spaces +2.2, Fields +2.0,
Family +1.9, Vegetables +0.9.

## What shipped (3 A/B-confirmed prompt changes)

1. **Majors-ability cheatsheet** (rules block, iter 2) — the board showed majors
   as name/cost/vp only; adding their engine-verified abilities stopped the model
   buying grain-only ovens during animal-food crises. Begging +3.0/seat.
2. **Food-engine sequencing plan** (strategy block, iter 3) — replaced the
   one-line strategy with a priority order (food first → recurring food engine by
   ~r4 → grow once fed → fill late). +9.5/seat pooled over 16 games; the biggest
   single win. Largely solved starvation.
3. **Grow-early + mid-game board coverage** (strategy block, iter 4) — fixed an
   over-gate the iter-3 change introduced (family growth slipping to r12-14) and
   pulled board-filling forward from r12 to mid-game. +8.4/seat combined.

## What was tested and rejected (6 directions, with evidence)

gate-growth (−8), secure-food buffer (−6.6), fill-board aggressive (−3.9,
p=0.016), raw-animals "NEVER take animals" ban (−5.8), diary+chat capabilities
(−5), fence-copy (wash). The losers were all **restrictive** (forbidding/gating
actions); the winners were all **constructive** (plans, accurate facts). That
principle is now encoded in the workflow.

## The machinery (reusable)

- `src/experiments/` — per-seat-prompt game runner, A/B harness (seat rotation,
  paired sign test, fallback-contamination exclusion, preflight credential check,
  transcript condenser), Bedrock prompt caching, diary/chat capabilities.
- `.claude/workflows/improve-autopilot.js` — memory-aware workflow: fan-out
  analysts → rank → propose → adversarial rule-check; takes `priorLessons` so it
  stops re-proposing known losers.
- Run another round: generate transcripts (`ab-test.ts --candidate baseline
  --baseline baseline`), condense, run the workflow on the digests, A/B its
  candidates, promote confirmed wins into `prompt.ts`.

## Status

Diminishing returns reached: begging (the dominant failure) is solved, and
iteration-4 marginal effects (~+3-4/seat per change) are well below iteration 3's.
A sensible pause point. Remaining smaller levers: occupation/minor card
valuation, renovation timing, fence-geometry handling.
