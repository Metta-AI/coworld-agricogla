# Iteration 4 findings — self-correction + the combined strategy

Workflow now carries the prior-A/B ledger and the constructive-not-restrictive
principle, so it skipped every known loser and found genuinely new, constructive
levers — including a regression its own predecessor (iter 3) introduced.

## Results (8 games each unless noted)

| candidate | block | Δ/seat | b/w/t | mechanism |
|---|---|---|---|---|
| cand-grow-early-affirmative-trigger | strategy (step 3) | +3.0 | 6/2/0 | Family +2.2, Begging −1.1 |
| cand-board-coverage-midgame-1 | strategy (step 4) | +3.8 | 6/2/0 | Unused +2.3, Fields/Sheep/Veg/Pastures up; Family −2.6 |
| cand-fence-copy-suggested-plans | rules | −1.2 | 4/4/0 | wash — dropped |
| **cand-grow-and-cover** (combination) | strategy (3+4) | **+8.4** | 6/2/0 (88% win share) | Unused +2.5 AND Family +2.2 — gains stack |

cand-grow-and-cover was confirmed on fresh seeds (77–111), 8/8 clean.

## PROMOTED: cand-grow-and-cover → `DEFAULT_BLOCKS.strategy`

The two positive single-step refinements compose: the affirmative grow-early
step 3 supplies the Family points that the board-coverage step 4 would otherwise
spend, so the combination (+8.4/seat) beats either alone (+3.0, +3.8). The
shipped strategy is now: (1) food first, (2) recurring food engine by ~r4,
(3) grow early and often (room by r3-4, 3rd member by r5-6, grow the moment a
room is open and the next single +2 is coverable), (4) cover the board +
categories from mid-game.

## Lessons

1. **The loop self-corrects.** Iter-3's sequencing win over-gated growth ("do
   NOT grow until a repeatable source covers +2"), which the model read as a
   hard gate — one seat built a room at r6 and never grew, finishing last. The
   memory-aware workflow caught this and reframed the gate into an affirmative
   trigger. Optimizing one weakness can introduce another; re-baselining each
   round surfaces it.

2. **Constructive framing rescues a previously-failed idea.** "Fill the board"
   lost at p=0.016 in iter 2 when pushed aggressively. The same goal, reframed
   as "compute your empty spaces/categories each turn and fix ~1 per round from
   mid-game," won (+3.8, and +8.4 combined). Timing + framing, not the goal,
   was the problem.

3. **Feeding the workflow its own history works.** Passing `priorLessons` made it
   stop re-proposing gate-growth/fill-board/never-bans and explore new levers.

## Diminishing returns

Iter-4 per-change effects (+3–4/seat) are well below iter-3's +9.5 now that
begging is solved. The combined +8.4 is real but the marginal weaknesses left
(card valuation, renovation timing, fence geometry) are smaller and noisier.
This is a sensible point to pause the spend-heavy loop.

## Shipped policy after iteration 4

`DEFAULT_BLOCKS` = baseline + majors cheatsheet (rules, iter 2) + food-engine
sequencing with affirmative grow-early and mid-game board coverage (strategy,
iters 3–4). Three confirmed, A/B-promoted improvements; six candidate directions
tested-and-rejected with evidence.
