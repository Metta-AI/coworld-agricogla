/** Adversarial rule-conformance tests for occupations & improvements.
 *
 *  Domain: Lessons / Lessons II occupation costs, minor improvement costs and
 *  prerequisites, major improvement purchase (cost paid + removed from board),
 *  the Fireplace -> Cooking Hearth return, passing/traveling minors, and the
 *  major-vs-minor restrictions on the various "play an improvement" spaces.
 *
 *  Each test asserts the CORRECT outcome per the canonical base-game Agricola
 *  rules (see RULES.md and the official Lookout/Z-Man rulebook). A failing test
 *  is a genuine engine bug.
 */
import { describe, expect, it } from "vitest";
import { mkGame, placeFor, ensureSpace } from "./harness";
import { RuleError } from "../apply";
import { GameState } from "../types";

/** Make `idx` the current player and give it one unplaced worker. */
function readyPlayer(state: GameState, idx: number): void {
  state.currentPlayer = idx;
  state.phase = "work";
  const p = state.players[idx]!;
  // ensure exactly one available worker
  p.family = [{ bornRound: 1, placed: false }];
}

describe("Lessons (regular) occupation cost progression", () => {
  it("first occupation is free, each later one costs 1 food", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.handOccupations = ["occ_lumberjack", "occ_clay_digger", "occ_reed_gatherer"];
    p.resources.food = 5;
    readyPlayer(s, idx);

    ensureSpace(s, "lessons");
    s = placeFor(s, idx, { action: "lessons", occupation: "occ_lumberjack" });
    // first occupation: free
    expect(s.players[idx]!.resources.food).toBe(5);
    expect(s.players[idx]!.occupations).toContain("occ_lumberjack");

    readyPlayer(s, idx);
    ensureSpace(s, "lessons");
    s = placeFor(s, idx, { action: "lessons", occupation: "occ_clay_digger" });
    // second occupation: costs 1 food
    expect(s.players[idx]!.resources.food).toBe(4);

    readyPlayer(s, idx);
    ensureSpace(s, "lessons");
    s = placeFor(s, idx, { action: "lessons", occupation: "occ_reed_gatherer" });
    // third occupation: costs 1 food
    expect(s.players[idx]!.resources.food).toBe(3);
  });

  it("rejects playing an occupation when food cannot cover the cost", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    // already played one occupation so the next costs 1 food
    p.occupations = ["occ_lumberjack"];
    p.handOccupations = ["occ_clay_digger"];
    p.resources.food = 0;
    readyPlayer(s, idx);
    ensureSpace(s, "lessons");
    expect(() =>
      placeFor(s, idx, { action: "lessons", occupation: "occ_clay_digger" }),
    ).toThrow(RuleError);
  });
});

describe("Lessons II (lessons_b) occupation cost by player count", () => {
  it("3-player board: every occupation costs 2 food (even the first)", () => {
    let s = mkGame(3, 11);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.handOccupations = ["occ_lumberjack", "occ_clay_digger"];
    p.resources.food = 10;
    p.occupations = [];
    readyPlayer(s, idx);

    ensureSpace(s, "lessons_b");
    s = placeFor(s, idx, { action: "lessons_b", occupation: "occ_lumberjack" });
    // first occupation on Lessons II in a 3p game still costs 2
    expect(s.players[idx]!.resources.food).toBe(8);

    readyPlayer(s, idx);
    ensureSpace(s, "lessons_b");
    s = placeFor(s, idx, { action: "lessons_b", occupation: "occ_clay_digger" });
    expect(s.players[idx]!.resources.food).toBe(6);
  });

  it("4-player board: first two occupations cost 1, then 2", () => {
    let s = mkGame(4, 13);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.handOccupations = [
      "occ_lumberjack",
      "occ_clay_digger",
      "occ_reed_gatherer",
      "occ_quarryman",
    ];
    p.resources.food = 20;
    p.occupations = [];
    readyPlayer(s, idx);

    const costs: number[] = [];
    for (const occ of ["occ_lumberjack", "occ_clay_digger", "occ_reed_gatherer", "occ_quarryman"]) {
      const before = s.players[idx]!.resources.food;
      ensureSpace(s, "lessons_b");
      readyPlayer(s, idx);
      s = placeFor(s, idx, { action: "lessons_b", occupation: occ });
      costs.push(before - s.players[idx]!.resources.food);
    }
    // 1st, 2nd: 1 food; 3rd, 4th: 2 food
    expect(costs).toEqual([1, 1, 2, 2]);
  });
});

