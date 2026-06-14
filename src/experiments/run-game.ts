/** Play one Agricogla game where each seat can run a different prompt variant,
 *  capturing every LLM decision transcript, fallback telemetry, and the final
 *  score sheet. The heavy lifting for the autopilot-improvement loop. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Agent, ActPromptEntry, AgentView } from "../agents/types";
import { llmAgent } from "../agents/llm/llm-agent";
import { randomAgent, scriptedAgent, fallbackPlacement } from "../agents/scripted";
import { buildView } from "../agents/run";
import {
  applyFeeding,
  applyPlacement,
  computeAutoFeed,
  RuleError,
} from "../shared/engine/apply";
import { newGame } from "../shared/engine/game";
import { GameState } from "../shared/engine/types";
import { ChatMessage } from "../shared/protocol";
import { ConverseUsage } from "../agents/llm/tool-client";
import { RetryingToolUseClient } from "./bedrock";
import { resolveVariant } from "./variants";
import { condenseGame } from "./condense";
import { GameResult, SeatConfig, SeatResult } from "./types";

export interface RunGameOpts {
  seed: number;
  seats: SeatConfig[];
  model: string;
  gameId: string;
  /** Directory to write `<gameId>.transcript.txt` and `<gameId>.result.json`. */
  outDir?: string;
  maxAttempts?: number;
  onProgress?: (round: number) => void;
}

/** One game step with per-seat guidance injected into the view. Mirrors the
 *  engine's run loop but feeds each seat its operator directive (the live
 *  server does the same in game-runner.ts) and keeps the scripted-fallback
 *  safety net for any illegal agent output. */
async function step(
  state: GameState,
  agents: Agent[],
  guidance: (string | undefined)[],
  inboxFor: (idx: number) => ChatMessage[] | undefined,
): Promise<GameState> {
  if (state.phase === "work") {
    const idx = state.currentPlayer;
    const view: AgentView = {
      ...buildView(state, idx),
      guidance: guidance[idx],
      messages: inboxFor(idx),
    };
    const placement = await agents[idx]!.decidePlacement(view);
    try {
      return applyPlacement(state, idx, placement).state;
    } catch (err) {
      if (!(err instanceof RuleError)) throw err;
      return applyPlacement(state, idx, fallbackPlacement(view)).state;
    }
  }
  if (state.phase === "feeding") {
    const idx = state.toFeed[0]!;
    const view: AgentView = {
      ...buildView(state, idx),
      guidance: guidance[idx],
      messages: inboxFor(idx),
    };
    const decision = await agents[idx]!.decideFeeding(view);
    try {
      return applyFeeding(state, idx, decision).state;
    } catch (err) {
      if (!(err instanceof RuleError)) throw err;
      return applyFeeding(state, idx, computeAutoFeed(state, idx)).state;
    }
  }
  throw new Error("game is finished");
}

