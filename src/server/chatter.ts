/** Lightweight templated table-talk for bot-controlled seats, so the
 *  negotiation feed feels alive without spending model calls on cheap talk.
 *  Purely cosmetic: chatter never touches game state. */
import { GameState } from "../shared/engine/types";
import { HARVEST_ROUNDS } from "../shared/engine/boards";

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)]!;

const ROUND_LINES = [
  "Another round, another worker to spend.",
  "Wood is the bottleneck again — anyone hoarding the Forest?",
  "I need reed badly. Trade?",
  "Leave me the clay pit and I'll leave you the sheep.",
  "Growing the family this round, fingers crossed for a free room.",
  "Watching that grain stockpile of yours nervously.",
  "Whoever takes Farmland first gets my respect.",
];

const HARVEST_LINES = [
  "Harvest next round — count your food, friends.",
  "Hope everyone's fed. Begging cards are brutal.",
  "Breeding pairs alive? Mine barely.",
  "Tightening the belt for the harvest.",
];

const DM_REPLIES = [
  "Deal — but I want first pick of the quarry next round.",
  "Tempting. Let me see how my feeding shakes out first.",
  "Hah, you wish. Maybe if you throw in a reed.",
  "Sure, I can spare that. Don't make me regret it.",
  "No promises, but I won't block your fences.",
  "Talk to Cole — they're the one sitting on stone.",
  "I'm listening. What's in it for me?",
];

/** A public quip a bot might post at the start of a round. */
export function roundQuip(state: GameState): string {
  return HARVEST_ROUNDS.has(state.round - 1) || HARVEST_ROUNDS.has(state.round)
    ? pick(HARVEST_LINES)
    : pick(ROUND_LINES);
}

/** A bot's reply to a direct message from another player. */
export function dmReply(): string {
  return pick(DM_REPLIES);
}
