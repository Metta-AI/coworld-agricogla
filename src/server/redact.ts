import { GameState } from "../shared/engine/types";
import { HandSizes } from "../shared/protocol";

/** Hide other players' hands. `forPlayer` null = spectator (all hands hidden).
 *  Hand sizes are reported separately so the UI can show card backs. */
export function redactState(
  state: GameState,
  forPlayer: number | null,
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
  return { state: clone, handSizes };
}
