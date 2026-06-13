import { GameState } from "../shared/engine/types";
import { ActionOption, PlayerChoices } from "../shared/engine/legal";
import { FeedDecision, Placement } from "../shared/engine/placements";

export interface AgentView {
  state: GameState;
  playerIdx: number;
  options: ActionOption[];
  choices: PlayerChoices;
  /** Operator autopilot directive, prepended to the prompt every decision. */
  guidance?: string;
}

export interface Agent {
  id: string;
  kind: string;
  decidePlacement(view: AgentView): Promise<Placement>;
  decideFeeding(view: AgentView): Promise<FeedDecision>;
}

/** Transparency record of an agent decision (shown in the UI). */
export interface ActPromptEntry {
  playerIdx: number;
  round: number;
  phase: string;
  content: string;
}
