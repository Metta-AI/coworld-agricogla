import { z } from "zod";
import { GameState } from "./engine/types";
import { feedDecisionSchema, placementSchema } from "./engine/placements";

/** "remote" seats are driven by external policy containers over /player
 *  (coworld tournament mode) and cannot be selected from the UI. */
export type Controller = "human" | "scripted" | "llm" | "remote";

/** A Bedrock model the autopilot can drive a seat with. The set the picker
 *  actually offers is discovered at server startup (see
 *  `agents/llm/model-discovery.ts`) by probing each candidate — only models
 *  this account/region can invoke are shown, so use-case-form-gated models
 *  that 404 with ResourceNotFoundException never appear as choices. */
export interface BedrockModel {
  id: string;
  label: string;
}
/** Curated probe pool: the tool-capable Claude models we support, newest
 *  first. Startup discovery keeps whichever of these the running account can
 *  actually invoke; the rest are never offered. */
export const MODEL_CANDIDATES: BedrockModel[] = [
  { id: "us.anthropic.claude-opus-4-8", label: "Opus 4.8" },
  { id: "us.anthropic.claude-opus-4-7", label: "Opus 4.7" },
  { id: "us.anthropic.claude-opus-4-6-v1", label: "Opus 4.6" },
  { id: "us.anthropic.claude-opus-4-5-20251101-v1:0", label: "Opus 4.5" },
  { id: "us.anthropic.claude-opus-4-1-20250805-v1:0", label: "Opus 4.1" },
  { id: "us.anthropic.claude-sonnet-4-6", label: "Sonnet 4.6" },
  { id: "us.anthropic.claude-haiku-4-5-20251001-v1:0", label: "Haiku 4.5" },
];
export const DEFAULT_BEDROCK_MODEL = "us.anthropic.claude-opus-4-8";
const BEDROCK_MODEL_IDS = MODEL_CANDIDATES.map((m) => m.id) as [string, ...string[]];

export interface HandSizes {
  occupations: number;
  minors: number;
}

export interface ServerStatus {
  round: number;
  phase: string;
  currentPlayer: number;
  toFeed: number[];
  controllers: Controller[];
  /** Per-seat autopilot guidance directive prepended to the LLM prompt. */
  guidance: string[];
  /** Per-seat Bedrock model id the autopilot drives that seat with. */
  models: string[];
  /** Bedrock models discovered invokable at startup — the only autopilot
   *  choices the picker offers. Empty when no model is reachable (e.g. no
   *  Bedrock credentials), so the UI then offers scripted play only. */
  availableModels: BedrockModel[];
  /** Seat whose decision an agent is currently computing, or null. */
  thinking: number | null;
  paused: boolean;
  /** False while the lobby is collecting players; true once play has begun. */
  started: boolean;
  /** Lobby roster (names + controllers), valid even before the game exists. */
  roster: { name: string; controller: Controller }[];
  /** Seat cap for the lobby (engine max). */
  maxPlayers: number;
  finished: boolean;
  clients: number;
  /** Tournament (coworld) mode: clients spectate; all commands rejected. */
  readOnly: boolean;
}

export interface ActPromptWire {
  playerIdx: number;
  round: number;
  phase: string;
  content: string;
}

/** Table talk. `to: null` is a public broadcast; otherwise a direct message
 *  to that seat (the global observer sees every DM; a seat sees only its own). */
export interface ChatMessage {
  seq: number;
  round: number;
  from: number;
  to: number | null;
  text: string;
}

export type ServerMessage =
  | { type: "state"; state: GameState | null; handSizes: HandSizes[] }
  /** One redacted snapshot per round so far, so a late-joining client shows the
   *  full scrubber timeline instead of only rounds since it connected. */
  | { type: "history"; frames: { round: number; seed: number; state: GameState }[] }
  | { type: "seat"; playerIdx: number | null }
  | { type: "status"; status: ServerStatus }
  | { type: "actPrompt"; entry: ActPromptWire }
  | { type: "chat"; message: ChatMessage }
  | { type: "error"; message: string };

// Clients may switch seats among these; "remote" is server-assigned only.
export const controllerSchema = z.enum(["human", "scripted", "llm"]);

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    playerIdx: z.number().int().min(0).max(3).nullable(),
    /** Seat token, required to see your own hand in tournament mode. */
    token: z.string().optional(),
  }),
  z.object({
    type: z.literal("place"),
    playerIdx: z.number().int().min(0).max(3),
    placement: placementSchema,
  }),
  z.object({
    type: z.literal("feed"),
    playerIdx: z.number().int().min(0).max(3),
    decision: feedDecisionSchema,
  }),
  z.object({
    type: z.literal("setController"),
    playerIdx: z.number().int().min(0).max(3),
    controller: controllerSchema,
  }),
  z.object({
    type: z.literal("setGuidance"),
    playerIdx: z.number().int().min(0).max(3),
    text: z.string().max(2000),
  }),
  z.object({
    type: z.literal("setModel"),
    playerIdx: z.number().int().min(0).max(3),
    model: z.enum(BEDROCK_MODEL_IDS),
  }),
  z.object({
    type: z.literal("chat"),
    /** The seat you are sending as; must match your claimed seat. */
    from: z.number().int().min(0).max(3),
    /** null = public broadcast; otherwise the recipient seat. */
    to: z.number().int().min(0).max(3).nullable(),
    text: z.string().min(1).max(500),
  }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
  z.object({ type: z.literal("addBot") }),
  z.object({ type: z.literal("removeSeat"), playerIdx: z.number().int().min(0).max(3) }),
  z.object({
    type: z.literal("reset"),
    seed: z.number().int().optional(),
    players: z.number().int().min(1).max(4).optional(),
  }),
  z.object({ type: z.literal("newGame") }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
