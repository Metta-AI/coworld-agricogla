import { describe, expect, it } from "vitest";
import { applyFeeding, applyPlacement } from "../apply";
import { newGame } from "../game";
import { scorePlayer } from "../scoring";
import { GameState } from "../types";
import { majors, minors, occupations } from "./index";

function game(numPlayers = 2, seed = 7): GameState {
  return newGame({ seed, numPlayers });
}

function ensureSpace(state: GameState, id: string, pile?: Record<string, number>): void {
  let space = state.actionSpaces.find((s) => s.id === id);
  if (!space) {
    space = { id, occupiedBy: null, pile: {} };
    state.actionSpaces.push(space);
  }
  if (pile) space.pile = pile;
  space.occupiedBy = null;
}

describe("deck integrity", () => {
  it("has full decks with unique ids and correct kinds", () => {
    expect(majors).toHaveLength(10);
    expect(occupations.length).toBeGreaterThanOrEqual(48);
    expect(minors.length).toBeGreaterThanOrEqual(48);
    const ids = [...majors, ...occupations, ...minors].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of occupations) expect(c.kind).toBe("occupation");
    for (const c of minors) expect(c.kind).toBe("minor");
    for (const c of majors) expect(c.kind).toBe("major");
  });

  it("every card has a name and rules text", () => {
    for (const c of [...majors, ...occupations, ...minors]) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.text.length).toBeGreaterThan(0);
    }
  });

  it("decks are large enough to deal 7+7 to four players", () => {
    expect(occupations.length).toBeGreaterThanOrEqual(28);
    expect(minors.length).toBeGreaterThanOrEqual(28);
  });
});

