# Iteration 1 findings — autopilot prompt A/B (Sonnet 4.6, 4-player)

Baseline = shipped `SYSTEM_PROMPT`. Each candidate seated 2 vs 2 against baseline,
seeds 11/22 rotated (4 clean games each). Totals are noisy (per-seat scores swing
−31…+26), so **per-category deltas** (candidate seats − baseline seats) are the
higher-signal read and are reported below.

## Results (clean games, 0% fallback)

| candidate | block | total Δ/seat | what the categories show |
|---|---|---|---|
| **cand-major-ability-cheatsheet** | rules | **+2.1** | Begging **+3.4**, Unused +1.1, Fields +1.1; ~no collateral. Cleanest win. |
| **cand-fill-categories-and-spaces** | strategy | **+2.5** | Unused **+4.0**, Begging +3.8, diversification up — but Card points −5.9, Family −4.9, Rooms −3.8. |
| cand-memory-chat | capabilities | −5.0 | Begging **−4.5** (worse), animals/pastures down. Diary+chat distracted from feeding. |
| cand-secure-food-early-buffer | strategy | −6.6 | Card −2.4, Unused −2.0, Family −1.5, animals down; Begging only +1.9. Food obsession. |
| cand-gate-growth-on-food-engine | strategy | −8.0 | Family **−7.5**, Rooms −3.0 (over-correction); Begging +5.2 as intended. |

Nothing is statistically significant at n=4 (all p ≥ 0.25); these are directional
mechanism reads, not proofs.

## Lessons

1. **Factual/informational prompt additions beat behavioral re-prioritizations.**
   `major-cheatsheet` just makes the majors' real abilities visible (the board
   showed name/cost/vp only), and the model stops buying grain-only ovens during
   animal-food crises → Begging +3.4 with no downside. In contrast, every
   strategy-block candidate that *tells the model to prioritize X* steals
   actions/attention from **family growth and card play** (both high value) and
   nets negative or barely positive.

2. **Family growth is sacrosanct.** Both candidates that constrained growth
   (`gate-growth`, `secure-food`) cratered the Family category and lost overall,
   even though they reduced begging. A member is 3 pts + an extra action every
   remaining round; delaying it is rarely worth it. The workflow's highest-
   confidence fix (gate growth) was the *worst* candidate — exactly why we A/B.

3. **The diary/chat capabilities hurt here** (Begging −4.5): the extra surface
   pulled attention from the core feeding/development loop. Not worth enabling in
   the policy default on this evidence (they remain available + A/B-testable).

4. **Total score is too noisy to confirm small effects on Sonnet 4p.** Detecting
   a ~+2.5/seat effect against this variance needs many games. Prefer
   per-category deltas (above) and larger n; consider candidate-vs-fixed-scripted
   to cut opponent variance.

## Next (iteration 2)

- **Promote `cand-major-ability-cheatsheet`** — cleanest, lowest-risk gain;
  ideally confirm at n≥8 first.
- **Refine `fill-categories` to be ADDITIVE, not substitutive** — keep the
  fill-the-board targets but explicitly preserve family-growth and card priority
  (its losses were Family/Cards, its gains were Unused/Begging/diversity).
- Combined `cand-fill-and-majors` is built but may inherit fill's Family/Card
  loss; test major-alone vs combined.
- Drop the constraint candidates (`gate-growth`, `secure-food`) and the
  capability candidate (`memory-chat`) from promotion.
