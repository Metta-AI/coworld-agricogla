import { describe, expect, it } from "vitest";
import { applyFeeding, applyPlacement, computeAutoFeed, findSpace, RuleError } from "./apply";
import { edgesOfCell } from "./farmyard";
import { newGame } from "./game";
import { GameState } from "./types";

function game(numPlayers = 2, seed = 7): GameState {
  return newGame({ seed, numPlayers });
}

/** Current player takes a simple resource action. */
function take(state: GameState, action: string): GameState {
  return applyPlacement(state, state.currentPlayer, { action } as never).state;
}

/** Find-or-create an action space (round cards may already be revealed). */
function ensureSpace(state: GameState, id: string, pile?: Record<string, number>): void {
  let space = state.actionSpaces.find((s) => s.id === id);
  if (!space) {
    space = { id, occupiedBy: null, pile: {} };
    state.actionSpaces.push(space);
  }
  if (pile) space.pile = pile;
  space.occupiedBy = null;
}

describe("newGame", () => {
  it("sets up players, boards and round 1", () => {
    const s = game(2);
    expect(s.round).toBe(1);
    expect(s.players).toHaveLength(2);
    expect(s.actionSpaces.length).toBe(11); // 10 fixed + 1 round card
    expect(s.roundDeck).toHaveLength(13);
    for (const p of s.players) {
      expect(p.spaces.filter((sp) => sp.kind === "room")).toHaveLength(2);
      expect(p.family).toHaveLength(2);
      expect(p.handOccupations).toHaveLength(7);
      expect(p.handMinors).toHaveLength(7);
    }
    const starting = s.players[s.startingPlayer]!;
    expect(starting.resources.food).toBe(2);
    const other = s.players[(s.startingPlayer + 1) % 2]!;
    expect(other.resources.food).toBe(3);
  });

  it("solo game starts with 0 food and a 2-wood forest", () => {
    const s = game(1);
    expect(s.players[0]!.resources.food).toBe(0);
    const forest = findSpace(s, "forest");
    expect(forest.pile.wood).toBe(2);
  });

  it("3- and 4-player boards add the green spaces", () => {
    const s3 = game(3);
    expect(s3.actionSpaces.some((sp) => sp.id === "quarry_stall")).toBe(true);
    expect(s3.actionSpaces.some((sp) => sp.id === "lessons_b")).toBe(true);
    const s4 = game(4);
    expect(s4.actionSpaces.some((sp) => sp.id === "resource_market")).toBe(true);
    expect(s4.actionSpaces.some((sp) => sp.id === "traveling_players")).toBe(true);
    expect(s4.actionSpaces.some((sp) => sp.id === "copse")).toBe(true);
  });

  it("deals unique cards across players", () => {
    const s = game(4);
    const all = s.players.flatMap((p) => [...p.handOccupations, ...p.handMinors]);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe("work phase", () => {
  it("alternates players and replenishes accumulation spaces", () => {
    let s = game(2);
    const first = s.currentPlayer;
    const forestPile = findSpace(s, "forest").pile.wood ?? 0;
    expect(forestPile).toBe(3);
    s = take(s, "forest");
    expect(s.players[first]!.resources.wood).toBe(3);
    expect(s.currentPlayer).toBe((first + 1) % 2);
    expect(findSpace(s, "forest").occupiedBy).toBe(first);
  });

  it("rejects taking an occupied space", () => {
    let s = game(2);
    s = take(s, "forest");
    expect(() => take(s, "forest")).toThrow(RuleError);
  });

  it("rejects out-of-turn placements", () => {
    const s = game(2);
    const notCurrent = (s.currentPlayer + 1) % 2;
    expect(() => applyPlacement(s, notCurrent, { action: "fishing" } as never)).toThrow(
      /turn/,
    );
  });

  it("after all placements the next round starts", () => {
    let s = game(2);
    // 2 players x 2 family members = 4 placements in round 1.
    const spaces = ["forest", "clay_pit", "reed_bank", "fishing"];
    for (const sp of spaces) s = take(s, sp);
    expect(s.round).toBe(2);
    expect(s.phase).toBe("work");
    expect(s.actionSpaces.every((a) => a.occupiedBy === null)).toBe(true);
  });
});

describe("building", () => {
  it("builds a room with 5 wood + 2 reed adjacent to the hut", () => {
    let s = game(2);
    const p = s.players[s.currentPlayer]!;
    p.resources.wood = 5;
    p.resources.reed = 2;
    // Space 5 = row 1 col 0 is a room; row 0 col 0 (space 0) is adjacent.
    s = applyPlacement(s, s.currentPlayer, {
      action: "farm_expansion",
      rooms: [0],
      stables: [],
    }).state;
    const after = s.players[p.idx]!;
    expect(after.spaces[0]!.kind).toBe("room");
    expect(after.resources.wood).toBe(0);
    expect(after.resources.reed).toBe(0);
  });

  it("rejects non-adjacent rooms and unaffordable builds", () => {
    const s = game(2);
    const p = s.players[s.currentPlayer]!;
    p.resources.wood = 5;
    p.resources.reed = 2;
    expect(() =>
      applyPlacement(s, s.currentPlayer, { action: "farm_expansion", rooms: [4], stables: [] }),
    ).toThrow(/room/);
  });

  it("builds stables for 2 wood each, max 4", () => {
    let s = game(2);
    const p = s.players[s.currentPlayer]!;
    p.resources.wood = 10;
    s = applyPlacement(s, s.currentPlayer, {
      action: "farm_expansion",
      rooms: [],
      stables: [1, 2, 3, 4],
    }).state;
    const after = s.players[p.idx]!;
    expect(after.spaces.filter((sp) => sp.stable)).toHaveLength(4);
    expect(after.resources.wood).toBe(2);
  });

  it("renovation upgrades wood -> clay for rooms x clay + 1 reed", () => {
    let s = game(2);
    // Move to a state where renovation card is in play.
    ensureSpace(s, "r_renovate_improve");
    const p = s.players[s.currentPlayer]!;
    p.resources.clay = 2;
    p.resources.reed = 1;
    s = applyPlacement(s, s.currentPlayer, { action: "r_renovate_improve" }).state;
    const after = s.players[p.idx]!;
    expect(after.houseMaterial).toBe("clay");
    expect(after.resources.clay).toBe(0);
    expect(after.resources.reed).toBe(0);
  });
});

describe("fields and sowing", () => {
  it("plows, sows and harvests grain", () => {
    let s = game(2);
    const idx = s.currentPlayer;
    let p = s.players[idx]!;
    p.resources.grain = 1;
    s = applyPlacement(s, idx, { action: "farmland", spaces: [4] }).state;
    expect(s.players[idx]!.spaces[4]!.kind).toBe("field");

    ensureSpace(s, "r_sow_bake");
    // Wait for this player's turn again.
    while (s.currentPlayer !== idx) s = take(s, "fishing");
    s = applyPlacement(s, idx, {
      action: "r_sow_bake",
      sow: [{ space: 4, crop: "grain" }],
      bake: [],
    }).state;
    p = s.players[idx]!;
    expect(p.spaces[4]!.cropCount).toBe(3);
    expect(p.resources.grain).toBe(0);
  });

  it("requires adjacency for the second field", () => {
    const s = game(2);
    const idx = s.currentPlayer;
    s.players[idx]!.spaces[4]!.kind = "field";
    expect(() => applyPlacement(s, idx, { action: "farmland", spaces: [10] })).toThrow(/plow/);
  });
});

describe("occupations and improvements", () => {
  it("first occupation is free, the second costs 1 food", () => {
    let s = game(2);
    const idx = s.currentPlayer;
    // Use inert occupations so food only moves through the lessons cost.
    s.players[idx]!.handOccupations = ["occ_lumberjack", "occ_carpenter"];
    const food0 = s.players[idx]!.resources.food;
    s = applyPlacement(s, idx, { action: "lessons", occupation: "occ_lumberjack" }).state;
    expect(s.players[idx]!.occupations).toHaveLength(1);
    expect(s.players[idx]!.resources.food).toBe(food0);

    // Second occupation on the same space costs 1 food next turn.
    while (s.currentPlayer !== idx) s = take(s, "fishing");
    ensureSpace(s, "lessons");
    s = applyPlacement(s, idx, { action: "lessons", occupation: "occ_carpenter" }).state;
    expect(s.players[idx]!.occupations).toHaveLength(2);
    expect(s.players[idx]!.resources.food).toBe(food0 - 1);
  });

  it("buys a major improvement and bakes with an oven immediately", () => {
    let s = game(2);
    ensureSpace(s, "r_improvement");
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.resources.clay = 3;
    p.resources.stone = 1;
    p.resources.grain = 1;
    s = applyPlacement(s, idx, {
      action: "r_improvement",
      improvement: { kind: "major", card: "clay_oven", bake: [{ card: "clay_oven", grain: 1 }] },
    }).state;
    const after = s.players[idx]!;
    expect(after.majors).toContain("clay_oven");
    expect(after.resources.food).toBeGreaterThanOrEqual(5);
    expect(s.majorsAvailable).not.toContain("clay_oven");
  });

  it("upgrades fireplace to cooking hearth by returning it", () => {
    let s = game(2);
    ensureSpace(s, "r_improvement");
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors.push("fireplace2");
    s.majorsAvailable = s.majorsAvailable.filter((m) => m !== "fireplace2");
    s = applyPlacement(s, idx, {
      action: "r_improvement",
      improvement: { kind: "major", card: "hearth4", returnFireplace: "fireplace2" },
    }).state;
    const after = s.players[idx]!;
    expect(after.majors).toContain("hearth4");
    expect(after.majors).not.toContain("fireplace2");
    expect(s.majorsAvailable).toContain("fireplace2");
  });
});

describe("animals and harvest", () => {
  it("takes sheep, cooks overflow with a fireplace", () => {
    let s = game(2);
    ensureSpace(s, "r_sheep", { sheep: 4 });
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors.push("fireplace2");
    const food0 = p.resources.food;
    s = applyPlacement(s, idx, { action: "r_sheep" }).state;
    const after = s.players[idx]!;
    // Pet slot holds 1; 3 overflow cooked at 2 food each.
    expect(after.animals.sheep).toBe(1);
    expect(after.resources.food).toBe(food0 + 6);
  });

  it("full harvest: fields, feeding, breeding", () => {
    let s = game(2, 11);
    // Fast-forward: round 4 is a harvest. Play rounds 1-4 with simple takes.
    const simple = ["forest", "clay_pit", "reed_bank", "fishing"];
    while (s.round < 5 && s.phase === "work") {
      const free = simple.find((id) => findSpace(s, id).occupiedBy === null)!;
      s = take(s, free);
    }
    expect(s.phase).toBe("feeding");
    expect(s.toFeed).toEqual([0, 1]);
    // Feeding decisions are applied on a clone; set exact resources now.
    s.players[0]!.resources.food = 4;
    s.players[1]!.resources.food = 0;
    s.players[1]!.resources.grain = 1;

    let r = applyFeeding(s, 0, { conversions: [] });
    expect(r.state.players[0]!.resources.food).toBe(0);
    expect(r.state.players[0]!.beggingCards).toBe(0);

    // Player 1: 1 raw grain = 1 food, needs 4 -> 3 begging cards.
    r = applyFeeding(r.state, 1, { conversions: [{ via: "raw", good: "grain", count: 1 }] });
    expect(r.state.players[1]!.beggingCards).toBe(3);
    expect(r.state.round).toBe(5);
    expect(r.state.phase).toBe("work");
  });

  it("breeding adds one animal per pair with room", () => {
    let s = game(2, 13);
    const idx = 0;
    const p = s.players[idx]!;
    // Big pasture over two cells.
    p.fences = [...edgesOfCell(3), ...edgesOfCell(4)].filter(
      (e, i, arr) => arr.indexOf(e) === i && e !== "v-0-4",
    );
    p.fencesBuilt = p.fences.length;
    p.animals.sheep = 2;
    p.resources.food = 20;
    s.players[1]!.resources.food = 20;
    // Run to end of round 4 (harvest), feed both with nothing.
    const simple = ["forest", "clay_pit", "reed_bank", "fishing"];
    while (s.round < 5 && s.phase === "work") {
      if (s.phase === "work") {
        const free = simple.find((id) => findSpace(s, id).occupiedBy === null)!;
        s = take(s, free);
      }
      if (s.phase === "feeding") break;
    }
    expect(s.phase).toBe("feeding");
    let r = applyFeeding(s, 0, { conversions: [] });
    r = applyFeeding(r.state, 1, { conversions: [] });
    expect(r.state.players[0]!.animals.sheep).toBe(3);
  });
});

describe("auto feed", () => {
  it("covers the need from food, grain and animals", () => {
    const s = game(2);
    s.phase = "feeding";
    s.toFeed = [0, 1];
    const p = s.players[0]!;
    p.resources.food = 1;
    p.resources.grain = 3;
    p.family = [
      { bornRound: 0, placed: false },
      { bornRound: 0, placed: false },
    ];
    const decision = computeAutoFeed(s, 0);
    const r = applyFeeding(s, 0, decision);
    expect(r.state.players[0]!.beggingCards).toBe(0);
  });
});

describe("family growth", () => {
  it("requires a free room, urgent growth does not", () => {
    let s = game(2);
    ensureSpace(s, "r_family_growth");
    ensureSpace(s, "r_urgent_family");
    const idx = s.currentPlayer;
    expect(() => applyPlacement(s, idx, { action: "r_family_growth" })).toThrow(/room/);
    s = applyPlacement(s, idx, { action: "r_urgent_family" }).state;
    const p = s.players[idx]!;
    expect(p.family).toHaveLength(3);
    expect(p.family[2]!.placed).toBe(true); // newborn cannot act this round
  });
});

describe("full seeded games complete", () => {
  it("a trivial 14-round game ends with scores", () => {
    let s = game(2, 42);
    const simple = ["forest", "clay_pit", "reed_bank", "fishing", "day_laborer", "grain_seeds"];
    let guard = 0;
    while (s.phase !== "finished" && guard++ < 500) {
      if (s.phase === "work") {
        const free = simple.find((id) => findSpace(s, id).occupiedBy === null)!;
        s = take(s, free);
      } else if (s.phase === "feeding") {
        s = applyFeeding(s, s.toFeed[0]!, computeAutoFeed(s, s.toFeed[0]!)).state;
      }
    }
    expect(s.phase).toBe("finished");
    expect(s.scores).toHaveLength(2);
    expect(s.round).toBe(14);
    for (const sheet of s.scores!) {
      // Sanity: categories all present, totals finite.
      expect(sheet.categories.length).toBeGreaterThanOrEqual(14);
      expect(Number.isFinite(sheet.total)).toBe(true);
    }
  });
});
