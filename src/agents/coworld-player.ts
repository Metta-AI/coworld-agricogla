/** Bundled baseline Coworld player: connects to the game's /player WebSocket
 *  (COWORLD_PLAYER_WS_URL) and answers every observation with the scripted
 *  heuristic. Used for certification and as the league baseline policy. */
import { WebSocket } from "ws";
import { AgentView } from "./types";
import { fallbackPlacement } from "./scripted";
import { computeAutoFeed } from "../shared/engine/apply";
import {
  CoworldPlayerMessage,
  CoworldServerMessage,
} from "../shared/coworld-protocol";

export function decideReply(message: CoworldServerMessage & { type: "observation" }): CoworldPlayerMessage {
  const view: AgentView = {
    state: message.state,
    playerIdx: message.slot,
    options: message.options,
    choices: message.choices,
  };
  if (message.phase === "work") {
    return {
      type: "place",
      decisionId: message.decisionId,
      placement: fallbackPlacement(view),
    };
  }
  return {
    type: "feed",
    decisionId: message.decisionId,
    decision: computeAutoFeed(message.state, message.slot),
  };
}

async function playEpisode(url: string): Promise<void> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    socket.on("open", resolve);
    socket.on("error", reject);
  });
  console.log(`connected to ${url.replace(/token=[^&]*/, "token=***")}`);

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
          console.log(`retrying after rejection: ${message.error}`);
        }
        socket.send(JSON.stringify(decideReply(message)));
      }
    });
    socket.on("close", () => resolve());
    socket.on("error", reject);
  });
}

const isDirectRun =
  process.argv[1]?.endsWith("coworld-player.ts") || process.argv[1]?.endsWith("coworld-player.js");
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