describe("Minor improvement prerequisites", () => {
  it("Carp Pond requires 2 occupations before it may be played", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.handMinors = ["min_carp_pond"];
    p.occupations = ["occ_lumberjack"]; // only 1
    p.resources.food = 5;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    expect(() =>
      placeFor(s, idx, {
        action: "r_improvement",
        improvement: { kind: "minor", card: "min_carp_pond" },
      }),
    ).toThrow(RuleError);
  });

  it("Carp Pond plays once 2 occupations are present and pays 1 food", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.handMinors = ["min_carp_pond"];
    p.occupations = ["occ_lumberjack", "occ_clay_digger"];
    p.resources.food = 5;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    s = placeFor(s, idx, {
      action: "r_improvement",
      improvement: { kind: "minor", card: "min_carp_pond" },
    });
    expect(s.players[idx]!.minors).toContain("min_carp_pond");
    expect(s.players[idx]!.resources.food).toBe(4); // 1 food cost
  });

  it("Gabled Roof requires a stone house", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.handMinors = ["min_gabled_house"];
    p.houseMaterial = "clay";
    p.resources.wood = 5;
    p.resources.reed = 5;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    expect(() =>
      placeFor(s, idx, {
        action: "r_improvement",
        improvement: { kind: "minor", card: "min_gabled_house" },
      }),
    ).toThrow(RuleError);

    // now with a stone house it succeeds and pays 1 wood + 1 reed
    s.players[idx]!.houseMaterial = "stone";
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    s = placeFor(s, idx, {
      action: "r_improvement",
      improvement: { kind: "minor", card: "min_gabled_house" },
    });
    expect(s.players[idx]!.minors).toContain("min_gabled_house");
    expect(s.players[idx]!.resources.wood).toBe(4);
    expect(s.players[idx]!.resources.reed).toBe(4);
  });
});

describe("Minor improvement cost is paid from supply", () => {
  it("Paddock costs 2 wood", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.handMinors = ["min_paddock"];
    p.occupations = ["occ_lumberjack"]; // paddock needs 1 occupation
    p.resources.wood = 3;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    s = placeFor(s, idx, {
      action: "r_improvement",
      improvement: { kind: "minor", card: "min_paddock" },
    });
    expect(s.players[idx]!.resources.wood).toBe(1);
    expect(s.players[idx]!.minors).toContain("min_paddock");
  });

  it("rejects a minor improvement the player cannot afford", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.handMinors = ["min_paddock"];
    p.occupations = ["occ_lumberjack"];
    p.resources.wood = 1; // needs 2
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    expect(() =>
      placeFor(s, idx, {
        action: "r_improvement",
        improvement: { kind: "minor", card: "min_paddock" },
      }),
    ).toThrow(RuleError);
  });

  it("rejects a minor not in the player's hand", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.handMinors = []; // empty
    p.resources.wood = 10;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    expect(() =>
      placeFor(s, idx, {
        action: "r_improvement",
        improvement: { kind: "minor", card: "min_paddock" },
      }),
    ).toThrow(RuleError);
  });
});

