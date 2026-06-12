import { writeFileSync } from "node:fs";
import { buildAgent } from "./agents";
import { runToCompletion } from "./agents/run";
import { newGame } from "./shared/engine/game";

export interface CliOptions {
  seed: number;
  players: number;
  agents: string[];
  out?: string;
  quiet: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { seed: 1, players: 4, agents: [], quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--seed":
        opts.seed = Number(argv[++i]);
        break;
      case "--players":
        opts.players = Number(argv[++i]);
        break;
      case "--agents":
        opts.agents = String(argv[++i]).split(",");
        break;
      case "--out":
        opts.out = argv[++i];
        break;
      case "--quiet":
        opts.quiet = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (opts.agents.length === 0) {
    opts.agents = Array(opts.players).fill("scripted");
  }
  if (opts.agents.length !== opts.players) {
    throw new Error(`--agents needs ${opts.players} entries`);
  }
  return opts;
}

export async function main(argv: string[]): Promise<void> {
  const opts = parseArgs(argv);
  const agents = opts.agents.map((spec, i) =>
    buildAgent(spec, `player${i}`, { seed: opts.seed * 1000 + i }),
  );
  const start = newGame({ seed: opts.seed, numPlayers: opts.players });
  let lastRound = 0;
  const final = await runToCompletion(start, agents, {
    onState: (s) => {
      if (!opts.quiet && s.round !== lastRound) {
        lastRound = s.round;
        const foods = s.players.map((p) => `${p.name}:${p.resources.food}f/${p.family.length}fam`);
        console.log(`round ${s.round}  ${foods.join("  ")}`);
      }
    },
  });

  console.log("\n=== Final scores ===");
  for (const sheet of final.scores!) {
    const player = final.players[sheet.playerIdx]!;
    console.log(`${player.name}: ${sheet.total} points`);
    if (!opts.quiet) {
      for (const cat of sheet.categories) {
        if (cat.points !== 0) console.log(`   ${cat.label}: ${cat.points} (${cat.detail})`);
      }
    }
  }
  if (opts.out) {
    writeFileSync(opts.out, JSON.stringify({ state: final }, null, 2));
    console.log(`wrote ${opts.out}`);
  }
}

const isDirectRun = process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js");
if (isDirectRun) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
