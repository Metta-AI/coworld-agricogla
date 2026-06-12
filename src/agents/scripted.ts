import { Agent, AgentView } from "./types";
import { enumerateCandidates } from "./candidates";
import { computeAutoFeed } from "../shared/engine/apply";
import { FeedDecision, Placement } from "../shared/engine/placements";
import { makeRng, randInt, Rng } from "../shared/engine/rng";

/** Fallback placement: take the first available simple space. */
export function fallbackPlacement(view: AgentView): Placement {
  const candidates = enumerateCandidates(view);
  if (candidates.length > 0) return candidates[0]!.placement;
  // Last resort: any unoccupied space with a parameterless take.
  const open = view.options.find((o) => o.available);
  if (!open) {
    // No available action should be impossible; the engine treats simple takes
    // as always available. Surface loudly if it happens.
    throw new Error(`no available action for player ${view.playerIdx}`);
  }
  return { action: open.id } as Placement;
}

export function scriptedAgent(id: string): Agent {
  return {
    id,
    kind: "scripted",
    async decidePlacement(view: AgentView): Promise<Placement> {
      return fallbackPlacement(view);
    },
    async decideFeeding(view: AgentView): Promise<FeedDecision> {
      return computeAutoFeed(view.state, view.playerIdx);
    },
  };
}

/** Random-ish agent for fuzzing: picks uniformly among candidate placements. */
export function randomAgent(id: string, seed: number): Agent {
  const rng: Rng = makeRng(seed);
  return {
    id,
    kind: "random",
    async decidePlacement(view: AgentView): Promise<Placement> {
      const candidates = enumerateCandidates(view);
      if (candidates.length === 0) return fallbackPlacement(view);
      return candidates[randInt(rng, candidates.length)]!.placement;
    },
    async decideFeeding(view: AgentView): Promise<FeedDecision> {
      return computeAutoFeed(view.state, view.playerIdx);
    },
  };
}
