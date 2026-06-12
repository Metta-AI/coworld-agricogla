# cogame-agricola

A full web port of the board game **Agricola** (1–4 players): complete game
engine, a board-game-styled web UI, and per-player autopilots that can be
scripted or driven by an LLM on AWS Bedrock. Built in the style of the other
`cogame-*` projects (Vite + React + TypeScript, express + ws, zod, vitest,
Playwright).

The complete rules specification lives in [RULES.md](RULES.md). The board game
itself — boards, action spaces, round cards, the ten major improvements, the
harvest cycle, and scoring — is an exact port. The occupation and minor
improvement decks are this port's own fully implemented deck (51 occupations +
48 minors) built on the canonical archetypes; card names and texts are written
for this project.

## Quick start

```bash
npm install

# Headless game in the terminal (any mix of scripted|random|llm)
npm run play -- --seed 3 --players 4
npm run play -- --seed 3 --players 2 --agents scripted,random

# Web game: build the UI once, then serve
npm run build:web
npm run serve -- --port 8484 --players 4 --agents scripted,scripted,scripted,scripted
# open http://localhost:8484/            (table view)
# open http://localhost:8484/player/0    (seat view for player 0)
```

Every seat has a controller — `human`, `scripted` (heuristic autopilot), or
`llm` (Bedrock) — switchable live from the dropdown on each player panel.
Humans play by clicking an open action space; parameterized actions (building,
fences, sowing, improvements, feeding) open dialogs validated against the
engine before submission.

## LLM autopilots (Bedrock)

```bash
AWS_PROFILE=... AWS_REGION=us-west-2 npm run serve -- --agents llm,llm,llm,llm
```

- Model: `AGRICOLA_BEDROCK_MODEL` (default `us.anthropic.claude-haiku-4-5-20251001-v1:0`)
- Region: `AGRICOLA_BEDROCK_REGION` / `AWS_REGION` (default `us-west-2`)
- The agent gets the full visible state and its legal options, must answer via
  a `submit_placement` / `submit_feeding` tool call, gets up to 3 attempts with
  engine-validated feedback, and falls back to the scripted policy if it keeps
  misbehaving. Transcripts appear in the UI under "Autopilot transcripts".

## Layout

- `src/shared/engine/` — pure, deterministic rules engine (seeded RNG, no IO).
  `cards/` holds the major/occupation/minor decks with their effect hooks.
- `src/agents/` — agent interface, heuristic + random bots, Bedrock LLM agent.
- `src/server/` — game runner (controllers, pacing, pause/reset), express + ws.
- `src/client/` — React UI (action board, farmyards, dialogs, scoring, log).
- `tests/smoke/` — Playwright end-to-end tests.

## Commands

```bash
npm test            # vitest unit tests (engine, cards, agents, server)
npm run typecheck   # tsc --noEmit
npm run smoke       # Playwright (builds web, starts server on :4173)
npm run dev         # vite dev server (proxies /ws to :8484 — run `npm run serve` too)
```

## Artwork

All visual assets in `public/art/` (goods/animal tokens, farm tiles, table and
parchment textures) are original images generated for this project with
nano-banana (Gemini image generation) and post-processed by
`scripts/process-art.py` (background matting, cropping, resizing). Raw
generations land in `generated_imgs/` (gitignored); re-run the script after
regenerating any of them.

## Coworld (Softmax tournaments)

This repo doubles as a Softmax **Coworld**: a Dockerized game container that
runs head-to-head (2-player) tournament episodes against remote policy
containers. The coworld server (`src/server/coworld-main.ts`) implements the
Coworld game contract — `COGAME_CONFIG_URI` config, `/healthz`,
`/player?slot&token` WebSockets (engine-validated decisions, 3 attempts,
scripted fallback on timeout/disconnect), `/client/global` live viewing, a
browser replay viewer at `/client/replay`, and results/replay artifacts.
`src/agents/coworld-player.ts` is the bundled scripted baseline policy.

```bash
npm run build:coworld-manifest   # regenerate coworld_manifest_template.json from docs/coworld/
uvx --from 'coworld[auth]' coworld build compose.yaml coworld_manifest_template.json <version> tmp/coworld_manifest.json
uvx --from 'coworld[auth]' coworld certify tmp/coworld_manifest.json
uvx --from 'coworld[auth]' coworld upload-coworld tmp/coworld_manifest.json
```

The wire protocol for policy authors lives in
[docs/coworld/player_protocol.md](docs/coworld/player_protocol.md); the
manifest embeds it (and the rules overview) as inline docs.

## Digital-port notes

- Animal housing is auto-packed (rearrangement is free in the rules); animals
  that cannot fit are cooked at the best owned rate or released, and feeding
  conversions are always chosen explicitly (or via auto-feed).
- Solo rules included (0 starting food, 3 food per member, 2-wood Forest).
- 5-player play is out of scope; the engine validates 1–4.
