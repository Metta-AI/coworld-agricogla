import { Agent, AgentView } from "./types";
import { fallbackPlacement } from "./scripted";
import { applyFeeding, applyPlacement, computeAutoFeed, RuleError } from "../shared/engine/apply";
import { legalActions, playerChoices } from "../shared/engine/legal";
import { GameState } from "../shared/engine/types";

export function buildView(state: GameState, playerIdx: number): AgentView {
  return {
    state,
    playerIdx,
    options: legalActions(state, playerIdx),
    choices: playerChoices(state, playerIdx),
  };
}

export interface RunHooks {
  /** Called after every state transition. */
  onState?: (state: GameState) => void | Promise<void>;
}

/** Advance the game by one agent decision. Illegal agent output falls back to
 *  the scripted default so games always terminate. */
export async function stepGame(state: GameState, agents: Agent[]): Promise<GameState> {
  if (state.phase === "work") {
    const idx = state.currentPlayer;
    const view = buildView(state, idx);
    const agent = agents[idx]!;
    const placement = await agent.decidePlacement(view);
    try {
      return applyPlacement(state, idx, placement).state;
    } catch (err) {
      if (!(err instanceof RuleError)) throw err;
      return applyPlacement(state, idx, fallbackPlacement(view)).state;
    }
  }
  if (state.phase === "feeding") {
    const idx = state.toFeed[0]!;
    const view = buildView(state, idx);
    const agent = agents[idx]!;
    const decision = await agent.decideFeeding(view);
    try {
      return applyFeeding(state, idx, decision).state;
    } catch (err) {
      if (!(err instanceof RuleError)) throw err;
      return applyFeeding(state, idx, computeAutoFeed(state, idx)).state;
    }
  }
  throw new Error("game is finished");
}

export async function runToCompletion(
  state: GameState,
  agents: Agent[],
  hooks: RunHooks = {},
): Promise<GameState> {
  let current = state;
  let guard = 0;
  while (current.phase !== "finished") {
    if (guard++ > 2000) throw new Error("game did not terminate after 2000 steps");
    current = await stepGame(current, agents);
    await hooks.onState?.(current);
  }
  return current;
}
