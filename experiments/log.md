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
