/**
 * Adversarial rule-conformance tests — DOMAIN: Setup & board composition.
 *
 * Each test asserts the exact correct outcome of a base-game Agricola
 * ("Agricogla") setup rule per RULES.md and, where RULES.md is silent or
 * possibly wrong, the canonical Lookout/Z-Man base-game rules. Tests that fail
 * pin a genuine engine rule violation.
 *
 * Authoritative spec: RULES.md §2 (Setup), §4 (Action spaces & round cards),
 * §11 (Solo). Canonical accumulation amounts verified against the official
 * additional-action-space tables (3p: Grove +2 wood, Hollow +1 clay; 4p: Copse
 * +1 wood, Grove +2 wood, Hollow +2 clay).
 */
import { describe, expect, it } from "vitest";

import { newGame } from "../game";
import { applyFeeding, applyPlacement } from "../apply";
import { MAJOR_IDS, MINOR_IDS, OCCUPATION_IDS } from "../cards";
import { boardSpaces, buildRoundDeck, roundCards, spaceDef, stageOfRound } from "../boards";
import { makeRng } from "../rng";
import { spaceIndex } from "../types";
import { mkGame, playToEnd } from "./harness";

// ---------------------------------------------------------------------------
// Starting farm & family (RULES.md §2)
// ---------------------------------------------------------------------------

