/** Zod schemas and types for the autopilot-improvement experiment harness. */
import { z } from "zod";
import { Capabilities, PromptBlocks } from "../agents/llm/prompt";

/** A prompt variant: a partial override of the baseline blocks, plus an
 *  optional per-seat guidance directive. `parent` chains overrides; "baseline"
 *  (or omitted) means start from the shipped DEFAULT_BLOCKS. */
export const promptVariantSchema = z.object({
  name: z.string(),
  parent: z.string().optional(),
  notes: z.string().optional(),
  /** Partial block overrides (intro/rules/strategy/output). */
  blocks: z
    .object({
      intro: z.string().optional(),
      rules: z.string().optional(),
      strategy: z.string().optional(),
      output: z.string().optional(),
    })
    .partial()
    .default({}),
  /** Per-seat operator directive prepended to every prompt for this seat. */
  guidance: z.string().default(""),
  /** Optional autopilot capabilities (diary memory, table-talk chat). */
  capabilities: z
    .object({ memory: z.boolean(), chat: z.boolean() })
    .partial()
    .default({}),
  /** Escape hatch: a fully-formed system prompt that bypasses block composition. */
  system: z.string().optional(),
});
export type PromptVariant = z.infer<typeof promptVariantSchema>;

/** A resolved variant: a complete prompt ready to seat a player with. */
export interface ResolvedVariant {
  name: string;
  blocks: PromptBlocks;
  system: string;
  guidance: string;
  capabilities: Capabilities;
}

export type SeatKind = "llm" | "scripted" | "random";

export interface SeatConfig {
  kind: SeatKind;
  /** Variant name for llm seats; resolved against the variant registry. */
  variant?: string;
  /** Display label, e.g. "candidate" / "baseline". */
  label: string;
}

export const scoreCategorySchema = z.object({
  label: z.string(),
  points: z.number(),
  detail: z.string(),
});

export const seatResultSchema = z.object({
  idx: z.number(),
  kind: z.string(),
  variant: z.string().optional(),
  label: z.string(),
  total: z.number(),
  categories: z.array(scoreCategorySchema),
  /** LLM decisions this seat made (0 for scripted/random). */
  llmDecisions: z.number(),
  /** Of those, how many fell back to the scripted policy. */
  fallbacks: z.number(),
});
export type SeatResult = z.infer<typeof seatResultSchema>;

export const gameResultSchema = z.object({
  gameId: z.string(),
  seed: z.number(),
  numPlayers: z.number(),
  model: z.string(),
  seats: z.array(seatResultSchema),
  /** playerIdx ordered best-first. */
  ranking: z.array(z.number()),
  winner: z.number(),
  durationMs: z.number(),
  totalLlmDecisions: z.number(),
  totalFallbacks: z.number(),
  fallbackRate: z.number(),
  /** Token accounting across all LLM calls, incl. Bedrock prompt-cache hits. */
  usage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheReadInputTokens: z.number(),
      cacheWriteInputTokens: z.number(),
      /** cacheRead / (cacheRead + cacheWrite + uncached input). */
      cachedInputFraction: z.number(),
    })
    .optional(),
  transcriptPath: z.string().optional(),
});
export type GameResult = z.infer<typeof gameResultSchema>;

/** Aggregate of one A/B comparison: candidate variant vs baseline variant. */
export const abResultSchema = z.object({
  candidate: z.string(),
  baseline: z.string(),
  model: z.string(),
  numPlayers: z.number(),
  games: z.array(gameResultSchema),
  /** Games actually counted (fallback rate under the contamination threshold). */
  countedGames: z.number(),
  excludedGames: z.number(),
  /** Mean per-seat score, candidate seats vs baseline seats, over counted games. */
  candidateMeanScore: z.number(),
  baselineMeanScore: z.number(),
  meanScoreDelta: z.number(),
  /** Fraction of counted games whose top scorer was a candidate seat (ties split). */
  candidateWinShare: z.number(),
  /** Paired sign test over per-game (candidateMean - baselineMean). */
  gamesCandidateBetter: z.number(),
  gamesBaselineBetter: z.number(),
  gamesTied: z.number(),
  /** Two-sided sign-test p-value on the paired per-game deltas. */
  signTestP: z.number(),
  meanFallbackRate: z.number(),
  /** Mean fraction of input tokens served from the Bedrock prompt cache. */
  meanCachedInputFraction: z.number(),
  verdict: z.string(),
});
export type AbResult = z.infer<typeof abResultSchema>;
