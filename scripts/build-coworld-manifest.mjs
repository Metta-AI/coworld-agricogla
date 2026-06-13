// Regenerates coworld_manifest_template.json, embedding the markdown docs
// from docs/coworld/ as inline text (the GitHub repo is private, so doc
// URIs would not be readable by players). Run via:
//   npm run build:coworld-manifest
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const doc = (name) => readFileSync(join(root, "docs", "coworld", name)).toString();

const REPO_URL = "https://github.com/Metta-AI/cogame-agricogla";
const GAME_RUN = ["npx", "tsx", "src/server/coworld-main.ts"];
const PLAYER_RUN = ["npx", "tsx", "src/agents/coworld-player.ts"];

const playerSlots = (names) => names.map((name) => ({ name }));

const gameConfigSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["tokens", "players"],
  properties: {
    tokens: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "string", minLength: 1 },
    },
    players: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name"],
        properties: { name: { type: "string", minLength: 1 } },
      },
    },
    seed: {
      type: "integer",
      minimum: 0,
      description: "Engine RNG seed; omitted = random per episode.",
    },
    pace_ms: {
      type: "number",
      minimum: 0,
      maximum: 5000,
      default: 0,
      description: "Minimum ms between automated decisions, for live viewing.",
    },
    act_timeout_seconds: {
      type: "number",
      exclusiveMinimum: 0,
      maximum: 600,
      default: 20,
      description: "Per-decision budget before the scripted fallback takes the turn.",
    },
    player_connect_timeout_seconds: { type: "number", minimum: 0, default: 180 },
  },
};

const resultsSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  additionalProperties: false,
  required: ["scores", "winner", "rounds"],
  properties: {
    scores: {
      type: "array",
      minItems: 2,
      maxItems: 2,
      items: { type: "number" },
      description: "Final victory points per slot.",
    },
    winner: {
      type: "integer",
      minimum: -1,
      maximum: 1,
      description: "Slot index of the unique highest score, or -1 on a tie.",
    },
    rounds: { type: "integer", minimum: 1, maximum: 14 },
  },
};

const manifest = {
  $schema:
    "https://raw.githubusercontent.com/Metta-AI/coworld/main/src/coworld/coworld_manifest_schema.json",
  game: {
    name: "agricogla",
    description:
      "Head-to-head Agricogla: the classic worker-placement farming board game. " +
      "Plow, sow, fence, breed and feed your family across 14 rounds and six harvests; " +
      "every move is validated by a full rules engine.",
    owner: "daveey@gmail.com",
    runnable: {
      type: "game",
      image: "{{AGRICOGLA_IMAGE}}",
      run: GAME_RUN,
      source_url: REPO_URL,
    },
    config_schema: gameConfigSchema,
    results_schema: resultsSchema,
    protocols: {
      player: { type: "text", value: doc("player_protocol.md") },
      global: { type: "text", value: doc("global_protocol.md") },
    },
    docs: {
      readme: { type: "text", value: doc("coworld_readme.md") },
      pages: [
        {
          id: "rules_overview.md",
          title: "Rules overview",
          content: { type: "text", value: doc("rules_overview.md") },
        },
      ],
    },
  },
  player: [
    {
      id: "scripted-baseline",
      name: "Scripted Baseline",
      type: "player",
      image: "{{AGRICOGLA_IMAGE}}",
      run: PLAYER_RUN,
      source_url: REPO_URL,
      description:
        "Heuristic baseline: values food security, family growth and board coverage; " +
        "the same policy backs the in-game scripted fallback.",
    },
  ],
  commissioner: [
    {
      id: "default-commissioner",
      name: "Default Commissioner",
      type: "commissioner",
      description: "Game-agnostic round-robin commissioner with mean-score rankings.",
      source_url: "https://github.com/Metta-AI/commissioners/tree/main/commissioners/default",
      image: "{{COMMISSIONER_IMAGE}}",
    },
  ],
  reporter: [],
  grader: [],
  diagnoser: [],
  optimizer: [],
  variants: [
    {
      id: "default",
      name: "Default (2 players)",
      game_config: {
        players: playerSlots(["Farmer A", "Farmer B"]),
        pace_ms: 0,
        act_timeout_seconds: 20,
        player_connect_timeout_seconds: 180,
      },
      description: "Head-to-head Agricogla with a random seed per episode.",
    },
  ],
  certification: {
    game_config: {
      players: playerSlots(["Scripted A", "Scripted B"]),
      seed: 7,
      pace_ms: 0,
      act_timeout_seconds: 20,
      player_connect_timeout_seconds: 180,
    },
    players: [{ player_id: "scripted-baseline" }, { player_id: "scripted-baseline" }],
  },
};

const out = join(root, "coworld_manifest_template.json");
writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
console.log(`wrote ${out}`);
