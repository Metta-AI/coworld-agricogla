# Autopilot prompt-improvement loop

A systematic, A/B-tested optimization loop for the LLM autopilot policy. It runs
real Bedrock games where each seat can run a different prompt, studies the
transcripts, proposes prompt changes, and A/B-tests each one against the
baseline before keeping it.

## The policy, broken into iterable surfaces

The autopilot prompt is split so each piece can be changed and tested in
isolation (see [`src/agents/llm/prompt.ts`](../src/agents/llm/prompt.ts)):

| surface | where | what it controls |
|---|---|---|
| `intro` / `rules` / `strategy` / `output` blocks | `prompt.ts` `DEFAULT_BLOCKS` | the system prompt (framing, rules, heuristics, answer discipline) |
| state rendering | `render.ts` `renderPlacementPrompt` / `renderFeedingPrompt` | how the board + options are described each turn |
| `guidance` | per-seat directive | free-text operator steering, prepended to every prompt |
| `capabilities` | per-variant flags | optional autopilot abilities (see below) |

`composeSystemPrompt(DEFAULT_BLOCKS)` is **byte-identical** to the shipped
`SYSTEM_PROMPT`, so "baseline" in every experiment is the real production policy.

## Capabilities: diary + chat

Two optional abilities, off in the baseline so they can be A/B-tested:

- **memory (diary):** the model passes a `diary` field in its tool call to save a
  short note; its accumulated diary (last 16 entries) is shown back every turn
  under "YOUR DIARY". Helps the model keep a coherent multi-turn plan. Owned by
  the agent instance, persists across the game.
- **chat (table-talk):** the model passes a `say` field to post a public message
  to the other cogs; messages other cogs sent (public + DMs to it) are shown
  under "MESSAGES FROM OTHER COGS". Plugs into the existing `ChatMessage` feed,
  so in the web game these show up in the chat panel too.

Enable them in a variant:

```json
{ "name": "cand-memory-chat", "parent": "baseline",
  "capabilities": { "memory": true, "chat": true },
  "blocks": { "strategy": "... nudge to actually use the diary / watch chat ..." } }
```

## Bedrock prompt caching (token savings)

Every LLM call sets a Bedrock cache breakpoint after the system prompt **and**
after the tool schema, so the constant prefix (~1.4K tokens incl. the tool
schema) is written to cache once and **re-read on every subsequent decision** at
~10% of input price. A ~200-decision game re-reads that prefix ~199×. The
per-turn user message (board state + diary + messages) is the only uncached
input. `GameResult.usage` and `ab-summary.md` report the cached input fraction;
verify with `cacheReadInputTokens > 0` after the first call.

## Variants

A **variant** is a partial override of the baseline, stored as JSON in
[`experiments/variants/`](variants/):

```json
{
  "name": "cand-grow-family-early",
  "parent": "baseline",
  "notes": "push earlier family growth",
  "blocks": { "strategy": "FULL replacement text for the strategy block ..." },
  "guidance": ""
}
```

Only the blocks you list are overridden; the rest inherit from `parent`
(default `baseline`). `resolveVariant()` composes it into a full prompt.

## The loop

```
   ┌─ 1. generate transcripts ──────────────────────────────────────────┐
   │  ab-test.ts --candidate baseline --baseline baseline  (self-play)   │
   └────────────────────────────────────────────────────────────────────┘
                              │ transcripts + scores
                              ▼
   ┌─ 2. analyze + propose (Workflow: improve-autopilot) ───────────────┐
   │  fan-out analysts per game-facet → rank weaknesses →                │
   │  propose minimal candidate variants → adversarial rule-check        │
   └────────────────────────────────────────────────────────────────────┘
                              │ accepted candidate variants
                              ▼
   ┌─ 3. A/B test each candidate vs baseline ───────────────────────────┐
   │  ab-test.ts --candidate <name>   (2 cand + 2 base seats/game,       │
   │  seat positions rotated across seeds; sign test on per-game deltas) │
   └────────────────────────────────────────────────────────────────────┘
                              │ verdicts appended to log.md
                              ▼
   ┌─ 4. keep winners, recurse on the new baseline ─────────────────────┐
   │  promote a winning block into prompt.ts (or chain via parent), then │
   │  go back to step 1 with the improved policy as the baseline.        │
   └────────────────────────────────────────────────────────────────────┘
```

## Commands

All Bedrock runs need an AWS account with Anthropic Bedrock access enabled
(the `softmax-org` management account does **not**; use `softmax`):

```bash
export AWS_PROFILE=softmax AWS_REGION=us-west-2
```

**One game, custom seats** (smoke / debugging):

```bash
npx tsx src/experiments/run-game.ts --seed 1 \
  --seats llm:baseline,llm:baseline,scripted,scripted \
  --model us.anthropic.claude-sonnet-4-6
```

**A/B a candidate vs baseline** (4-player, 2 candidate + 2 baseline seats,
positions rotated across seeds — moderate run is 4 seeds × 2 = 8 games):

```bash
npx tsx src/experiments/ab-test.ts --candidate cand-grow-family-early \
  --baseline baseline --seeds 11,22,33,44 --model us.anthropic.claude-sonnet-4-6
```

> A 4-player Sonnet game is ~200 sequential LLM calls (~10–15 min). Run A/B
> sets in the background; do not block on them. `AGRICOGLA_BEDROCK_CONCURRENCY`
> (default 8) gates process-wide Bedrock concurrency; the client retries
> throttling with backoff so throttles don't silently degrade a seat to the
> scripted fallback.

**Analyze + propose** (the `improve-autopilot` workflow — consumes transcripts,
emits candidates; it does *not* run games):

The workflow takes the transcript paths from a completed run and returns ranked
weaknesses + rule-checked candidate variants. The caller writes each accepted
candidate to `experiments/variants/<name>.json` and runs its A/B command.

## Reading results

- `experiments/log.md` — one row per A/B comparison (Δ/seat, win share, p-value,
  verdict). The running ledger of what was tried and what stuck.
- `experiments/runs/<id>/ab-summary.md` — per-comparison report with a per-game
  table.
- `experiments/runs/<id>/*.transcript.txt` — full per-decision transcripts
  (prompt + model reasoning + tool calls + any fallbacks). The raw material for
  analysis. (`experiments/runs/` is gitignored.)

## Methodology notes

- **Fairness:** within each seed the candidate plays both seat arrangements, so
  it occupies every board position equally — turn order can't bias the result.
- **Signal vs noise:** the verdict uses a paired sign test over per-game
  (candidate-mean − baseline-mean), plus mean Δ/seat and win share. Treat a
  single 8-game run as a screen, not proof; re-run promising candidates with
  more seeds before promoting.
- **Contamination:** if a game's decisions fall back to the scripted policy
  above the threshold (default 15%), it's excluded — its score reflects the
  heuristic bot, not the prompt.
- **Isolation:** each candidate changes one block / idea so a score change is
  attributable. Stack winners by chaining `parent`.
