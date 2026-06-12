# AGENTS.md

Guidance for AI assistants working in this repo.

## Architecture invariants

- `src/shared/engine/` is pure and deterministic: no IO, no `Date.now()`, no
  `Math.random()` — all randomness flows through the seeded RNG (`rng.ts`).
  `GameState` is JSON-serializable; card behavior lives in code
  (`cards/*.ts`) keyed by card id and must never be stored in state.
- Engine state transitions (`applyPlacement`, `applyFeeding`) validate and
  throw `RuleError` on illegal input; they operate on a structured clone and
  never mutate their argument.
- `src/agents/` may import the engine; the engine must not import agents,
  server, or client code. The client imports the engine directly to compute
  legal options locally — keep engine code browser-safe.
- The wire protocol (`src/shared/protocol.ts`) is zod-validated on the server.
  Other players' hands are redacted server-side (`src/server/redact.ts`).

## Rules fidelity

`RULES.md` is the spec. If a rules question comes up, fix the spec and the
engine together, and add a unit test reproducing the ruling. Scoring tables,
action-space data and harvest flow follow the original base game (1–4 players);
the occupation/minor decks are this port's own implemented deck.

## Commands

```bash
npm test                 # vitest (engine, cards, agents, server)
npm run typecheck
npm run play -- --seed 3 --players 4          # headless game
npm run serve -- --port 8484                  # web server
npm run smoke            # Playwright e2e (builds web first)
```

Always run `npm test && npm run typecheck` before committing; run the smoke
suite when the server, protocol, or client changed.

## Coworld mode

`src/server/coworld-main.ts` is the Softmax Coworld entrypoint (rollout +
replay modes); `src/server/coworld/` holds the remote-player agent and
artifact IO. The wire protocol docs in `docs/coworld/*.md` are embedded into
`coworld_manifest_template.json` by `npm run build:coworld-manifest` — edit
the docs, regenerate the template, and commit both. Remote decisions are
dry-run validated with 3 attempts and an act timeout, then the scripted
policy takes the turn — same termination guarantee as the LLM agents.

## LLM agents

Bedrock Converse with tool-use (`src/agents/llm/`). Decisions are dry-run
validated against the engine; after 3 failed attempts the scripted policy
takes over, so games always terminate. Don't remove that fallback.
