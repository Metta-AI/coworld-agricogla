import { z } from "zod";
import { GameState } from "./engine/types";
import { feedDecisionSchema, placementSchema } from "./engine/placements";

/** "remote" seats are driven by external policy containers over /player
 *  (coworld tournament mode) and cannot be selected from the UI. */
export type Controller = "human" | "scripted" | "llm" | "remote";

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
  /** Seat whose decision an agent is currently computing, or null. */
  thinking: number | null;
  paused: boolean;
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
  | { type: "state"; state: GameState; handSizes: HandSizes[] }
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
    type: z.literal("chat"),
    /** The seat you are sending as; must match your claimed seat. */
    from: z.number().int().min(0).max(3),
    /** null = public broadcast; otherwise the recipient seat. */
    to: z.number().int().min(0).max(3).nullable(),
    text: z.string().min(1).max(500),
  }),
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
  z.object({
    type: z.literal("reset"),
    seed: z.number().int().optional(),
    players: z.number().int().min(1).max(4).optional(),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