describe("Major improvement purchase", () => {
  it("buying Fireplace pays 2 clay and removes it from the shared board", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.resources.clay = 5;
    readyPlayer(s, idx);
    expect(s.majorsAvailable).toContain("fireplace2");
    ensureSpace(s, "r_improvement");
    s = placeFor(s, idx, {
      action: "r_improvement",
      improvement: { kind: "major", card: "fireplace2" },
    });
    expect(s.players[idx]!.resources.clay).toBe(3); // 2 clay paid
    expect(s.players[idx]!.majors).toContain("fireplace2");
    expect(s.majorsAvailable).not.toContain("fireplace2"); // removed from board
  });

  it("a major cannot be bought twice (only one copy on the board)", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.resources.clay = 20;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    s = placeFor(s, idx, {
      action: "r_improvement",
      improvement: { kind: "major", card: "fireplace2" },
    });
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    expect(() =>
      placeFor(s, idx, {
        action: "r_improvement",
        improvement: { kind: "major", card: "fireplace2" },
      }),
    ).toThrow(RuleError);
  });

  it("rejects buying a major the player cannot afford", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.resources.clay = 1; // fireplace2 needs 2
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    expect(() =>
      placeFor(s, idx, {
        action: "r_improvement",
        improvement: { kind: "major", card: "fireplace2" },
      }),
    ).toThrow(RuleError);
  });
});

describe("Cooking Hearth via returning a Fireplace", () => {
  it("returns the Fireplace to the board, charges no clay, and is buyable again", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors = ["fireplace2"]; // already owns a Fireplace
    s.majorsAvailable = s.majorsAvailable.filter((m) => m !== "fireplace2");
    p.resources.clay = 0; // no clay - must be free via return
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    s = placeFor(s, idx, {
      action: "r_improvement",
      improvement: { kind: "major", card: "hearth4", returnFireplace: "fireplace2" },
    });
    const pp = s.players[idx]!;
    expect(pp.majors).toContain("hearth4");
    expect(pp.majors).not.toContain("fireplace2"); // fireplace given back
    expect(pp.resources.clay).toBe(0); // no clay paid
    expect(s.majorsAvailable).toContain("fireplace2"); // back on the board, buyable again
    expect(s.majorsAvailable).not.toContain("hearth4"); // hearth taken
  });

  it("rejects returning a Fireplace the player does not own", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors = []; // owns no fireplace
    p.resources.clay = 0;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    expect(() =>
      placeFor(s, idx, {
        action: "r_improvement",
        improvement: { kind: "major", card: "hearth4", returnFireplace: "fireplace2" },
      }),
    ).toThrow(RuleError);
  });

  it("rejects returning a Fireplace the player does not own (owns the other one)", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors = ["fireplace2"]; // owns fireplace2, not fireplace3
    s.majorsAvailable = s.majorsAvailable.filter((m) => m !== "fireplace2");
    p.resources.clay = 0;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    expect(() =>
      placeFor(s, idx, {
        action: "r_improvement",
        improvement: { kind: "major", card: "hearth4", returnFireplace: "fireplace3" },
      }),
    ).toThrow(RuleError);
  });

  it("the Fireplace-return discount only applies to a Cooking Hearth, not other majors", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors = ["fireplace2"];
    s.majorsAvailable = s.majorsAvailable.filter((m) => m !== "fireplace2");
    // Give enough to afford clay_oven outright, so the ONLY reason to reject the
    // returnFireplace form is the "Cooking Hearth only" guard.
    p.resources.clay = 5;
    p.resources.stone = 5;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    // Trying to grab a Clay Oven via the Fireplace-return form must fail.
    expect(() =>
      placeFor(s, idx, {
        action: "r_improvement",
        improvement: { kind: "major", card: "clay_oven", returnFireplace: "fireplace2" },
      }),
    ).toThrow(RuleError);
  });

  it("rejects returning a non-Fireplace major (e.g. the Well) for a Cooking Hearth", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors = ["well"]; // owns Well, but Well is not a Fireplace
    s.majorsAvailable = s.majorsAvailable.filter((m) => m !== "well");
    p.resources.clay = 0;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    expect(() =>
      placeFor(s, idx, {
        action: "r_improvement",
        improvement: { kind: "major", card: "hearth4", returnFireplace: "well" },
      }),
    ).toThrow(RuleError);
  });
});

