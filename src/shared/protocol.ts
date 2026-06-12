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

export type ServerMessage =
  | { type: "state"; state: GameState; handSizes: HandSizes[] }
  | { type: "status"; status: ServerStatus }
  | { type: "actPrompt"; entry: ActPromptWire }
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
  z.object({ type: z.literal("pause") }),
  z.object({ type: z.literal("resume") }),
  z.object({
    type: z.literal("reset"),
    seed: z.number().int().optional(),
    players: z.number().int().min(1).max(4).optional(),
  }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;
