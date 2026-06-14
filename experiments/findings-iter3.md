# Iteration 3 findings — the big win: constructive food-engine sequencing

Re-baselined against the iteration-2 policy (baseline + majors cheatsheet),
regenerated self-play transcripts (begging already much lower: 11/16 seats
beg-free), re-ran the workflow, and A/B'd the proposals.

## Results

| candidate | block | run | Δ/seat | b/w/t | Begging Δ | verdict |
|---|---|---|---|---|---|---|
| **cand-food-engine-sequencing** | strategy | seeds 11-44 | **+12.4** | 7/1/0 | +11.1 | win |
| **cand-food-engine-sequencing** | strategy | seeds 77-111 (fresh) | **+6.7** | 5/3/0 | +7.5 | win (replicated) |
| cand-raw-animals-zero-food | rules | seeds 11-44 | −5.8 | 2/6/0 | +2.2 | lose |

Pooled food-engine-sequencing: **12 of 16 games candidate-better, ~+9.5/seat, Begging +7..+11 in both runs** (pooled sign-test p≈0.077). Largest, best-replicated improvement of the project.

## PROMOTED: cand-food-engine-sequencing → `DEFAULT_BLOCKS.strategy`

The baseline strategy was a single thin sentence with no priorities. The new
block is a constructive 4-step plan: (1) food first, but one-shot food workers
are the weakest action; (2) build a RECURRING food engine by ~round 4 (free
first occupation, cooker, or Joinery/Pottery/Basketmaker per-harvest converters);
(3) grow family only once a repeatable source covers the +2 food/mouth; (4) then
fill categories and spend surplus late. Content verified against RULES.md and the
engine. It essentially solved the starvation that decided games.

## The key principle (corrected from iter 1-2)

Earlier I concluded "strategy rewrites backfire." Iteration 3 refines that:
**constructive sequencing wins; restrictive constraints lose.**

- LOST (all restrictive): gate-growth ("don't grow until…", −8), secure-food
  ("hoard a buffer", −6.6), fill-board ("fill empty cells", −3.9, p=0.016),
  raw-animals ("NEVER take animals unless…", −5.8).
- WON (constructive): food-engine-sequencing gives a full priority plan that
  builds the capability instead of forbidding the symptom (+9.5/seat).

Even the "factual" raw-animals fix lost: its core fact was right, but the
"NEVER take animals" imperative over-suppressed animals (Pastures/Sheep/Cattle
all dropped). Phrasing a fix as a ban steals high-value actions; phrasing it as
a plan does not.

## Shipped policy after iteration 3

`DEFAULT_BLOCKS` = baseline + majors-ability cheatsheet (rules, iter 2) +
food-engine sequencing plan (strategy, iter 3). Two A/B-confirmed improvements,
both targeting the dominant failure (begging) from different angles.

## Next (iteration 4) — workflow improvements warranted

- Feed accumulated findings into the workflow so it stops re-proposing known
  losers (it re-suggested gate-growth-like and fill-like candidates this round).
- Untried levers: the scoreboard-visibility *render* change (surface unused-cell
  and empty-category penalties each turn — needs per-seat render toggling in the
  harness), and occupation/minor card valuation.
