/** A/B-test a candidate prompt variant against a baseline in 4-player games.
 *
 *  Each game seats 2 candidate players and 2 baseline players. For every seed
 *  we play two complementary arrangements (candidate at {0,2} then at {1,3}) so
 *  the candidate occupies every board position equally — cancelling first/last
 *  player advantage. We then compare the mean per-seat score of candidate vs
 *  baseline seats, the share of games a candidate seat wins, and a paired sign
 *  test over per-game score deltas. Games whose fallback rate exceeds the
 *  contamination threshold are excluded (their signal is scripted, not LLM). */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGame } from "./run-game";
import { AbResult, GameResult, SeatConfig } from "./types";
import { resolveVariant } from "./variants";
import { preflightBedrock } from "./bedrock";

const FOUR = 4;

/** Two complementary candidate/baseline arrangements for a 4-player game. */
export function arrangements(candidate: string, baseline: string): SeatConfig[][] {
  const cand = (): SeatConfig => ({ kind: "llm", variant: candidate, label: "candidate" });
  const base = (): SeatConfig => ({ kind: "llm", variant: baseline, label: "baseline" });
  return [
    [cand(), base(), cand(), base()], // candidate at 0,2
    [base(), cand(), base(), cand()], // candidate at 1,3
  ];
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function choose(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return r;
}

/** Two-sided sign test p-value: prob of a split at least this lopsided under
 *  a fair coin, ignoring ties. */
export function signTestP(better: number, worse: number): number {
  const n = better + worse;
  if (n === 0) return 1;
  const k = Math.max(better, worse);
  let tail = 0;
  for (let i = k; i <= n; i++) tail += choose(n, i) * 0.5 ** n;
  return Math.min(1, 2 * tail);
}

export interface AbOpts {
  candidate: string;
  baseline?: string;
  model?: string;
  seeds?: number[];
  /** Exclude a game when this fraction of its LLM decisions fell back. */
  contaminationThreshold?: number;
  outDir?: string;
  logPath?: string;
}

export async function abTest(opts: AbOpts): Promise<AbResult> {
  const candidate = opts.candidate;
  const baseline = opts.baseline ?? "baseline";
  const model = opts.model ?? process.env.AGRICOGLA_BEDROCK_MODEL ?? "us.anthropic.claude-sonnet-4-6";
  const seeds = opts.seeds ?? [11, 22, 33, 44];
  const threshold = opts.contaminationThreshold ?? 0.15;

  // Validate both variants resolve before spending money.
  resolveVariant(candidate);
  resolveVariant(baseline);

  const runId = `${candidate}-vs-${baseline}-${Date.now()}`;
  const outDir = opts.outDir ?? join(process.cwd(), "experiments", "runs", runId);
  mkdirSync(outDir, { recursive: true });

  const jobs: Array<{ seed: number; arr: number; seats: SeatConfig[] }> = [];
  for (const seed of seeds) {
    arrangements(candidate, baseline).forEach((seats, arr) =>
      jobs.push({ seed, arr, seats }),
    );
  }

  console.log(
    `A/B ${candidate} vs ${baseline}: ${jobs.length} games (${seeds.length} seeds x 2 arrangements), model ${model}`,
  );

  // Fail fast on missing/expired credentials rather than silently scoring every
  // game on the scripted fallback (which happened once when SSO creds lapsed).
  await preflightBedrock(model);

  const games: GameResult[] = await Promise.all(
    jobs.map(async (job) => {
      const gameId = `seed${job.seed}-arr${job.arr}`;
      const { result } = await runGame({
        seed: job.seed,
        seats: job.seats,
        model,
        gameId,
        outDir,
        onProgress: (r) => {
          if (r === 14) console.log(`  ${gameId}: reached final round`);
        },
      });
      console.log(
        `  ${gameId} done: cand=${result.seats
          .filter((s) => s.label === "candidate")
          .map((s) => s.total)
          .join("/")} base=${result.seats
          .filter((s) => s.label === "baseline")
          .map((s) => s.total)
          .join("/")} fallback=${(result.fallbackRate * 100).toFixed(0)}%`,
      );
      return result;
    }),
  );

  const counted = games.filter((g) => g.fallbackRate <= threshold);
  const excluded = games.length - counted.length;

  const candScores: number[] = [];
  const baseScores: number[] = [];
  let candWins = 0;
  let better = 0;
  let worse = 0;
  let tied = 0;

  for (const g of counted) {
    const c = g.seats.filter((s) => s.label === "candidate").map((s) => s.total);
    const b = g.seats.filter((s) => s.label === "baseline").map((s) => s.total);
    candScores.push(...c);
    baseScores.push(...b);
    const cm = mean(c);
    const bm = mean(b);
    if (cm > bm) better++;
    else if (cm < bm) worse++;
    else tied++;

    // Win share: who holds the top score this game (ties split).
    const top = Math.max(...g.seats.map((s) => s.total));
    const topSeats = g.seats.filter((s) => s.total === top);
    const candTop = topSeats.filter((s) => s.label === "candidate").length;
    candWins += candTop / topSeats.length;
  }

  const candidateMeanScore = mean(candScores);
  const baselineMeanScore = mean(baseScores);
  const meanScoreDelta = candidateMeanScore - baselineMeanScore;
  const p = signTestP(better, worse);
  const candidateWinShare = counted.length ? candWins / counted.length : 0;

  let verdict: string;
  if (counted.length === 0) {
    verdict = "INCONCLUSIVE: all games contaminated by fallbacks";
  } else if (better > worse && p < 0.1) {
    verdict = `candidate BETTER by ${meanScoreDelta.toFixed(1)} pts/seat (sign-test p=${p.toFixed(3)})`;
  } else if (worse > better && p < 0.1) {
    verdict = `candidate WORSE by ${(-meanScoreDelta).toFixed(1)} pts/seat (sign-test p=${p.toFixed(3)})`;
  } else {
    verdict = `no significant difference (delta ${meanScoreDelta.toFixed(1)} pts/seat, p=${p.toFixed(3)})`;
  }

  const result: AbResult = {
    candidate,
    baseline,
    model,
    numPlayers: FOUR,
    games,
    countedGames: counted.length,
    excludedGames: excluded,
    candidateMeanScore,
    baselineMeanScore,
    meanScoreDelta,
    candidateWinShare,
    gamesCandidateBetter: better,
    gamesBaselineBetter: worse,
    gamesTied: tied,
    signTestP: p,
    meanFallbackRate: mean(games.map((g) => g.fallbackRate)),
    meanCachedInputFraction: mean(
      games.map((g) => g.usage?.cachedInputFraction ?? 0),
    ),
    verdict,
  };

  writeFileSync(join(outDir, "ab-result.json"), JSON.stringify(result, null, 2));
  writeFileSync(join(outDir, "ab-summary.md"), summarize(result, outDir));

  // Append a one-line entry to the running experiment log.
  const logPath = opts.logPath ?? join(process.cwd(), "experiments", "log.md");
  appendFileSync(
    logPath,
    `| ${new Date().toISOString().slice(0, 16).replace("T", " ")} | ${candidate} | ${baseline} | ${model.replace("us.anthropic.claude-", "")} | ${counted.length}/${games.length} | ${meanScoreDelta >= 0 ? "+" : ""}${meanScoreDelta.toFixed(1)} | ${(candidateWinShare * 100).toFixed(0)}% | ${p.toFixed(3)} | ${result.verdict} |\n`,
  );

  console.log(`\n=== ${verdict} ===`);
  console.log(`wrote ${join(outDir, "ab-result.json")}`);
  return result;
}

function summarize(r: AbResult, outDir: string): string {
  const lines: string[] = [];
  lines.push(`# A/B: ${r.candidate} vs ${r.baseline}`);
  lines.push("");
  lines.push(`- Model: \`${r.model}\`, ${r.numPlayers}-player`);
  lines.push(`- Games counted: ${r.countedGames}/${r.games.length} (excluded ${r.excludedGames} for fallback contamination)`);
  lines.push(`- Mean fallback rate: ${(r.meanFallbackRate * 100).toFixed(1)}%`);
  lines.push(`- Mean cached input (Bedrock prompt cache): ${(r.meanCachedInputFraction * 100).toFixed(0)}%`);
  lines.push(`- Candidate mean score/seat: **${r.candidateMeanScore.toFixed(1)}**`);
  lines.push(`- Baseline mean score/seat: **${r.baselineMeanScore.toFixed(1)}**`);
  lines.push(`- Delta: **${r.meanScoreDelta >= 0 ? "+" : ""}${r.meanScoreDelta.toFixed(1)}** pts/seat`);
  lines.push(`- Candidate win share: **${(r.candidateWinShare * 100).toFixed(0)}%**`);
  lines.push(`- Paired games: candidate better in ${r.gamesCandidateBetter}, worse in ${r.gamesBaselineBetter}, tied ${r.gamesTied} (sign-test p=${r.signTestP.toFixed(3)})`);
  lines.push("");
  lines.push(`**Verdict: ${r.verdict}**`);
  lines.push("");
  lines.push("## Per-game");
  lines.push("");
  lines.push("| game | seed | candidate totals | baseline totals | winner | fallback% |");
  lines.push("|---|---|---|---|---|---|");
  for (const g of r.games) {
    const c = g.seats.filter((s) => s.label === "candidate").map((s) => s.total).join("/");
    const b = g.seats.filter((s) => s.label === "baseline").map((s) => s.total).join("/");
    const winLabel = g.seats.find((s) => s.idx === g.winner)!.label;
    const flag = g.fallbackRate > 0.15 ? " ⚠️excluded" : "";
    lines.push(`| ${g.gameId} | ${g.seed} | ${c} | ${b} | ${winLabel} | ${(g.fallbackRate * 100).toFixed(0)}%${flag} |`);
  }
  lines.push("");
  lines.push(`Transcripts + per-game JSON in \`${outDir}\`.`);
  return lines.join("\n");
}

async function main(argv: string[]): Promise<void> {
  let candidate = "";
  let baseline = "baseline";
  let model: string | undefined;
  let seeds: number[] | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--candidate") candidate = String(argv[++i]);
    else if (a === "--baseline") baseline = String(argv[++i]);
    else if (a === "--model") model = String(argv[++i]);
    else if (a === "--seeds") seeds = String(argv[++i]).split(",").map(Number);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (!candidate) throw new Error("--candidate <variant> is required");
  await abTest({ candidate, baseline, model, seeds });
}

const isDirectRun =
  process.argv[1]?.endsWith("ab-test.ts") || process.argv[1]?.endsWith("ab-test.js");
if (isDirectRun) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