describe("hook types", () => {
  it("onGain: Lumberjack adds +1 wood when taking wood", () => {
    let s = game();
    const idx = s.currentPlayer;
    s.players[idx]!.occupations.push("occ_lumberjack");
    s = applyPlacement(s, idx, { action: "forest" }).state;
    expect(s.players[idx]!.resources.wood).toBe(4);
  });

  it("plowExtra: Wooden Plow lets a plow action plow 2 fields, twice", () => {
    let s = game();
    const idx = s.currentPlayer;
    s.players[idx]!.minors.push("min_wooden_plow");
    s = applyPlacement(s, idx, {
      action: "farmland",
      spaces: [4, 9],
      plowCard: "min_wooden_plow",
    }).state;
    const p = s.players[idx]!;
    expect(p.spaces.filter((sp) => sp.kind === "field")).toHaveLength(2);
    expect(p.cardData["min_wooden_plow"]!.plowUses).toBe(1);
  });

  it("freeFences: Hedge Warden makes 2 fences free", () => {
    let s = game();
    ensureSpace(s, "r_fences");
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.occupations.push("occ_hedge_warden");
    p.resources.wood = 2;
    // Cell 4 pasture needs 4 fences; 2 free + 2 paid.
    s = applyPlacement(s, idx, {
      action: "r_fences",
      edges: ["h-0-4", "h-1-4", "v-0-4", "v-0-5"],
    }).state;
    expect(s.players[idx]!.resources.wood).toBe(0);
    expect(s.players[idx]!.fences).toHaveLength(4);
  });

  it("roomDiscount: Carpenter builds wooden rooms for 3 wood", () => {
    let s = game();
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.occupations.push("occ_carpenter");
    p.resources.wood = 3;
    p.resources.reed = 2;
    s = applyPlacement(s, idx, { action: "farm_expansion", rooms: [0], stables: [] }).state;
    expect(s.players[idx]!.spaces[0]!.kind).toBe("room");
    expect(s.players[idx]!.resources.wood).toBe(0);
  });

  it("capacity: Swineherd holds 2 boar beyond the pet slot", () => {
    let s = game();
    ensureSpace(s, "r_boar", { boar: 3 });
    const idx = s.currentPlayer;
    s.players[idx]!.occupations.push("occ_swineherd");
    s = applyPlacement(s, idx, { action: "r_boar" }).state;
    expect(s.players[idx]!.animals.boar).toBe(3);
  });

  it("scheduled goods: Well pays food at the next 5 round starts", () => {
    let s = game(2, 5);
    ensureSpace(s, "r_improvement");
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.resources.wood = 1;
    p.resources.stone = 3;
    s = applyPlacement(s, idx, {
      action: "r_improvement",
      improvement: { kind: "major", card: "well" },
    }).state;
    expect(s.scheduled).toHaveLength(5);
    const food0 = s.players[idx]!.resources.food;
    // Finish the round: 3 remaining placements (other player has 2, this one 1).
    const simple = ["forest", "clay_pit", "reed_bank", "fishing", "day_laborer"];
    while (s.round === 1) {
      const free = simple.find(
        (id) => s.actionSpaces.find((a) => a.id === id)!.occupiedBy === null,
      )!;
      s = applyPlacement(s, s.currentPlayer, { action: free } as never).state;
    }
    expect(s.round).toBe(2);
    expect(s.players[idx]!.resources.food).toBeGreaterThanOrEqual(food0 + 1);
    expect(s.scheduled).toHaveLength(4);
  });

  it("passing: Lending Cart goes to the left-hand neighbor", () => {
    let s = game(2);
    ensureSpace(s, "r_improvement");
    const idx = s.currentPlayer;
    const neighbor = (idx + 1) % 2;
    s.players[idx]!.handMinors = ["min_lending_cart"];
    s = applyPlacement(s, idx, {
      action: "r_improvement",
      improvement: { kind: "minor", card: "min_lending_cart" },
    }).state;
    expect(s.players[idx]!.resources.wood).toBe(2);
    expect(s.players[idx]!.minors).not.toContain("min_lending_cart");
    expect(s.players[neighbor]!.handMinors).toContain("min_lending_cart");
  });

  it("bonusVp: Schoolmaster counts occupations played after it", () => {
    const s = game();
    const p = s.players[0]!;
    p.occupations = ["occ_lumberjack", "occ_schoolmaster", "occ_carpenter", "occ_mason"];
    const sheet = scorePlayer(s, p);
    const bonus = sheet.categories.find((c) => c.label === "Bonus points")!;
    expect(bonus.points).toBe(2);
  });

  it("harvestFood: Joinery converts 1 wood to 2 food during feeding only", () => {
    const s = game();
    s.phase = "feeding";
    s.toFeed = [0];
    const p = s.players[0]!;
    p.majors.push("joinery");
    p.resources.wood = 3;
    p.resources.food = 2;
    const r = applyFeeding(s, 0, {
      conversions: [{ via: "joinery", good: "wood", count: 1 }],
    });
    expect(r.state.players[0]!.resources.wood).toBe(2);
    expect(r.state.players[0]!.beggingCards).toBe(0);
    // 2 food existing + 2 from joinery - 4 need = 0 left.
    expect(r.state.players[0]!.resources.food).toBe(0);
    // Over the per-harvest limit is rejected.
    expect(() =>
      applyFeeding(s, 0, { conversions: [{ via: "joinery", good: "wood", count: 2 }] }),
    ).toThrow(/at most/);
  });

  it("onHarvest: Forager gains 1 food at harvest", () => {
    let s = game(2, 11);
    s.players[0]!.occupations.push("occ_forager");
    s.players[0]!.resources.food = 10;
    s.players[1]!.resources.food = 10;
    const before = s.players[0]!.resources.food;
    const simple = ["forest", "clay_pit", "reed_bank", "fishing"];
    while (s.phase === "work" && s.round < 5) {
      const free = simple.find(
        (id) => s.actionSpaces.find((a) => a.id === id)!.occupiedBy === null,
      )!;
      s = applyPlacement(s, s.currentPlayer, { action: free } as never).state;
    }
    expect(s.phase).toBe("feeding");
    // Forager fired during the field phase; +1 food (and maybe fishing food).
    expect(s.players[0]!.resources.food).toBeGreaterThanOrEqual(before + 1);
  });

  it("prereq: Carp Pond needs 2 occupations", () => {
    const s = game();
    ensureSpace(s, "r_improvement");
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.handMinors = ["min_carp_pond"];
    p.resources.food = 5;
    expect(() =>
      applyPlacement(s, idx, {
        action: "r_improvement",
        improvement: { kind: "minor", card: "min_carp_pond" },
      }),
    ).toThrow(/occupation/);
    p.occupations = ["occ_lumberjack", "occ_carpenter"];
    const r = applyPlacement(s, idx, {
      action: "r_improvement",
      improvement: { kind: "minor", card: "min_carp_pond" },
    });
    expect(r.state.players[idx]!.minors).toContain("min_carp_pond");
  });

  it("onAction: Midwife grants 2 food after family growth", () => {
    let s = game();
    ensureSpace(s, "r_urgent_family");
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.occupations.push("occ_midwife");
    const food0 = p.resources.food;
    s = applyPlacement(s, idx, { action: "r_urgent_family" }).state;
    expect(s.players[idx]!.resources.food).toBe(food0 + 2);
  });

  it("onRoundStart: Dovecote pays from round 10", () => {
    let s = game(2, 3);
    s.players[0]!.minors.push("min_dovecote");
    s.players[0]!.resources.food = 50;
    s.players[1]!.resources.food = 50;
    const simple = ["forest", "clay_pit", "reed_bank", "fishing", "day_laborer", "grain_seeds"];
    let guard = 0;
    while (s.phase !== "finished" && s.round < 10 && guard++ < 300) {
      if (s.phase === "work") {
        const free = simple.find(
          (id) => s.actionSpaces.find((a) => a.id === id)!.occupiedBy === null,
        )!;
        s = applyPlacement(s, s.currentPlayer, { action: free } as never).state;
      } else {
        s = applyFeeding(s, s.toFeed[0]!, { conversions: [] }).state;
      }
    }
    expect(s.round).toBe(10);
    const dovecoteEvents = s.log.filter((e) => e.text.includes("Dovecote"));
    expect(dovecoteEvents.length).toBe(1);
  });

  it("cook: Stewpot feeds with sheep during feeding", () => {
    const s = game();
    s.phase = "feeding";
    s.toFeed = [0];
    const p = s.players[0]!;
    p.minors.push("min_stewpot");
    p.animals.sheep = 2;
    p.resources.food = 0;
    const r = applyFeeding(s, 0, {
      conversions: [{ via: "min_stewpot", good: "sheep", count: 2 }],
    });
    expect(r.state.players[0]!.animals.sheep).toBe(0);
    expect(r.state.players[0]!.beggingCards).toBe(0);
  });
});