describe("Passing (traveling) minor improvements", () => {
  it("benefits the player on play, then moves to the LEFT neighbor's hand", () => {
    let s = mkGame(3, 7);
    const idx = s.currentPlayer;
    const left = (idx + 1) % s.numPlayers;
    const p = s.players[idx]!;
    p.handMinors = ["min_lending_cart"]; // gain 2 wood, then pass
    p.resources.wood = 0;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    s = placeFor(s, idx, {
      action: "r_improvement",
      improvement: { kind: "minor", card: "min_lending_cart" },
    });
    // onPlay benefited the player who played it
    expect(s.players[idx]!.resources.wood).toBe(2);
    // card does not stay in the player's played pile
    expect(s.players[idx]!.minors).not.toContain("min_lending_cart");
    // card is handed to the LEFT-hand neighbor (next in seat order)
    expect(s.players[left]!.handMinors).toContain("min_lending_cart");
  });
});

describe("Major-vs-minor restrictions per space", () => {
  it("Meeting Place rejects a MAJOR improvement (minor only)", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.resources.clay = 10;
    readyPlayer(s, idx);
    ensureSpace(s, "meeting_place");
    expect(() =>
      placeFor(s, idx, {
        action: "meeting_place",
        improvement: { kind: "major", card: "fireplace2" },
      }),
    ).toThrow(RuleError);
  });

  it("Wish for Children (r_family_growth) rejects a MAJOR improvement (minor only)", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    // give a free room so family growth itself is legal
    p.spaces[0]!.kind = "room";
    p.family = [{ bornRound: 1, placed: false }]; // 1 member, 3 rooms
    p.resources.clay = 10;
    readyPlayer(s, idx);
    ensureSpace(s, "r_family_growth");
    expect(() =>
      placeFor(s, idx, {
        action: "r_family_growth",
        improvement: { kind: "major", card: "fireplace2" },
      }),
    ).toThrow(RuleError);
  });

  it("r_improvement (Major or Minor) accepts a MAJOR improvement", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.resources.clay = 5;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    s = placeFor(s, idx, {
      action: "r_improvement",
      improvement: { kind: "major", card: "fireplace2" },
    });
    expect(s.players[idx]!.majors).toContain("fireplace2");
  });
});

describe("Clay Oven immediate bake on purchase", () => {
  it("bakes at most 1 grain into 5 food when bought", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.resources.clay = 3;
    p.resources.stone = 1;
    p.resources.grain = 3;
    p.resources.food = 0;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    s = placeFor(s, idx, {
      action: "r_improvement",
      improvement: {
        kind: "major",
        card: "clay_oven",
        bake: [{ card: "clay_oven", grain: 1 }],
      },
    });
    const pp = s.players[idx]!;
    expect(pp.majors).toContain("clay_oven");
    expect(pp.resources.grain).toBe(2); // 1 grain consumed
    expect(pp.resources.food).toBe(5); // 5 food produced
  });

  it("rejects baking more than 1 grain in a single Clay Oven bake action", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.resources.clay = 3;
    p.resources.stone = 1;
    p.resources.grain = 3;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    expect(() =>
      placeFor(s, idx, {
        action: "r_improvement",
        improvement: {
          kind: "major",
          card: "clay_oven",
          bake: [{ card: "clay_oven", grain: 2 }],
        },
      }),
    ).toThrow(RuleError);
  });
});

describe("Stone Oven immediate bake on purchase", () => {
  it("bakes up to 2 grain into 4 food each (2 grain -> 8 food)", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.resources.clay = 1;
    p.resources.stone = 3;
    p.resources.grain = 5;
    p.resources.food = 0;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    s = placeFor(s, idx, {
      action: "r_improvement",
      improvement: {
        kind: "major",
        card: "stone_oven",
        bake: [{ card: "stone_oven", grain: 2 }],
      },
    });
    const pp = s.players[idx]!;
    expect(pp.resources.grain).toBe(3); // 2 consumed
    expect(pp.resources.food).toBe(8); // 4 food each
  });

  it("rejects baking 3 grain in a single Stone Oven bake action (max 2)", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.resources.clay = 1;
    p.resources.stone = 3;
    p.resources.grain = 5;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    expect(() =>
      placeFor(s, idx, {
        action: "r_improvement",
        improvement: {
          kind: "major",
          card: "stone_oven",
          bake: [{ card: "stone_oven", grain: 3 }],
        },
      }),
    ).toThrow(RuleError);
  });
});