export async function runGame(
  opts: RunGameOpts,
): Promise<{ result: GameResult; transcript: string }> {
  const numPlayers = opts.seats.length;
  const resolved = opts.seats.map((s) =>
    s.kind === "llm" ? resolveVariant(s.variant ?? "baseline") : null,
  );
  const guidance = resolved.map((r) => (r?.guidance ? r.guidance : undefined));

  const llmDecisions = new Array(numPlayers).fill(0);
  const fallbacks = new Array(numPlayers).fill(0);
  const transcriptLines: string[] = [];

  // Shared table-talk bus: any seat with the chat capability can post, and
  // every seat sees public messages + DMs addressed to it (never its own).
  const bus: ChatMessage[] = [];
  let chatSeq = 0;
  const inboxFor = (idx: number): ChatMessage[] | undefined => {
    if (!resolved[idx]?.capabilities.chat) return undefined;
    return bus.filter((m) => m.from !== idx && (m.to === null || m.to === idx));
  };

  const usage: ConverseUsage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheWriteInputTokens: 0,
  };
  const addUsage = (u: ConverseUsage) => {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    usage.cacheReadInputTokens += u.cacheReadInputTokens;
    usage.cacheWriteInputTokens += u.cacheWriteInputTokens;
  };

  const onActPrompt = (e: ActPromptEntry) => {
    llmDecisions[e.playerIdx]++;
    if (e.fellBack) fallbacks[e.playerIdx]++;
    const label = opts.seats[e.playerIdx]!.label;
    const flag = e.fellBack ? " | FELL BACK TO SCRIPTED" : "";
    transcriptLines.push(
      `===== seat ${e.playerIdx} (${label}) | round ${e.round} | ${e.phase}${flag} =====\n${e.content}`,
    );
  };

  // One retrying client shared by all llm seats so the concurrency gate is
  // process-wide and seats interleave fairly.
  const client = new RetryingToolUseClient({ model: opts.model });
  const agents: Agent[] = opts.seats.map((s, i) => {
    if (s.kind === "scripted") return scriptedAgent(`p${i}`);
    if (s.kind === "random") return randomAgent(`p${i}`, opts.seed * 1000 + i);
    return llmAgent(`p${i}`, {
      client,
      system: resolved[i]!.system,
      capabilities: resolved[i]!.capabilities,
      onChat: (to, text, round) => {
        bus.push({ seq: chatSeq++, round, from: i, to, text });
      },
      onUsage: addUsage,
      onActPrompt,
      maxAttempts: opts.maxAttempts,
    });
  });

  const t0 = Date.now();
  let state = newGame({ seed: opts.seed, numPlayers });
  let guard = 0;
  let lastRound = 0;
  while (state.phase !== "finished") {
    if (guard++ > 4000) throw new Error("game did not terminate after 4000 steps");
    state = await step(state, agents, guidance, inboxFor);
    if (state.round !== lastRound) {
      lastRound = state.round;
      opts.onProgress?.(state.round);
    }
  }
  const durationMs = Date.now() - t0;

  const scores = state.scores!;
  const seatResults: SeatResult[] = opts.seats.map((s, i) => {
    const sheet = scores.find((sc) => sc.playerIdx === i)!;
    return {
      idx: i,
      kind: s.kind,
      variant: s.variant,
      label: s.label,
      total: sheet.total,
      categories: sheet.categories,
      llmDecisions: llmDecisions[i],
      fallbacks: fallbacks[i],
    };
  });

  const ranking = [...seatResults]
    .sort((a, b) => b.total - a.total)
    .map((s) => s.idx);
  const totalLlmDecisions = llmDecisions.reduce((a, b) => a + b, 0);
  const totalFallbacks = fallbacks.reduce((a, b) => a + b, 0);
  const totalInput =
    usage.inputTokens + usage.cacheReadInputTokens + usage.cacheWriteInputTokens;

  const result: GameResult = {
    gameId: opts.gameId,
    seed: opts.seed,
    numPlayers,
    model: opts.model,
    seats: seatResults,
    ranking,
    winner: ranking[0]!,
    durationMs,
    totalLlmDecisions,
    totalFallbacks,
    fallbackRate: totalLlmDecisions > 0 ? totalFallbacks / totalLlmDecisions : 0,
    usage: totalLlmDecisions
      ? {
          ...usage,
          cachedInputFraction: totalInput > 0 ? usage.cacheReadInputTokens / totalInput : 0,
        }
      : undefined,
  };

  // Append the full table-talk log so transcripts capture what cogs said.
  if (bus.length > 0) {
    const chatLines = bus.map((m) => {
      const who = opts.seats[m.from]?.label ?? `seat ${m.from}`;
      const to = m.to === null ? "all" : `seat ${m.to}`;
      return `r${m.round} ${who}->${to}: ${m.text}`;
    });
    transcriptLines.push(`===== TABLE TALK (${bus.length} messages) =====\n${chatLines.join("\n")}`);
  }
  const transcript = transcriptLines.join("\n\n");
  if (opts.outDir) {
    mkdirSync(opts.outDir, { recursive: true });
    const transcriptPath = join(opts.outDir, `${opts.gameId}.transcript.txt`);
    writeFileSync(transcriptPath, transcript);
    result.transcriptPath = transcriptPath;
    const resultPath = join(opts.outDir, `${opts.gameId}.result.json`);
    writeFileSync(resultPath, JSON.stringify(result, null, 2));
    // Also write the compact digest that the improve-autopilot workflow reads.
    writeFileSync(join(opts.outDir, `${opts.gameId}.digest.md`), condenseGame(transcriptPath, resultPath));
  }
  return { result, transcript };
}

// CLI: run a single game. Seats are "kind[:variant]" comma-separated.
//   tsx src/experiments/run-game.ts --seed 1 --seats llm:baseline,llm:baseline,scripted,scripted
function parseSeat(spec: string, idx: number): SeatConfig {
  const [kind, variant] = spec.split(":");
  if (kind !== "llm" && kind !== "scripted" && kind !== "random") {
    throw new Error(`seat ${idx}: bad kind "${kind}" (llm|scripted|random)`);
  }
  return {
    kind,
    variant: kind === "llm" ? variant ?? "baseline" : undefined,
    label: kind === "llm" ? variant ?? "baseline" : kind,
  };
}

async function main(argv: string[]): Promise<void> {
  let seed = 1;
  let seatsSpec = "llm:baseline,llm:baseline,llm:baseline,llm:baseline";
  let model = process.env.AGRICOGLA_BEDROCK_MODEL ?? "us.anthropic.claude-sonnet-4-6";
  let outDir = join(process.cwd(), "experiments", "runs", "adhoc");
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--seed") seed = Number(argv[++i]);
    else if (a === "--seats") seatsSpec = String(argv[++i]);
    else if (a === "--model") model = String(argv[++i]);
    else if (a === "--out") outDir = String(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  const seats = seatsSpec.split(",").map(parseSeat);
  const gameId = `seed${seed}-${seats.map((s) => s.label).join("_")}`;
  console.log(`running ${gameId} (model ${model}) ...`);
  const { result } = await runGame({
    seed,
    seats,
    model,
    gameId,
    outDir,
    onProgress: (r) => console.log(`  round ${r}/14`),
  });
  console.log("\n=== result ===");
  for (const s of result.seats) {
    console.log(
      `seat ${s.idx} ${s.label}: ${s.total} pts` +
        (s.llmDecisions ? ` (${s.fallbacks}/${s.llmDecisions} fallbacks)` : ""),
    );
  }
  console.log(`winner: seat ${result.winner}; fallbackRate ${(result.fallbackRate * 100).toFixed(1)}%`);
  if (result.usage) {
    console.log(
      `tokens: in=${result.usage.inputTokens} cacheRead=${result.usage.cacheReadInputTokens} ` +
        `cacheWrite=${result.usage.cacheWriteInputTokens} out=${result.usage.outputTokens} ` +
        `(cached ${(result.usage.cachedInputFraction * 100).toFixed(0)}% of input)`,
    );
  }
  console.log(`wrote results to ${outDir}`);
}

const isDirectRun =
  process.argv[1]?.endsWith("run-game.ts") || process.argv[1]?.endsWith("run-game.js");
if (isDirectRun) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
