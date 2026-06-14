# Autopilot prompt-improvement log

Systematic A/B optimization of the LLM autopilot policy. Each row is one A/B
comparison of a candidate prompt variant against a baseline, produced by
`src/experiments/ab-test.ts`. Variants live in `experiments/variants/*.json`;
per-run transcripts and JSON live in `experiments/runs/<id>/` (gitignored).

Methodology: 4-player games, each seating 2 candidate + 2 baseline players with
seat positions rotated across seeds to cancel turn-order advantage. Delta is the
candidate's mean score per seat minus the baseline's. Win share is the fraction
of games a candidate seat takes the top score. `p` is a two-sided sign test over
per-game paired deltas. Games whose decisions fell back to the scripted policy
above the contamination threshold are excluded.

| when (UTC) | candidate | baseline | model | counted | Δ/seat | win% | p | verdict |
|---|---|---|---|---|---|---|---|---|
| 2026-06-13 08:51 | baseline | baseline | sonnet-4-6 | 4/4 | -1.4 | 50% | 1.000 | no significant difference (delta -1.4 pts/seat, p=1.000) |
| 2026-06-13 09:43 | cand-gate-growth-on-food-engine-0 | baseline | sonnet-4-6 | 4/4 | -8.0 | 25% | 0.625 | no significant difference (delta -8.0 pts/seat, p=0.625) |
| 2026-06-13 10:18 | cand-secure-food-early-with-buffer-1 | baseline | sonnet-4-6 | 1/4 | -4.5 | 0% | 1.000 | no significant difference (delta -4.5 pts/seat, p=1.000) |
| 2026-06-13 10:50 | cand-fill-categories-and-spaces | baseline | sonnet-4-6 | 4/4 | +2.5 | 25% | 1.000 | no significant difference (delta 2.5 pts/seat, p=1.000) |
| 2026-06-13 11:25 | cand-major-ability-cheatsheet | baseline | sonnet-4-6 | 1/4 | +15.5 | 100% | 1.000 | no significant difference (delta 15.5 pts/seat, p=1.000) |
| 2026-06-13 12:08 | cand-memory-chat | baseline | sonnet-4-6 | 4/4 | -5.0 | 25% | 0.625 | no significant difference (delta -5.0 pts/seat, p=0.625) |
| 2026-06-13 12:48 | cand-major-ability-cheatsheet | baseline | sonnet-4-6 | 4/4 | +2.1 | 0% | 1.000 | no significant difference (delta 2.1 pts/seat, p=1.000) |
| 2026-06-13 13:24 | cand-secure-food-early-with-buffer-1 | baseline | sonnet-4-6 | 4/4 | -6.6 | 13% | 0.250 | no significant difference (delta -6.6 pts/seat, p=0.250) |
| 2026-06-13 16:57 | cand-major-ability-cheatsheet | baseline | sonnet-4-6 | 8/8 | +3.4 | 50% | 0.453 | no significant difference (delta 3.4 pts/seat, p=0.453) |
| 2026-06-13 17:32 | cand-fill-additive | baseline | sonnet-4-6 | 8/8 | -3.9 | 31% | 0.016 | candidate WORSE by 3.9 pts/seat (sign-test p=0.016) |
| 2026-06-14 05:45 | baseline | baseline | sonnet-4-6 | 4/4 | -5.5 | 50% | 1.000 | no significant difference (delta -5.5 pts/seat, p=1.000) |
| 2026-06-14 06:33 | cand-raw-animals-zero-food | baseline | sonnet-4-6 | 8/8 | -5.8 | 25% | 0.289 | no significant difference (delta -5.8 pts/seat, p=0.289) |
| 2026-06-14 07:08 | cand-food-engine-sequencing | baseline | sonnet-4-6 | 8/8 | +12.4 | 75% | 0.070 | candidate BETTER by 12.4 pts/seat (sign-test p=0.070) |
| 2026-06-14 07:46 | cand-food-engine-sequencing | baseline | sonnet-4-6 | 8/8 | +6.7 | 63% | 0.727 | no significant difference (delta 6.7 pts/seat, p=0.727) |
| 2026-06-14 08:37 | cand-grow-early-affirmative-trigger | baseline | sonnet-4-6 | 8/8 | +3.0 | 63% | 0.289 | no significant difference (delta 3.0 pts/seat, p=0.289) |
| 2026-06-14 09:13 | cand-fence-copy-suggested-plans | baseline | sonnet-4-6 | 8/8 | -1.3 | 38% | 1.000 | no significant difference (delta -1.3 pts/seat, p=1.000) |
| 2026-06-14 09:48 | cand-board-coverage-midgame-1 | baseline | sonnet-4-6 | 8/8 | +3.8 | 38% | 0.289 | no significant difference (delta 3.8 pts/seat, p=0.289) |
| 2026-06-14 10:28 | cand-grow-and-cover | baseline | sonnet-4-6 | 8/8 | +8.4 | 88% | 0.289 | no significant difference (delta 8.4 pts/seat, p=0.289) |
| 2026-06-14 11:09 | baseline | orig-baseline | sonnet-4-6 | 8/8 | +13.6 | 75% | 0.070 | candidate BETTER by 13.6 pts/seat (sign-test p=0.070) |