describe("Renovation-then-improvement (r_renovate_improve)", () => {
  it("a stone house cannot use the space at all (renovation is mandatory)", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.houseMaterial = "stone";
    p.resources.clay = 10;
    readyPlayer(s, idx);
    ensureSpace(s, "r_renovate_improve");
    // No improvement chosen, but renovation of a stone house is illegal,
    // so the whole action must be rejected.
    expect(() => placeFor(s, idx, { action: "r_renovate_improve" })).toThrow(RuleError);
  });

  it("renovates wood->clay then buys a major in the same action", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.houseMaterial = "wood";
    // 2 rooms by default -> renovation costs 2 clay + 1 reed
    p.resources.clay = 10;
    p.resources.reed = 5;
    readyPlayer(s, idx);
    ensureSpace(s, "r_renovate_improve");
    s = placeFor(s, idx, {
      action: "r_renovate_improve",
      improvement: { kind: "major", card: "fireplace2" },
    });
    const pp = s.players[idx]!;
    expect(pp.houseMaterial).toBe("clay");
    expect(pp.majors).toContain("fireplace2");
    // 2 clay (renovate 2 rooms) + 2 clay (fireplace2) = 4 clay; 1 reed (renovate)
    expect(pp.resources.clay).toBe(6);
    expect(pp.resources.reed).toBe(4);
  });
});

describe("4-player Lessons II counts occupations across both Lessons spaces", () => {
  it("an occupation played at the regular Lessons counts toward the 'first two' at Lessons II", () => {
    let s = mkGame(4, 17);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.handOccupations = ["occ_lumberjack", "occ_clay_digger", "occ_reed_gatherer"];
    p.resources.food = 20;
    p.occupations = [];

    // #1 at regular Lessons: free
    readyPlayer(s, idx);
    ensureSpace(s, "lessons");
    s = placeFor(s, idx, { action: "lessons", occupation: "occ_lumberjack" });
    expect(s.players[idx]!.resources.food).toBe(20);

    // #2 at Lessons II: this is the player's 2nd occupation -> 1 food (within first two)
    readyPlayer(s, idx);
    ensureSpace(s, "lessons_b");
    let before = s.players[idx]!.resources.food;
    s = placeFor(s, idx, { action: "lessons_b", occupation: "occ_clay_digger" });
    expect(before - s.players[idx]!.resources.food).toBe(1);

    // #3 at Lessons II: player's 3rd occupation -> 2 food
    readyPlayer(s, idx);
    ensureSpace(s, "lessons_b");
    before = s.players[idx]!.resources.food;
    s = placeFor(s, idx, { action: "lessons_b", occupation: "occ_reed_gatherer" });
    expect(before - s.players[idx]!.resources.food).toBe(2);
  });
});

describe("Solo passing minor stays with the player (no neighbor)", () => {
  it("a passing minor in a solo game is not handed off and remains played", () => {
    let s = mkGame(1, 7);
    const idx = s.currentPlayer; // 0
    const p = s.players[idx]!;
    p.handMinors = ["min_lending_cart"];
    p.resources.wood = 0;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    s = placeFor(s, idx, {
      action: "r_improvement",
      improvement: { kind: "minor", card: "min_lending_cart" },
    });
    const pp = s.players[idx]!;
    expect(pp.resources.wood).toBe(2); // onPlay benefit
    expect(pp.minors).toContain("min_lending_cart"); // stays, no neighbor to pass to
  });
});

