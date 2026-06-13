/** Adversarial rule-conformance tests for BREEDING AT HARVEST.
 *
 *  Canonical base-game Agricola rule (RULES.md §7.3): breeding happens at the
 *  END of each harvest, AFTER feeding. For each animal type of which the player
 *  has at least 2 (POST-feeding count), exactly 1 offspring is born IF it can be
 *  accommodated (rearrangement allowed). A newborn may NOT be immediately cooked
 *  — if there is no room it is simply not received. Only ONE offspring per type
 *  regardless of count. The round-14 harvest breeds before final scoring.
 *
 *  Each test drives the real feeding/breeding path: it sets state.phase="feeding"
 *  and state.toFeed=[idx], mutates the player to set up a precise board state,
 *  then calls applyFeeding — which runs breed() once the last player has fed.
 */
import { describe, expect, it } from "vitest";
import { mkGame, applyFeeding } from "./harness";
import { computeAutoFeed } from "../apply";
import { edgesOfCell } from "../farmyard";
import type { GameState } from "../types";

/** Fence off a single empty space as a 1-cell pasture (capacity 2). */
function fenceCell(state: GameState, idx: number, cell: number): void {
  const p = state.players[idx]!;
  p.fences = [...p.fences, ...edgesOfCell(cell)];
}

/** Fence off two adjacent empty cells into ONE pasture (capacity 4) by
 *  omitting the shared interior edge. */
function fenceTwoCells(
  state: GameState,
  idx: number,
  a: number,
  b: number,
  sharedEdge: string,
): void {
  const p = state.players[idx]!;
  const edges = new Set<string>([...edgesOfCell(a), ...edgesOfCell(b)]);
  edges.delete(sharedEdge);
  p.fences = [...p.fences, ...edges];
}

/** Drive a single-player feeding step; player has 0 family members so no food is
 *  owed, isolating the breeding behavior. Returns the post-breed state. */
function feedAndBreed(
  state: GameState,
  idx: number,
  conversions: unknown[] = [],
): GameState {
  state.players[idx]!.family = [];
  state.phase = "feeding";
  state.toFeed = [idx];
  return applyFeeding(state, idx, { conversions } as never).state;
}

function total(a: { sheep: number; boar: number; cattle: number }): number {
  return a.sheep + a.boar + a.cattle;
}

