import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { startServer } from "./server/runtime";
import { Controller } from "./shared/protocol";

interface ServeOptions {
  port: number;
  seed: number;
  players: number;
  controllers: Controller[];
  pace: number;
}

export function parseServeArgs(argv: string[]): ServeOptions {
  const opts: ServeOptions = { port: 8484, seed: 1, players: 4, controllers: [], pace: 800 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--port":
        opts.port = Number(argv[++i]);
        break;
      case "--seed":
        opts.seed = Number(argv[++i]);
        break;
      case "--players":
        opts.players = Number(argv[++i]);
        break;
      case "--agents":
        opts.controllers = String(argv[++i]).split(",") as Controller[];
        break;
      case "--pace":
        opts.pace = Number(argv[++i]);
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (opts.controllers.length > 0 && opts.controllers.length !== opts.players) {
    // Allow --agents to imply the player count.
    opts.players = opts.controllers.length;
  }
  if (opts.controllers.length === 0) {
    opts.controllers = Array(opts.players).fill("scripted") as Controller[];
  }
  for (const c of opts.controllers) {
    if (!["human", "scripted", "llm"].includes(c)) {
      throw new Error(`unknown controller: ${c} (use human|scripted|llm)`);
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseServeArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const distDir = join(here, "..", "dist");
  const handle = await startServer({
    port: opts.port,
    seed: opts.seed,
    numPlayers: opts.players,
    controllers: opts.controllers,
    paceMs: opts.pace,
    distDir,
  });
  console.log(`Agricola server on http://localhost:${handle.port}`);
  console.log(`  table view:   http://localhost:${handle.port}/`);
  for (let i = 0; i < opts.players; i++) {
    console.log(`  player ${i}:    http://localhost:${handle.port}/player/${i} (${opts.controllers[i]})`);
  }
  console.log(`  websocket:    ws://localhost:${handle.port}/ws`);
}

const isDirectRun =
  process.argv[1]?.endsWith("cli-serve.ts") || process.argv[1]?.endsWith("cli-serve.js");
if (isDirectRun) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
