/** Shared test harness for the adversarial rule-conformance suite.
 *
 *  These helpers drive the engine through the same public entry points the real
 *  game uses (`applyPlacement`, `applyFeeding`, `computeAutoFeed`) so the tests
 *  exercise the real rules path, not internal shortcuts. Where a test needs to
 *  set up a specific board state it mutates the (cloned-per-step) GameState
 *  directly — that is fine because the engine clones on every step.
 */
import { applyFeeding, applyPlacement, computeAutoFeed, findSpace } from "../apply";
import { newGame } from "../game";
import { ActionSpaceState, GameState, PlayerState } from "../types";

/** Action spaces that can always be taken with a bare `{ action: id }`
 *  placement and never throw regardless of player state (pure resource grabs).
 *  Used to fast-forward turns we don't care about. */
export const SAFE_TAKES = [
  "grain_seeds",
  "day_laborer",
  "forest",
  "clay_pit",
  "reed_bank",
  "fishing",
  "grove",
  "hollow",
  "copse",
  "quarry_stall",
  "resource_market",
  "traveling_players",
  "r_sheep",
  "r_west_quarry",
  "r_vegetable",
  "r_boar",
  "r_east_quarry",
  "r_cattle",
] as const;

export function mkGame(numPlayers = 2, seed = 7): GameState {
  return newGame({ seed, numPlayers });
}

export function cur(state: GameState): PlayerState {
  return state.players[state.currentPlayer]!;
}

/** Apply a placement for the current player; returns the next state. */
export function place(state: GameState, placement: unknown): GameState {
  return applyPlacement(state, state.currentPlayer, placement as never).state;
}

/** Apply a placement for a specific player; returns the next state. */
export function placeFor(state: GameState, idx: number, placement: unknown): GameState {
  return applyPlacement(state, idx, placement as never).state;
}

/** Current player takes a bare resource action. */
export function take(state: GameState, action: string): GameState {
  return applyPlacement(state, state.currentPlayer, { action } as never).state;
}

/** Find-or-create an unoccupied action space, optionally seeding its pile. */
export function ensureSpace(
  state: GameState,
  id: string,
  pile?: Record<string, number>,
): ActionSpaceState {
  let space = state.actionSpaces.find((s) => s.id === id);
  if (!space) {
    space = { id, occupiedBy: null, pile: {} };
    state.actionSpaces.push(space);
  }
  if (pile) space.pile = { ...pile };
  space.occupiedBy = null;
  return space;
}

/** An unoccupied safe-take space id, or undefined if none are free. */
export function freeSafeTake(state: GameState): string | undefined {
  for (const id of SAFE_TAKES) {
    const space = state.actionSpaces.find((s) => s.id === id);
    if (space && space.occupiedBy === null) return id;
  }
  return undefined;
}

/** Fast-forward the current round (work phase only) by having every remaining
 *  worker grab a safe resource space. Stops as soon as the phase changes
 *  (harvest/feeding) or the round advances. */
export function fillRound(state: GameState): GameState {
  const round = state.round;
  let guard = 0;
  while (state.phase === "work" && state.round === round && guard++ < 100) {
    const id = freeSafeTake(state);
    if (!id) break;
    state = take(state, id);
  }
  return state;
}

/** Advance until it is `idx`'s turn again in the current round, parking other
 *  players on safe spaces. Returns early if the phase/round changes. */
export function advanceTo(state: GameState, idx: number): GameState {
  const round = state.round;
  let guard = 0;
  while (
    state.phase === "work" &&
    state.round === round &&
    state.currentPlayer !== idx &&
    guard++ < 100
  ) {
    const id = freeSafeTake(state);
    if (!id) break;
    state = take(state, id);
  }
  return state;
}

/** Auto-feed every player still owing a feeding decision this harvest. */
export function autoFeedAll(state: GameState): GameState {
  let guard = 0;
  while (state.phase === "feeding" && guard++ < 20) {
    const idx = state.toFeed[0]!;
    state = applyFeeding(state, idx, computeAutoFeed(state, idx)).state;
  }
  return state;
}

/** Play with only safe takes + auto-feeding until the given round is reached in
 *  the work phase, or the game finishes. Family never grows, so worker counts
 *  stay small and the safe-take pool is always sufficient. */
export function playUntilRound(state: GameState, targetRound: number): GameState {
  let guard = 0;
  while (state.phase !== "finished" && state.round < targetRound && guard++ < 2000) {
    if (state.phase === "work") {
      const id = freeSafeTake(state);
      if (!id) break;
      state = take(state, id);
    } else if (state.phase === "feeding") {
      const idx = state.toFeed[0]!;
      state = applyFeeding(state, idx, computeAutoFeed(state, idx)).state;
    }
  }
  return state;
}

/** Play the game to completion with safe takes + auto-feed; returns the
 *  finished state. Gives every player plenty of food first so nobody is forced
 *  to beg (keeps the run deterministic for end-state assertions). */
export function playToEnd(state: GameState, feedFood = 100): GameState {
  for (const p of state.players) p.resources.food = Math.max(p.resources.food, feedFood);
  let guard = 0;
  while (state.phase !== "finished" && guard++ < 4000) {
    if (state.phase === "work") {
      const id = freeSafeTake(state);
      if (!id) break;
      state = take(state, id);
    } else if (state.phase === "feeding") {
      const idx = state.toFeed[0]!;
      state = applyFeeding(state, idx, { conversions: [] }).state;
    }
  }
  return state;
}

/** Drive the game to the next feeding phase (first harvest from `state`). */
export function playToFeeding(state: GameState): GameState {
  let guard = 0;
  while (state.phase === "work" && guard++ < 200) {
    const id = freeSafeTake(state);
    if (!id) break;
    state = take(state, id);
  }
  return state;
}

export { applyFeeding, applyPlacement, computeAutoFeed, findSpace };
