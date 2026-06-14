import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startServer } from "./server/runtime";
import { discoverAvailableModels } from "./agents/llm/model-discovery";
import { Controller } from "./shared/protocol";

interface ServeOptions {
  port: number;
  seed: number;
  /** Boot roster (the lobby seeds): explicit --agents, else --cogs bots, else empty. */
  controllers: Controller[];
  names?: string[];
  pace: number;
  /** Begin play immediately. Without it the server boots into the lobby (paused). */
  start: boolean;
}

export function parseServeArgs(argv: string[]): ServeOptions {
  // Preview/launch tooling assigns a port via the PORT env var.
  const envPort = Number(process.env.PORT);
  let port = Number.isFinite(envPort) && envPort > 0 ? envPort : 8484;
  let seed = 1;
  let pace = 800;
  let start = false;
  let agents: Controller[] | null = null;
  let players: number | null = null;
  let cogs = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--port":
        port = Number(argv[++i]);
        break;
      case "--seed":
        seed = Number(argv[++i]);
        break;
      case "--players":
        players = Number(argv[++i]);
        break;
      case "--agents":
        agents = String(argv[++i]).split(",") as Controller[];
        break;
      case "--pace":
        pace = Number(argv[++i]);
        break;
      case "--start":
        start = true;
        break;
      case "--cogs":
        cogs = Number(argv[++i]);
        if (!Number.isInteger(cogs) || cogs < 0 || cogs > 4) {
          throw new Error("--cogs must be an integer 0..4");
        }
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  // Boot roster: explicit --agents wins; else N llm cogs; else legacy --players
  // scripted bots; else an empty lobby (Add Bot / join to fill it).
  let controllers: Controller[];
  let names: string[] | undefined;
  if (agents && agents.length) {
    controllers = agents;
  } else if (cogs > 0) {
    controllers = Array(cogs).fill("llm") as Controller[];
    names = Array.from({ length: cogs }, (_, i) => `Bot ${i + 1}`);
  } else if (players && players > 0) {
    controllers = Array(players).fill("scripted") as Controller[];
  } else {
    controllers = [];
  }
  for (const c of controllers) {
    if (!["human", "scripted", "llm"].includes(c)) {
      throw new Error(`unknown controller: ${c} (use human|scripted|llm)`);
    }
  }
  return { port, seed, controllers, names, pace, start };
}

async function main(): Promise<void> {
  const opts = parseServeArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const distDir = join(here, "..", "dist");
  const handle = await startServer({
    port: opts.port,
    seed: opts.seed,
    numPlayers: opts.controllers.length,
    controllers: opts.controllers,
    names: opts.names,
    paceMs: opts.pace,
    startPaused: !opts.start,
    maxPlayers: 4,
    distDir,
  });
  console.log(`Agricogla server on http://localhost:${handle.port}`);
  console.log(`  table view:   http://localhost:${handle.port}/`);
  console.log(`  join page:    http://localhost:${handle.port}/join`);
  for (let i = 0; i < opts.controllers.length; i++) {
    console.log(`  player ${i}:    http://localhost:${handle.port}/player/${i} (${opts.controllers[i]})`);
  }
  console.log(`  websocket:    ws://localhost:${handle.port}/ws`);
  console.log(
    opts.start
      ? `  status:       playing (--start)`
      : `  status:       lobby (${opts.controllers.length}/4) — Add Bot / share /join, then Start (or pass --start)`,
  );

  // Discover which Bedrock models this account/region can actually invoke and
  // publish them as the autopilot choices. Non-blocking: the server is already
  // serving; the picker fills in once the probes return (empty ⇒ scripted only).
  void discoverAvailableModels().then((models) => {
    handle.runner.setAvailableModels(models);
    const names = models.map((m) => m.label).join(", ");
    console.log(`  autopilot models: ${names || "none — Bedrock unreachable, scripted only"}`);
  });
}

const isDirectRun =
  process.argv[1]?.endsWith("cli-serve.ts") || process.argv[1]?.endsWith("cli-serve.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
