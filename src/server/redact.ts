import { GameState } from "../shared/engine/types";
import { HandSizes } from "../shared/protocol";

export interface RedactOpts {
  /** Tournament mode: also hide information a policy could exploit — the
   *  RNG seed (re-running the deal reveals every hand) and the upcoming
   *  round-card order (hidden in the physical game). */
  maskFuture?: boolean;
}

/** Hide other players' hands. `forPlayer` null = spectator (all hands hidden).
 *  Hand sizes are reported separately so the UI can show card backs. */
export function redactState(
  state: GameState,
  forPlayer: number | null,
  opts: RedactOpts = {},
): { state: GameState; handSizes: HandSizes[] } {
  const clone = structuredClone(state);
  const handSizes: HandSizes[] = [];
  for (const player of clone.players) {
    handSizes.push({
      occupations: player.handOccupations.length,
      minors: player.handMinors.length,
    });
    if (player.idx !== forPlayer) {
      player.handOccupations = [];
      player.handMinors = [];
    }
  }
  if (opts.maskFuture) {
    clone.seed = 0;
    clone.roundDeck = clone.roundDeck.map(() => "hidden");
  }
  return { state: clone, handSizes };
}
