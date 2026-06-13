/** LLM Coworld player: connects to the game's /player WebSocket
 *  (COWORLD_PLAYER_WS_URL) and answers observations with the Bedrock
 *  tool-use agent. The agent dry-runs its own decisions and falls back to
 *  the scripted heuristic after repeated misfires, so it always replies.
 *  Hosted runs get Bedrock credentials via `coworld upload-policy
 *  --use-bedrock --bedrock-model …` (BEDROCK_MODEL selects the model). */
import { WebSocket } from "ws";
import { AgentView } from "./types";
import { llmAgent } from "./llm/llm-agent";
import { fallbackPlacement } from "./scripted";
import { computeAutoFeed } from "../shared/engine/apply";
import { roundCards } from "../shared/engine/boards";
import { FeedDecision, Placement } from "../shared/engine/placements";
import { GameState } from "../shared/engine/types";
import {
  CoworldPlayerMessage,
  CoworldServerMessage,
} from "../shared/coworld-protocol";

/** Per-decision wall-clock budget. Must stay below the server's
 *  act_timeout_seconds (default 20s) so the player always replies in time:
 *  if the LLM is slow (or Bedrock stalls), we fall back to the scripted
 *  decision locally rather than letting the server time out and waste the
 *  full window. Tune with COWORLD_LLM_DECISION_BUDGET_MS. */
const DECISION_BUDGET_MS = Number(process.env.COWORLD_LLM_DECISION_BUDGET_MS ?? 15_000);

/** Resolve `work` with the LLM's answer, or the scripted fallback if the
 *  budget elapses first. The losing promise is left to settle harmlessly. */
function withBudget<T>(llm: Promise<T>, fallback: () => T, label: string): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const done = (value: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      console.log(`[budget] ${label} exceeded ${DECISION_BUDGET_MS}ms; using scripted fallback`);
      done(fallback());
    }, DECISION_BUDGET_MS);
    llm.then(done, (err) => {
      console.log(`[budget] ${label} errored (${String(err)}); using scripted fallback`);
      done(fallback());
    });
  });
}

/** Tournament observations mask the round deck as "hidden" (the order is
 *  face-down information). The agent's local dry-run still needs a deck that
 *  the engine can reveal, so substitute the unrevealed round cards — a
 *  public set — in stage order. Current-turn legality is unaffected. */
export function unmaskRoundDeck(state: GameState): GameState {
  if (!state.roundDeck.some((id) => id === "hidden")) return state;
  const onBoard = new Set(state.actionSpaces.map((space) => space.id));
  const remaining = roundCards
    .filter((card) => !onBoard.has(card.id))
    .sort((a, b) => (a.stage ?? 0) - (b.stage ?? 0))
    .map((card) => card.id);
  return { ...state, roundDeck: remaining };
}

async function playEpisode(url: string): Promise<void> {
  const agent = llmAgent("coworld-llm", {
    maxAttempts: 2, // stay well inside the server's per-decision timeout
    onActPrompt: (entry) =>
      console.log(`[round ${entry.round} ${entry.phase}]\n${entry.content}\n`),
  });

  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });
  console.log(`connected to ${url.replace(/token=[^&]*/, "token=***")}`);

  // Observations are request/response, but answer them through a queue so a
  // server-side retry can never interleave with an in-flight decision.
  let chain: Promise<void> = Promise.resolve();

  const decide = async (
    message: CoworldServerMessage & { type: "observation" },
  ): Promise<CoworldPlayerMessage> => {
    const view: AgentView = {
      state: unmaskRoundDeck(message.state),
      playerIdx: message.slot,
      options: message.options,
      choices: message.choices,
    };
    if (message.phase === "work") {
      const placement = await withBudget<Placement>(
        agent.decidePlacement(view),
        () => fallbackPlacement(view),
        `round ${message.state.round} placement`,
      );
      return { type: "place", decisionId: message.decisionId, placement };
    }
    const decision = await withBudget<FeedDecision>(
      agent.decideFeeding(view),
      () => computeAutoFeed(view.state, view.playerIdx),
      `round ${message.state.round} feeding`,
    );
    return { type: "feed", decisionId: message.decisionId, decision };
  };

  await new Promise<void>((resolve, reject) => {
    socket.on("message", (raw) => {
      const message = JSON.parse(raw.toString()) as CoworldServerMessage;
      if (message.type === "welcome") {
        console.log(`seated at slot ${message.slot} of ${message.numPlayers}`);
        return;
      }
      if (message.type === "final") {
        console.log(`episode over: scores=${JSON.stringify(message.results.scores)}`);
        socket.close();
        resolve();
        return;
      }
      if (message.type === "observation") {
        if (message.attempt > 1) {
          console.log(`server rejected previous reply: ${message.error}`);
        }
        chain = chain.then(async () => {
          const reply = await decide(message);
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify(reply));
          }
        });
        chain.catch(reject);
      }
    });
    socket.on("close", () => resolve());
    socket.on("error", reject);
  });
}

const isDirectRun =
  process.argv[1]?.endsWith("coworld-llm-player.ts") ||
  process.argv[1]?.endsWith("coworld-llm-player.js");
if (isDirectRun) {
  const url = process.env.COWORLD_PLAYER_WS_URL;
  if (!url) throw new Error("missing required environment variable: COWORLD_PLAYER_WS_URL");
  playEpisode(url)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
