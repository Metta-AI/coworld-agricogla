import { z } from "zod";
import { GameState } from "./engine/types";
import { ActionOption, PlayerChoices } from "./engine/legal";
import { feedDecisionSchema, placementSchema } from "./engine/placements";
import { ChatMessage, HandSizes } from "./protocol";

/** Concrete per-episode game config the Coworld runner hands the game
 *  container via COGAME_CONFIG_URI. `tokens` is runner-injected; everything
 *  else comes from the manifest variant / certification fixture. */
export const coworldConfigSchema = z
  .object({
    tokens: z.array(z.string().min(1)).min(1).max(4),
    players: z.array(z.object({ name: z.string().min(1) })),
    seed: z.number().int().nonnegative().optional(),
    /** Minimum ms between automated decisions so live viewers can follow. */
    pace_ms: z.number().min(0).max(5000).default(0),
    /** Per-decision budget for a remote player before the scripted fallback
     *  takes the turn. */
    act_timeout_seconds: z.number().positive().max(600).default(20),
    player_connect_timeout_seconds: z.number().nonnegative().default(180),
  })
  .refine((c) => c.players.length === c.tokens.length, {
    message: "players must have the same length as tokens",
  });

export type CoworldConfig = z.infer<typeof coworldConfigSchema>;

/** Final results artifact, validated against manifest.game.results_schema. */
export interface CoworldResults {
  /** Final victory points per slot. */
  scores: number[];
  /** Slot index of the unique highest score, or -1 on a tie. */
  winner: number;
  rounds: number;
}

/** One applied decision, in order; replays re-simulate from (seed, actions). */
export type ReplayAction =
  | { playerIdx: number; kind: "place"; placement: unknown }
  | { playerIdx: number; kind: "feed"; decision: unknown };

export interface ReplayPayload {
  game: "agricogla";
  seed: number;
  numPlayers: number;
  playerNames: string[];
  actions: ReplayAction[];
  /** Table-talk recorded during the episode (bot quips + LLM `say`), so the
   *  replay viewer's feed reproduces the negotiation. Optional: older replays
   *  predate it and render an empty feed. */
  chat?: ChatMessage[];
  results: CoworldResults;
}

/** Messages the game server sends a connected player policy. */
export type CoworldServerMessage =
  | { type: "welcome"; slot: number; numPlayers: number; playerNames: string[] }
  | {
      type: "observation";
      slot: number;
      decisionId: number;
      phase: "work" | "feeding";
      /** 1-based attempt counter; >1 means the previous reply was rejected. */
      attempt: number;
      /** Why the previous reply was rejected, when attempt > 1. */
      error: string | null;
      /** Game state redacted for this slot (other hands hidden). */
      state: GameState;
      handSizes: HandSizes[];
      /** Legal action spaces (phase "work"). */
      options: ActionOption[];
      /** Parameter choices for parameterized placements and feeding. */
      choices: PlayerChoices;
    }
  | { type: "final"; results: CoworldResults; state: GameState };

/** Replies a player policy sends back. `decisionId` must echo the
 *  observation being answered; replies without one apply to the current
 *  decision, mismatched ones are ignored as stale. */
export const coworldPlayerMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("place"),
    decisionId: z.number().int().optional(),
    placement: placementSchema,
  }),
  z.object({
    type: z.literal("feed"),
    decisionId: z.number().int().optional(),
    decision: feedDecisionSchema,
  }),
]);

export type CoworldPlayerMessage = z.infer<typeof coworldPlayerMessageSchema>;