describe("Wish for Children room requirement (rooms > family) is strict", () => {
  it("rejects family growth when rooms equals family size, and does NOT play the minor", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    // 2 starting rooms; make family exactly 2 so rooms == family
    p.family = [
      { bornRound: 1, placed: false },
      { bornRound: 1, placed: true },
    ];
    const roomsBefore = p.spaces.filter((sp) => sp.kind === "room").length;
    expect(roomsBefore).toBe(2);
    p.handMinors = ["min_market_stall"];
    p.resources.grain = 5;
    readyPlayer(s, idx);
    p.family = [
      { bornRound: 1, placed: false },
      { bornRound: 1, placed: true },
    ];
    ensureSpace(s, "r_family_growth");
    expect(() =>
      placeFor(s, idx, {
        action: "r_family_growth",
        improvement: { kind: "minor", card: "min_market_stall" },
      }),
    ).toThrow(RuleError);
  });
});

describe("Renovation enables a same-action stone-house minor", () => {
  it("renovate clay->stone then play Gabled Roof (needs stone) in one action", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.houseMaterial = "clay";
    p.handMinors = ["min_gabled_house"];
    // renovation clay->stone: 2 stone (2 rooms) + 1 reed
    p.resources.stone = 5;
    p.resources.reed = 5;
    p.resources.wood = 5;
    readyPlayer(s, idx);
    ensureSpace(s, "r_renovate_improve");
    s = placeFor(s, idx, {
      action: "r_renovate_improve",
      improvement: { kind: "minor", card: "min_gabled_house" },
    });
    const pp = s.players[idx]!;
    expect(pp.houseMaterial).toBe("stone");
    expect(pp.minors).toContain("min_gabled_house");
  });
});

describe("Crop costs are paid from supply, not from sown fields", () => {
  it("Market Stall (cost 1 grain) cannot be paid using grain sitting on a field", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.handMinors = ["min_market_stall"]; // cost: 1 grain
    p.resources.grain = 0; // no supply grain
    // put a sown grain field on the farm (3 grain on the field)
    p.spaces[2]!.kind = "field";
    p.spaces[2]!.crop = "grain";
    p.spaces[2]!.cropCount = 3;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    expect(() =>
      placeFor(s, idx, {
        action: "r_improvement",
        improvement: { kind: "minor", card: "min_market_stall" },
      }),
    ).toThrow(RuleError);
  });

  it("Market Stall is payable from supply grain and yields 1 veg + 1 food", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.handMinors = ["min_market_stall"];
    p.resources.grain = 1;
    p.resources.vegetable = 0;
    p.resources.food = 0;
    readyPlayer(s, idx);
    ensureSpace(s, "r_improvement");
    s = placeFor(s, idx, {
      action: "r_improvement",
      improvement: { kind: "minor", card: "min_market_stall" },
    });
    const pp = s.players[idx]!;
    expect(pp.resources.grain).toBe(0); // 1 grain paid from supply
    expect(pp.resources.vegetable).toBe(1);
    expect(pp.resources.food).toBe(1);
  });
});

describe("Meeting Place charges the minor's cost and sets starting player", () => {
  it("plays a costed minor and takes the starting player marker", () => {
    let s = mkGame(3, 7);
    // make sure the player acting is not already the starting player
    const idx = (s.startingPlayer + 1) % s.numPlayers;
    const p = s.players[idx]!;
    p.handMinors = ["min_paddock"]; // 2 wood, needs 1 occupation
    p.occupations = ["occ_lumberjack"];
    p.resources.wood = 5;
    readyPlayer(s, idx);
    ensureSpace(s, "meeting_place");
    s = placeFor(s, idx, {
      action: "meeting_place",
      improvement: { kind: "minor", card: "min_paddock" },
    });
    const pp = s.players[idx]!;
    expect(pp.resources.wood).toBe(3); // 2 wood paid
    expect(pp.minors).toContain("min_paddock");
    expect(s.startingPlayer).toBe(idx);
    expect(pp.startingPlayerMarker).toBe(true);
  });
});
