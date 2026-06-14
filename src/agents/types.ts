import { GameState } from "../shared/engine/types";
import { ActionOption, PlayerChoices } from "../shared/engine/legal";
import { FeedDecision, Placement } from "../shared/engine/placements";
import { ChatMessage } from "../shared/protocol";

export interface AgentView {
  state: GameState;
  playerIdx: number;
  options: ActionOption[];
  choices: PlayerChoices;
  /** Operator autopilot directive, prepended to the prompt every decision. */
  guidance?: string;
  /** This seat's private diary entries (oldest first), shown when the memory
   *  capability is on. Owned by the agent; the runner does not populate it. */
  memory?: string[];
  /** Table-talk this seat can see (other players' public messages + DMs to it),
   *  shown when the chat capability is on. Populated by the runner. */
  messages?: ChatMessage[];
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
  /** True when the LLM never produced a legal move and the scripted policy
   *  took the turn. Used by the experiment harness to flag games whose A/B
   *  signal is contaminated by fallbacks (throttling, refusals, loops). */
  fellBack?: boolean;
}