describe("breeding at harvest", () => {
  it("2 of a type with room → exactly +1 (sheep 2 → 3)", () => {
    const g = mkGame(2);
    fenceCell(g, 0, 3); // capacity-2 pasture
    g.players[0]!.animals = { sheep: 2, boar: 0, cattle: 0 };
    const after = feedAndBreed(g, 0);
    expect(after.players[0]!.animals.sheep).toBe(3);
  });

  it("1 of a type → no offspring (needs at least 2)", () => {
    const g = mkGame(2);
    fenceCell(g, 0, 3);
    g.players[0]!.animals = { sheep: 1, boar: 0, cattle: 0 };
    const after = feedAndBreed(g, 0);
    expect(after.players[0]!.animals.sheep).toBe(1);
  });

  it("only ONE offspring per type regardless of count (4 sheep → 5, not 6)", () => {
    const g = mkGame(2);
    // Need capacity >= 5: a 2-cell pasture (cap 4) plus the house pet (1).
    fenceTwoCells(g, 0, 3, 4, "v-0-4");
    g.players[0]!.animals = { sheep: 4, boar: 0, cattle: 0 };
    const after = feedAndBreed(g, 0);
    expect(after.players[0]!.animals.sheep).toBe(5);
  });

  it("no room and no other layout → no birth (capacity is the house pet only)", () => {
    const g = mkGame(2);
    // No pasture, no stable: only the house pet (1 any-type) can hold an animal,
    // yet the player already holds 2 sheep. A 3rd cannot be accommodated.
    g.players[0]!.animals = { sheep: 2, boar: 0, cattle: 0 };
    const after = feedAndBreed(g, 0);
    expect(after.players[0]!.animals.sheep).toBe(2);
  });

  it("type already at full capacity → no birth (3 sheep in cap-2 pasture + pet)", () => {
    const g = mkGame(2);
    fenceCell(g, 0, 3); // cap 2 + house pet 1 = 3 sheep total capacity
    g.players[0]!.animals = { sheep: 3, boar: 0, cattle: 0 };
    const after = feedAndBreed(g, 0);
    expect(after.players[0]!.animals.sheep).toBe(3);
  });

  it("newborn may NOT be cooked for food when there is no room (even with a Fireplace)", () => {
    const g = mkGame(2);
    g.players[0]!.majors = ["fireplace2"]; // sheep → 2 food if cooked
    fenceCell(g, 0, 3);
    g.players[0]!.animals = { sheep: 3, boar: 0, cattle: 0 }; // full (cap 3)
    g.players[0]!.resources.food = 0;
    const after = feedAndBreed(g, 0);
    // The would-be newborn is simply not received: count unchanged, no food gained.
    expect(after.players[0]!.animals.sheep).toBe(3);
    expect(after.players[0]!.resources.food).toBe(0);
  });

  it("multiple types breed simultaneously when all fit (two cap-4 pastures)", () => {
    const g = mkGame(2);
    fenceTwoCells(g, 0, 3, 4, "v-0-4"); // pasture A cap 4 (sheep 2 → 3)
    fenceTwoCells(g, 0, 8, 9, "v-1-4"); // pasture B cap 4 (boar 2 → 3)
    g.players[0]!.animals = { sheep: 2, boar: 2, cattle: 0 };
    const after = feedAndBreed(g, 0);
    expect(after.players[0]!.animals.sheep).toBe(3);
    expect(after.players[0]!.animals.boar).toBe(3);
  });

  it("three types breed when each has a roomy pasture (3 × cap-4)", () => {
    const g = mkGame(2);
    fenceTwoCells(g, 0, 0, 1, "v-0-1"); // cap 4
    fenceTwoCells(g, 0, 6, 7, "v-1-2"); // cap 4
    fenceTwoCells(g, 0, 11, 12, "v-2-2"); // cap 4
    g.players[0]!.animals = { sheep: 2, boar: 2, cattle: 2 };
    const after = feedAndBreed(g, 0);
    expect(after.players[0]!.animals).toEqual({ sheep: 3, boar: 3, cattle: 3 });
  });

  it("two full cap-2 pastures + only the house pet → exactly ONE birth total", () => {
    const g = mkGame(2);
    fenceCell(g, 0, 3); // sheep pasture (cap 2, full)
    fenceCell(g, 0, 13); // boar pasture (cap 2, full)
    g.players[0]!.animals = { sheep: 2, boar: 2, cattle: 0 };
    const after = feedAndBreed(g, 0);
    // Capacity = 2 + 2 + 1 (pet) = 5; existing = 4; only one of the two eligible
    // births can be accommodated.
    expect(total(after.players[0]!.animals)).toBe(5);
    const bred =
      (after.players[0]!.animals.sheep === 3 && after.players[0]!.animals.boar === 2) ||
      (after.players[0]!.animals.sheep === 2 && after.players[0]!.animals.boar === 3);
    expect(bred).toBe(true);
  });

  it("a full pasture's type can still breed if an EMPTY pasture exists to spread into", () => {
    const g = mkGame(2);
    fenceCell(g, 0, 3); // pasture A: holds the 2 sheep (full at cap 2)
    fenceCell(g, 0, 13); // pasture B: empty cap 2 — sheep may rearrange to here
    g.players[0]!.animals = { sheep: 2, boar: 0, cattle: 0 };
    const after = feedAndBreed(g, 0);
    expect(after.players[0]!.animals.sheep).toBe(3);
  });

  it("breeding uses POST-feeding counts: cooking 1 of a pair to 1 prevents that breed", () => {
    const g = mkGame(2);
    g.players[0]!.majors = ["fireplace2"]; // sheep → 2 food
    g.players[0]!.family = [{ bornRound: 0, placed: false }]; // owes 2 food
    g.players[0]!.resources.food = 0;
    fenceCell(g, 0, 3);
    g.players[0]!.animals = { sheep: 2, boar: 0, cattle: 0 };
    g.phase = "feeding";
    g.toFeed = [0];
    // Cook 1 sheep for the 2 food owed → 1 sheep remains → not eligible to breed.
    const after = applyFeeding(g, 0, {
      conversions: [{ via: "fireplace2", good: "sheep", count: 1 }],
    } as never).state;
    expect(after.players[0]!.animals.sheep).toBe(1);
    expect(after.players[0]!.beggingCards).toBe(0);
  });

  it("breeding uses POST-feeding counts: cooking 1 of 3 leaves a pair that still breeds", () => {
    const g = mkGame(2);
    g.players[0]!.majors = ["fireplace2"];
    g.players[0]!.family = [{ bornRound: 0, placed: false }]; // owes 2 food
    g.players[0]!.resources.food = 0;
    fenceTwoCells(g, 0, 3, 4, "v-0-4"); // cap 4 so 3 sheep fit
    g.players[0]!.animals = { sheep: 3, boar: 0, cattle: 0 };
    g.phase = "feeding";
    g.toFeed = [0];
    const after = applyFeeding(g, 0, {
      conversions: [{ via: "fireplace2", good: "sheep", count: 1 }],
    } as never).state;
    // 3 → cook 1 → 2 remain → breed → 3.
    expect(after.players[0]!.animals.sheep).toBe(3);
  });

  it("a player who begs (cannot feed) still breeds — breeding is independent of feeding", () => {
    const g = mkGame(2);
    g.players[0]!.family = [
      { bornRound: 0, placed: false },
      { bornRound: 0, placed: false },
    ]; // owes 4 food
    g.players[0]!.resources.food = 0;
    fenceCell(g, 0, 3);
    g.players[0]!.animals = { sheep: 2, boar: 0, cattle: 0 };
    g.phase = "feeding";
    g.toFeed = [0];
    const after = applyFeeding(g, 0, { conversions: [] } as never).state;
    expect(after.players[0]!.beggingCards).toBe(4);
    expect(after.players[0]!.animals.sheep).toBe(3); // still bred
  });

  it("round-14 harvest breeds BEFORE final scoring (the offspring counts for points)", () => {
    const g = mkGame(2);
    g.round = 14;
    fenceCell(g, 0, 3);
    g.players[0]!.animals = { sheep: 2, boar: 0, cattle: 0 };
    g.players[0]!.family = [];
    g.players[1]!.family = [];
    g.phase = "feeding";
    g.toFeed = [0, 1];
    let s = applyFeeding(g, 0, { conversions: [] } as never).state;
    s = applyFeeding(s, 1, { conversions: [] } as never).state;
    expect(s.phase).toBe("finished");
    // After round-14 breeding the player owns 3 sheep; the score must reflect that
    // (sheep band 1–3 → 1 point), proving breeding ran before scoring.
    const sheepCat = s.scores![0]!.categories.find((c) => c.label === "Sheep")!;
    expect(sheepCat.detail).toContain("3 sheep");
    expect(sheepCat.points).toBe(1);
  });

  it("solo game: breeding still occurs after the (3-food/member) feeding", () => {
    const g = mkGame(1);
    g.players[0]!.family = [{ bornRound: 0, placed: false }];
    g.players[0]!.resources.food = 3; // covers solo 3-food requirement
    fenceCell(g, 0, 3);
    g.players[0]!.animals = { sheep: 2, boar: 0, cattle: 0 };
    g.phase = "feeding";
    g.toFeed = [0];
    const after = applyFeeding(g, 0, { conversions: [] } as never).state;
    expect(after.players[0]!.beggingCards).toBe(0);
    expect(after.players[0]!.animals.sheep).toBe(3);
  });

  it("auto-feed preserves a breeding pair: spends grain, not the 2 sheep", () => {
    const g = mkGame(2);
    g.players[0]!.majors = ["fireplace2"];
    g.players[0]!.family = [{ bornRound: 0, placed: false }]; // owes 2 food
    g.players[0]!.resources.food = 0;
    g.players[0]!.resources.grain = 2;
    fenceCell(g, 0, 3);
    g.players[0]!.animals = { sheep: 2, boar: 0, cattle: 0 };
    g.phase = "feeding";
    g.toFeed = [0];
    const decision = computeAutoFeed(g, 0);
    const after = applyFeeding(g, 0, decision as never).state;
    // Grain was used for food, the pair survived and bred.
    expect(after.players[0]!.animals.sheep).toBe(3);
  });

  it("mixed eligibility: a singleton type never breeds even while a pair does", () => {
    const g = mkGame(2);
    fenceTwoCells(g, 0, 3, 4, "v-0-4"); // cap 4 for the cattle pair
    fenceCell(g, 0, 13); // a spare pasture so the lone sheep has a home
    g.players[0]!.animals = { sheep: 1, boar: 0, cattle: 2 };
    const after = feedAndBreed(g, 0);
    expect(after.players[0]!.animals.cattle).toBe(3); // pair bred
    expect(after.players[0]!.animals.sheep).toBe(1); // singleton did not
    expect(after.players[0]!.animals.boar).toBe(0);
  });

  it("breeding never removes existing animals: an unhousable birth leaves the herd intact", () => {
    const g = mkGame(2);
    // A pair sits in a pasture that is already FULL (cap 2, 2 sheep). The house
    // pet is occupied by a lone boar, so there is no slot for a sheep offspring.
    // The breeding step must leave the 2 sheep (and the boar) exactly as-is.
    fenceCell(g, 0, 3); // cap-2 pasture, full with the 2 sheep
    g.players[0]!.animals = { sheep: 2, boar: 1, cattle: 0 }; // boar takes the house pet
    const after = feedAndBreed(g, 0);
    expect(after.players[0]!.animals.sheep).toBe(2); // no birth (no room), none lost
    expect(after.players[0]!.animals.boar).toBe(1); // singleton untouched
  });
});