describe("setup: starting farm", () => {
  it("places exactly 2 wooden rooms in the left column at indices 5 and 10", () => {
    for (const n of [1, 2, 3, 4]) {
      const g = newGame({ seed: 11, numPlayers: n });
      for (const p of g.players) {
        const roomIdx = p.spaces.flatMap((s, i) => (s.kind === "room" ? [i] : []));
        expect(roomIdx).toEqual([spaceIndex(1, 0), spaceIndex(2, 0)]); // [5, 10]
        expect(roomIdx).toEqual([5, 10]);
        // House starts wooden.
        expect(p.houseMaterial).toBe("wood");
        // Every other space is empty, no fields/stables/crops at setup.
        const nonRoom = p.spaces.filter((s) => s.kind !== "room");
        expect(nonRoom).toHaveLength(13);
        expect(nonRoom.every((s) => s.kind === "empty" && !s.stable && s.crop === null)).toBe(true);
      }
    }
  });

  it("seats exactly 2 family members per player, both adults from round 1", () => {
    for (const n of [1, 2, 3, 4]) {
      const g = newGame({ seed: 5, numPlayers: n });
      for (const p of g.players) {
        expect(p.family).toHaveLength(2);
        // Starting members are not newborns of any real round; bornRound 0 never
        // coincides with a harvest round, so they always cost the full ration.
        expect(p.family.every((m) => m.bornRound === 0 && m.placed === false)).toBe(true);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Starting food (RULES.md §2, §11)
// ---------------------------------------------------------------------------

describe("setup: starting food", () => {
  it("gives the starting player 2 food and every other player 3 (2-4 players)", () => {
    for (const n of [2, 3, 4]) {
      const g = newGame({ seed: 23, numPlayers: n });
      g.players.forEach((p, i) => {
        const expected = i === g.startingPlayer ? 2 : 3;
        expect(p.resources.food).toBe(expected);
      });
      // Exactly one starting-player marker.
      expect(g.players.filter((p) => p.startingPlayerMarker)).toHaveLength(1);
      expect(g.players[g.startingPlayer]!.startingPlayerMarker).toBe(true);
    }
  });

  it("solo player starts with 0 food", () => {
    const g = newGame({ seed: 7, numPlayers: 1 });
    expect(g.players[0]!.resources.food).toBe(0);
    expect(g.players[0]!.startingPlayerMarker).toBe(true);
  });

  it("starts with no resources, crops or animals beyond the food ration", () => {
    const g = newGame({ seed: 9, numPlayers: 3 });
    for (const p of g.players) {
      expect(p.resources.wood).toBe(0);
      expect(p.resources.clay).toBe(0);
      expect(p.resources.reed).toBe(0);
      expect(p.resources.stone).toBe(0);
      expect(p.resources.grain).toBe(0);
      expect(p.resources.vegetable).toBe(0);
      expect(p.animals).toEqual({ sheep: 0, boar: 0, cattle: 0 });
    }
  });
});

// ---------------------------------------------------------------------------
// Card deals (RULES.md §2, §10)
// ---------------------------------------------------------------------------

describe("setup: card deals", () => {
  it("deals 7 occupations + 7 minors to every player with no duplicates across players", () => {
    for (const seed of [1, 2, 3, 7, 42, 99, 1234]) {
      const g = newGame({ seed, numPlayers: 4 });
      for (const p of g.players) {
        expect(p.handOccupations).toHaveLength(7);
        expect(p.handMinors).toHaveLength(7);
        expect(p.occupations).toHaveLength(0);
        expect(p.minors).toHaveLength(0);
      }
      const occ = g.players.flatMap((p) => p.handOccupations);
      const min = g.players.flatMap((p) => p.handMinors);
      expect(new Set(occ).size).toBe(occ.length); // 28 unique occupations
      expect(new Set(min).size).toBe(min.length); // 28 unique minors
    }
  });

  it("lays out exactly the 10 major improvements, all unique", () => {
    const g = newGame({ seed: 7, numPlayers: 2 });
    expect(g.majorsAvailable).toHaveLength(10);
    expect(new Set(g.majorsAvailable).size).toBe(10);
    expect(MAJOR_IDS).toHaveLength(10);
  });

  it("ships the documented deck sizes (51 occupations, 50 minors) with enough to deal 7+7 to 4 players", () => {
    // RULES.md §10 documents 51 occupations and 50 minor improvements; the
    // engine must match its own spec and ship enough unique cards to deal 7 of
    // each to 4 players (>=28) without collisions.
    expect(OCCUPATION_IDS).toHaveLength(51);
    expect(MINOR_IDS).toHaveLength(50);
    expect(OCCUPATION_IDS.length).toBeGreaterThanOrEqual(28);
    expect(MINOR_IDS.length).toBeGreaterThanOrEqual(28);
    expect(new Set(OCCUPATION_IDS).size).toBe(OCCUPATION_IDS.length);
    expect(new Set(MINOR_IDS).size).toBe(MINOR_IDS.length);
  });
});

// ---------------------------------------------------------------------------
// Board space sets per player count (RULES.md §4.1-§4.3)
// ---------------------------------------------------------------------------

describe("setup: board space sets", () => {
  const FIXED = [
    "farm_expansion",
    "meeting_place",
    "grain_seeds",
    "farmland",
    "lessons",
    "day_laborer",
    "forest",
    "clay_pit",
    "reed_bank",
    "fishing",
  ];

  it("1-2 players use only the 10 fixed action spaces", () => {
    for (const n of [1, 2]) {
      const ids = boardSpaces(n).map((d) => d.id);
      expect(ids).toEqual(FIXED);
    }
  });

  it("3 players add grove, hollow, quarry_stall, lessons_b (and nothing else)", () => {
    const ids = boardSpaces(3).map((d) => d.id);
    expect(ids).toEqual([...FIXED, "grove", "hollow", "quarry_stall", "lessons_b"]);
    // No 4-player-only spaces leak in.
    expect(ids).not.toContain("copse");
    expect(ids).not.toContain("resource_market");
    expect(ids).not.toContain("traveling_players");
  });

  it("4 players add copse, grove, hollow, resource_market, traveling_players, lessons_b", () => {
    const ids = boardSpaces(4).map((d) => d.id);
    expect(ids).toEqual([
      ...FIXED,
      "copse",
      "grove",
      "hollow",
      "resource_market",
      "traveling_players",
      "lessons_b",
    ]);
    expect(ids).not.toContain("quarry_stall");
  });

  it("rejects unsupported player counts", () => {
    expect(() => boardSpaces(0)).toThrow();
    expect(() => boardSpaces(5)).toThrow();
    expect(() => newGame({ seed: 1, numPlayers: 0 })).toThrow();
    expect(() => newGame({ seed: 1, numPlayers: 5 })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Accumulation amounts per player count (RULES.md §4.1-§4.3, §11; canonical)
// ---------------------------------------------------------------------------

describe("setup: accumulation amounts", () => {
  function pileOf(state: ReturnType<typeof newGame>, id: string): Record<string, number> {
    const s = state.actionSpaces.find((x) => x.id === id);
    return (s?.pile ?? {}) as Record<string, number>;
  }

  it("Forest accumulates 3 wood (2-4p) but only 2 wood solo", () => {
    expect(pileOf(newGame({ seed: 4, numPlayers: 2 }), "forest").wood).toBe(3);
    expect(pileOf(newGame({ seed: 4, numPlayers: 3 }), "forest").wood).toBe(3);
    expect(pileOf(newGame({ seed: 4, numPlayers: 4 }), "forest").wood).toBe(3);
    expect(pileOf(newGame({ seed: 4, numPlayers: 1 }), "forest").wood).toBe(2);
  });

  it("Hollow accumulates 1 clay at 3 players but 2 clay at 4 players", () => {
    expect(pileOf(newGame({ seed: 8, numPlayers: 3 }), "hollow").clay).toBe(1);
    expect(pileOf(newGame({ seed: 8, numPlayers: 4 }), "hollow").clay).toBe(2);
  });

  it("Grove gives 2 wood and Copse gives 1 wood (4p)", () => {
    const g = newGame({ seed: 8, numPlayers: 4 });
    expect(pileOf(g, "grove").wood).toBe(2);
    expect(pileOf(g, "copse").wood).toBe(1);
    expect(pileOf(g, "traveling_players").food).toBe(1);
  });

  it("fixed (non-accumulating) spaces never grow a pile at round start", () => {
    const g = newGame({ seed: 8, numPlayers: 4 });
    for (const id of ["grain_seeds", "day_laborer", "quarry_stall", "resource_market"]) {
      // quarry_stall isn't on the 4p board; only check the present ones.
      const s = g.actionSpaces.find((x) => x.id === id);
      if (s) expect(s.pile).toEqual({});
    }
    expect(pileOf(g, "grain_seeds")).toEqual({});
    expect(pileOf(g, "day_laborer")).toEqual({});
    expect(pileOf(g, "resource_market")).toEqual({});
  });

  it("standard accumulation spaces start the game with their first round of goods", () => {
    const g = newGame({ seed: 8, numPlayers: 2 });
    expect(pileOf(g, "clay_pit").clay).toBe(1);
    expect(pileOf(g, "reed_bank").reed).toBe(1);
    expect(pileOf(g, "fishing").food).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Round deck composition & reveal order (RULES.md §2, §3, §4.4)
// ---------------------------------------------------------------------------

describe("setup: round deck", () => {
  it("builds a 14-card deck with the canonical per-stage sizes", () => {
    for (const seed of [1, 7, 42, 100]) {
      const deck = buildRoundDeck(makeRng(seed));
      expect(deck).toHaveLength(14);
      // Stages, in deck order, must run 1,1,1,1,2,2,2,3,3,4,4,5,5,6.
      const stages = deck.map((id) => roundCards.find((c) => c.id === id)!.stage);
      expect(stages).toEqual([1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 4, 5, 5, 6]);
      // Every card appears exactly once.
      expect(new Set(deck).size).toBe(14);
    }
  });

  it("there are exactly 14 distinct round cards distributed 4/3/2/2/2/1 across stages", () => {
    expect(roundCards).toHaveLength(14);
    const counts = [1, 2, 3, 4, 5, 6].map(
      (st) => roundCards.filter((c) => c.stage === st).length,
    );
    expect(counts).toEqual([4, 3, 2, 2, 2, 1]);
  });

  it("reveals one card per round and every revealed card belongs to that round's stage", () => {
    // Replay a full 4-player game; on each work phase capture the freshly
    // revealed round card and assert its stage == stageOfRound(round).
    let g = newGame({ seed: 7, numPlayers: 4 });
    for (const p of g.players) p.resources.food = 200;
    const revealedStageByRound = new Map<number, number>();
    let guard = 0;
    let prevRoundCardCount = 0;
    while (g.phase !== "finished" && guard++ < 6000) {
      if (g.phase === "work") {
        const roundCardSpaces = g.actionSpaces.filter((s) =>
          roundCards.some((c) => c.id === s.id),
        );
        // Exactly `round` round-cards should be face up during round `round`.
        expect(roundCardSpaces.length).toBe(g.round);
        if (roundCardSpaces.length > prevRoundCardCount) {
          const newest = roundCardSpaces[roundCardSpaces.length - 1]!;
          const st = spaceDef(newest.id, 4).stage!;
          revealedStageByRound.set(g.round, st);
          prevRoundCardCount = roundCardSpaces.length;
        }
        // Park current worker on a harmless take to advance.
        const SAFE = [
          "grain_seeds",
          "day_laborer",
          "forest",
          "clay_pit",
          "reed_bank",
          "fishing",
          "grove",
          "hollow",
          "copse",
          "traveling_players",
          "resource_market",
          "r_sheep",
          "r_west_quarry",
          "r_vegetable",
          "r_boar",
          "r_east_quarry",
          "r_cattle",
        ];
        const id = SAFE.find((s) => {
          const sp = g.actionSpaces.find((x) => x.id === s);
          return sp && sp.occupiedBy === null;
        });
        if (!id) break;
        g = applyPlacement(g, g.currentPlayer, { action: id } as never).state;
      } else if (g.phase === "feeding") {
        const idx = g.toFeed[0]!;
        g = applyFeeding(g, idx, { conversions: [] }).state;
      }
    }
    for (let r = 1; r <= 14; r++) {
      expect(revealedStageByRound.get(r)).toBe(stageOfRound(r));
    }
  });
});

// ---------------------------------------------------------------------------
// Game length & harvest schedule (RULES.md §1, §7)
// ---------------------------------------------------------------------------

describe("setup: game frame", () => {
  it("starts at round 1 in the work phase", () => {
    const g = mkGame(2, 7);
    expect(g.round).toBe(1);
    expect(g.phase).toBe("work");
    expect(g.currentPlayer).toBe(g.startingPlayer);
  });

  it("runs exactly 14 rounds and finishes after the round-14 harvest", () => {
    const end = playToEnd(mkGame(2, 7));
    expect(end.phase).toBe("finished");
    expect(end.round).toBe(14);
    expect(end.scores).not.toBeNull();
  });
});
