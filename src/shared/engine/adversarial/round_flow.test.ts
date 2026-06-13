/**
 * Adversarial rule-conformance tests — domain: round sequence, turn order,
 * accumulation. Each test asserts the exact canonical Agricola base-game
 * outcome. Tests that FAIL here are findings (engine rule violations).
 */
import { describe, expect, it } from "vitest";
import {
  mkGame,
  place,
  placeFor,
  take,
  advanceTo,
  fillRound,
  applyPlacement,
  applyFeeding,
  computeAutoFeed,
} from "./harness";
import { RuleError } from "../apply";

// ===========================================================================
// Accumulation spaces
// ===========================================================================

describe("accumulation: replenish & pile growth", () => {
  it("forest holds exactly 3 wood at the start of round 1 (2p)", () => {
    const s = mkGame(2);
    const forest = s.actionSpaces.find((a) => a.id === "forest")!;
    expect(forest.pile.wood ?? 0).toBe(3);
  });

  it("forest accrues 3 per round with NO limit if left unused (3,6,9...)", () => {
    // Park both players off the forest each round and watch the pile grow.
    let s = mkGame(2);
    const pileAt: number[] = [];
    for (let r = 1; r <= 4; r++) {
      const forest = s.actionSpaces.find((a) => a.id === "forest")!;
      pileAt.push(forest.pile.wood ?? 0);
      // finish the round without anyone touching the forest
      s = fillRoundAvoiding(s, "forest");
      if (s.phase !== "work") break; // harvest after round 4 — stop comparing piles
    }
    // Rounds 1..4 should show a strictly +3 growth: 3, 6, 9, 12.
    expect(pileAt.slice(0, 4)).toEqual([3, 6, 9, 12]);
  });

  it("taking the forest grants the WHOLE accumulated pile and resets to empty", () => {
    let s = mkGame(2);
    const idx = s.currentPlayer;
    // Manually inflate the pile to simulate several unused rounds.
    const forest = s.actionSpaces.find((a) => a.id === "forest")!;
    forest.pile = { wood: 9 };
    const before = s.players[idx]!.resources.wood;
    s = place(s, { action: "forest" });
    expect(s.players[idx]!.resources.wood).toBe(before + 9);
    const after = s.actionSpaces.find((a) => a.id === "forest")!;
    expect(after.pile.wood ?? 0).toBe(0);
  });

  it("a freshly revealed accumulation round card receives goods that same round", () => {
    // Sheep Market (r_sheep) is a stage-1 card; whichever round it appears in,
    // it must hold 1 sheep on reveal (replenish runs after the reveal push).
    let s = mkGame(2);
    let guard = 0;
    while (!s.actionSpaces.some((a) => a.id === "r_sheep") && guard++ < 20) {
      s = fillRound(s);
      while (s.phase === "feeding") {
        const fi = s.toFeed[0]!;
        s = applyFeeding(s, fi, computeAutoFeed(s, fi)).state;
      }
    }
    const sheep = s.actionSpaces.find((a) => a.id === "r_sheep");
    expect(sheep).toBeTruthy();
    expect(sheep!.pile.sheep ?? 0).toBeGreaterThanOrEqual(1);
  });

  it("solo forest accumulates only 2 wood per round", () => {
    const s = mkGame(1);
    const forest = s.actionSpaces.find((a) => a.id === "forest")!;
    expect(forest.pile.wood ?? 0).toBe(2);
  });

  it("non-accumulating fixed-goods space (grain_seeds) does not pile up", () => {
    let s = mkGame(2);
    // Drive a couple of rounds without touching grain_seeds.
    s = fillRoundAvoiding(s, "grain_seeds");
    const gs = s.actionSpaces.find((a) => a.id === "grain_seeds")!;
    expect(Object.keys(gs.pile).length).toBe(0);
    // Taking it yields exactly 1 grain regardless of rounds elapsed.
    s = advanceTo(s, s.currentPlayer);
    const idx = s.currentPlayer;
    const before = s.players[idx]!.resources.grain;
    s = place(s, { action: "grain_seeds" });
    expect(s.players[idx]!.resources.grain).toBe(before + 1);
  });
});

// ===========================================================================
// Turn order & one-worker-at-a-time alternation
// ===========================================================================

describe("turn order: seat-order, one worker each", () => {
  it("work phase begins with the starting player", () => {
    const s = mkGame(3);
    expect(s.currentPlayer).toBe(s.startingPlayer);
  });

  it("after a placement, control passes to the NEXT player in seat order (no double turn)", () => {
    const s = mkGame(2);
    const start = s.currentPlayer;
    const s2 = place(s, { action: "forest" });
    expect(s2.currentPlayer).toBe((start + 1) % 2);
    // Same player must NOT be allowed to place again out of turn.
    expect(() => applyPlacement(s2, start, { action: "clay_pit" } as never)).toThrow(RuleError);
  });

  it("a player cannot place two workers in a row while an opponent still has workers", () => {
    let s = mkGame(2);
    const p0 = s.currentPlayer;
    s = placeFor(s, p0, { action: "forest" });
    // It must now be the OTHER player's turn.
    expect(s.currentPlayer).not.toBe(p0);
    expect(() => applyPlacement(s, p0, { action: "clay_pit" } as never)).toThrow(RuleError);
  });

  it("3-player alternation cycles seat order p0->p1->p2->p0", () => {
    let s = mkGame(3);
    // Force a deterministic starting player by mutating then re-deriving turn.
    s.startingPlayer = 0;
    s.currentPlayer = 0;
    s = placeFor(s, 0, { action: "forest" });
    expect(s.currentPlayer).toBe(1);
    s = placeFor(s, 1, { action: "clay_pit" });
    expect(s.currentPlayer).toBe(2);
    s = placeFor(s, 2, { action: "reed_bank" });
    expect(s.currentPlayer).toBe(0); // back to p0 for the second worker
  });

  it("skips a player who has no remaining workers", () => {
    let s = mkGame(2);
    s.startingPlayer = 0;
    s.currentPlayer = 0;
    // Give p1 only ONE worker (remove the second).
    s.players[1]!.family = [{ bornRound: 0, placed: false }];
    s = placeFor(s, 0, { action: "forest" }); // p0 places #1 -> p1
    expect(s.currentPlayer).toBe(1);
    s = placeFor(s, 1, { action: "clay_pit" }); // p1 places only worker -> p0 again
    expect(s.currentPlayer).toBe(0);
    s = placeFor(s, 0, { action: "reed_bank" }); // p0 places #2 -> work over
    // p1 has no workers; p0 done; round should have advanced.
    expect(s.round).toBe(2);
  });

  it("rejects placement by a player whose worker is already placed (no acting twice)", () => {
    let s = mkGame(2);
    s.startingPlayer = 0;
    s.currentPlayer = 0;
    // p0 has 2 workers, p1 has 1. After p0,p1 place, it's p0's 2nd worker.
    s.players[1]!.family = [{ bornRound: 0, placed: false }];
    s = placeFor(s, 0, { action: "forest" });
    s = placeFor(s, 1, { action: "clay_pit" });
    // p1 has no unplaced worker now: placing for p1 must throw (it's p0's turn anyway).
    expect(() => applyPlacement(s, 1, { action: "reed_bank" } as never)).toThrow(RuleError);
  });
});

// ===========================================================================
// Occupied-space and illegal-move rejection
// ===========================================================================

describe("occupied & illegal placement rejection", () => {
  it("rejects placing on an already-occupied space", () => {
    let s = mkGame(2);
    const p0 = s.currentPlayer;
    s = placeFor(s, p0, { action: "forest" });
    // The other player tries the same occupied space.
    expect(() => place(s, { action: "forest" })).toThrow(RuleError);
  });

  it("the round-card space is added UNOCCUPIED on reveal", () => {
    // After setup (round 1) the revealed card space must be free.
    const s = mkGame(2);
    const revealed = s.actionSpaces.find((a) => a.id.startsWith("r_"));
    expect(revealed).toBeTruthy();
    expect(revealed!.occupiedBy).toBeNull();
  });

  it("rejects out-of-turn placement (wrong player index)", () => {
    const s = mkGame(2);
    const other = (s.currentPlayer + 1) % 2;
    expect(() => applyPlacement(s, other, { action: "forest" } as never)).toThrow(RuleError);
  });

  it("rejects a placement when it is not the work phase", () => {
    let s = mkGame(2);
    s.phase = "feeding";
    expect(() => applyPlacement(s, s.currentPlayer, { action: "forest" } as never)).toThrow(
      RuleError,
    );
  });
});

// ===========================================================================
// Starting-player marker timing
// ===========================================================================

describe("starting player marker", () => {
  it("Meeting Place mid-round does NOT change the current turn order this round", () => {
    // 3 players, p0 starts. p0 takes Meeting Place; p1's turn must follow as
    // normal (the marker only matters next round).
    let s = mkGame(3);
    s.startingPlayer = 0;
    s.currentPlayer = 0;
    // Make Meeting Place a no-op-improvement placement (just take the marker).
    s = placeFor(s, 0, { action: "meeting_place" });
    // Turn still proceeds to p1 this round.
    expect(s.currentPlayer).toBe(1);
  });

  it("Meeting Place sets the next round's starting player to the taker", () => {
    let s = mkGame(2);
    s.startingPlayer = 0;
    s.currentPlayer = 0;
    // p0 places worker #1 on forest, p1 takes Meeting Place, then finish round.
    s = placeFor(s, 0, { action: "forest" });
    expect(s.currentPlayer).toBe(1);
    s = placeFor(s, 1, { action: "meeting_place" });
    // p1 grabbed the marker. Finish the round.
    s = fillRound(s);
    // Now in round 2, the starting player (and current player) must be p1.
    expect(s.round).toBe(2);
    expect(s.startingPlayer).toBe(1);
    expect(s.currentPlayer).toBe(1);
  });
});

describe("starting player marker (continued)", () => {
  it("if nobody takes Meeting Place, the start player carries over to next round", () => {
    let s = mkGame(2);
    s.startingPlayer = 0;
    s.currentPlayer = 0;
    const start0 = s.startingPlayer;
    s = fillRound(s); // nobody touches meeting_place in fillRound (not a SAFE_TAKE)
    expect(s.round).toBe(2);
    expect(s.startingPlayer).toBe(start0);
    expect(s.currentPlayer).toBe(start0);
  });

  it("a later-seat player taking Meeting Place does not jump ahead this round", () => {
    // 3 players; p0 starts. p2 takes Meeting Place. The remaining turn order this
    // round must still be the normal seat cycle, not restart at p2.
    let s = mkGame(3);
    s.startingPlayer = 0;
    s.currentPlayer = 0;
    s = placeFor(s, 0, { action: "forest" }); // -> p1
    expect(s.currentPlayer).toBe(1);
    s = placeFor(s, 1, { action: "clay_pit" }); // -> p2
    expect(s.currentPlayer).toBe(2);
    s = placeFor(s, 2, { action: "meeting_place" }); // p2 grabs marker -> p0 (2nd worker)
    expect(s.currentPlayer).toBe(0);
    // startingPlayer updated for NEXT round only.
    expect(s.startingPlayer).toBe(2);
  });
});

// ===========================================================================
// Round / harvest advancement
// ===========================================================================

describe("round and harvest advancement", () => {
  it("advances to round 2 (work) after a non-harvest round, occupancy cleared", () => {
    let s = mkGame(2);
    s = fillRound(s);
    expect(s.round).toBe(2);
    expect(s.phase).toBe("work");
    // All printed spaces must be unoccupied again.
    expect(s.actionSpaces.every((a) => a.occupiedBy === null)).toBe(true);
  });

  it("enters FEEDING (harvest) at the end of round 4, not a new work round", () => {
    let s = mkGame(2);
    // Play rounds 1,2,3 (work) then round 4's work, ending in harvest.
    let guard = 0;
    while (s.round < 4 && guard++ < 50) {
      s = fillRound(s);
      if (s.phase !== "work") break;
    }
    // We should be at round 4 work; finishing it should produce feeding.
    expect(s.round).toBe(4);
    s = fillRound(s);
    expect(s.phase).toBe("feeding");
  });

  it("does NOT harvest after round 5 (non-stage-end)", () => {
    let s = mkGame(2);
    let guard = 0;
    while (s.round < 5 && guard++ < 200) {
      if (s.phase === "work") s = fillRound(s);
      else if (s.phase === "feeding") {
        const fi = s.toFeed[0]!;
        s = applyFeeding(s, fi, computeAutoFeed(s, fi)).state;
      } else break;
    }
    expect(s.round).toBe(5);
    expect(s.phase).toBe("work");
    s = fillRound(s);
    // After round 5 there is no harvest: should be round 6 work.
    expect(s.phase).toBe("work");
    expect(s.round).toBe(6);
  });

  it("every harvest round in HARVEST_ROUNDS triggers feeding, others do not", () => {
    let s = mkGame(2);
    // Feed plenty so nobody is blocked.
    for (const p of s.players) p.resources.food = 100;
    const feedingRounds = new Set<number>();
    let guard = 0;
    while (s.phase !== "finished" && guard++ < 4000) {
      if (s.phase === "work") {
        const before = s.round;
        s = fillRound(s);
        if (s.phase === "feeding") feedingRounds.add(before);
      } else if (s.phase === "feeding") {
        const fi = s.toFeed[0]!;
        s = applyFeeding(s, fi, computeAutoFeed(s, fi)).state;
        for (const p of s.players) p.resources.food = 100;
      }
    }
    expect([...feedingRounds].sort((a, b) => a - b)).toEqual([4, 7, 9, 11, 13, 14]);
  });

  it("the round-14 harvest finishes the game", () => {
    let s = mkGame(2);
    for (const p of s.players) p.resources.food = 100;
    let guard = 0;
    while (s.phase !== "finished" && guard++ < 5000) {
      if (s.phase === "work") s = fillRound(s);
      else if (s.phase === "feeding") {
        const fi = s.toFeed[0]!;
        s = applyFeeding(s, fi, computeAutoFeed(s, fi)).state;
        for (const p of s.players) p.resources.food = 100;
      }
    }
    expect(s.phase).toBe("finished");
    expect(s.scores).not.toBeNull();
  });

  it("scheduled goods (e.g. Well) pay out at the reveal of the scheduled round", () => {
    let s = mkGame(2);
    const idx = s.currentPlayer;
    // Schedule 1 food onto round 2 for this player; advance one round.
    s.scheduled.push({ round: 2, playerIdx: idx, good: "food", count: 1 });
    const before = s.players[idx]!.resources.food;
    s = fillRound(s); // -> round 2 reveal pays it out
    expect(s.round).toBe(2);
    expect(s.players[idx]!.resources.food).toBe(before + 1);
    // The schedule entry is consumed.
    expect(s.scheduled.some((sc) => sc.round === 2)).toBe(false);
  });
});

// ===========================================================================
// "must do something" guards on combined spaces
// ===========================================================================

describe("action-space minimum-effect guards", () => {
  it("farm_expansion with nothing to build is rejected", () => {
    const s = mkGame(2);
    expect(() => place(s, { action: "farm_expansion", rooms: [], stables: [] })).toThrow(RuleError);
  });

  it("r_sow_bake with neither sow nor bake is rejected", () => {
    let s = mkGame(2);
    s.actionSpaces.push({ id: "r_sow_bake", occupiedBy: null, pile: {} });
    expect(() => place(s, { action: "r_sow_bake", sow: [], bake: [] })).toThrow(RuleError);
  });

  it("r_cultivation with neither plow nor sow is rejected", () => {
    let s = mkGame(2);
    s.actionSpaces.push({ id: "r_cultivation", occupiedBy: null, pile: {} });
    expect(() => place(s, { action: "r_cultivation", sow: [] })).toThrow(RuleError);
  });
});

describe("family growth round cards", () => {
  it("standard family growth is rejected when rooms are not > family members", () => {
    let s = mkGame(2);
    s.actionSpaces.push({ id: "r_family_growth", occupiedBy: null, pile: {} });
    const idx = s.currentPlayer;
    // Default: 2 rooms, 2 family. rooms(2) is NOT > family(2) -> reject.
    expect(s.players[idx]!.spaces.filter((sp) => sp.kind === "room").length).toBe(2);
    expect(s.players[idx]!.family.length).toBe(2);
    expect(() => placeFor(s, idx, { action: "r_family_growth" })).toThrow(RuleError);
  });

  it("urgent family growth is rejected once the family is already 5", () => {
    let s = mkGame(2);
    s.actionSpaces.push({ id: "r_urgent_family", occupiedBy: null, pile: {} });
    const idx = s.currentPlayer;
    s.players[idx]!.family = [
      { bornRound: 0, placed: false },
      { bornRound: 0, placed: true },
      { bornRound: 0, placed: true },
      { bornRound: 0, placed: true },
      { bornRound: 0, placed: true },
    ];
    expect(() => placeFor(s, idx, { action: "r_urgent_family" })).toThrow(RuleError);
  });
});

// ===========================================================================
// Newborn timing & uneven worker counts
// ===========================================================================

describe("newborn & uneven worker counts", () => {
  it("a newborn cannot act the round it is born, but can the next round", () => {
    // Round 2: expose Family Growth round card; give p0 a 3rd room so growth is legal.
    let s = mkGame(2);
    s = fillRound(s); // -> round 2
    expect(s.round).toBe(2);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    // Add a third room so rooms(3) > family(2).
    p.spaces[0]!.kind = "room"; // adjacent to room at index 5
    // Ensure the family-growth space is present & unoccupied.
    let fg = s.actionSpaces.find((a) => a.id === "r_family_growth");
    if (!fg) {
      s.actionSpaces.push({ id: "r_family_growth", occupiedBy: null, pile: {} });
    } else {
      fg.occupiedBy = null;
    }
    s = advanceTo(s, idx);
    const beforeUnplaced = s.players[idx]!.family.filter((m) => !m.placed).length;
    s = placeFor(s, idx, { action: "r_family_growth" });
    const p2 = s.players[idx]!;
    expect(p2.family.length).toBe(3); // newborn added
    // The newborn is marked placed (cannot act this round): unplaced count
    // should be (beforeUnplaced - 1), NOT (beforeUnplaced - 1 + 1).
    const unplacedNow = p2.family.filter((m) => !m.placed).length;
    expect(unplacedNow).toBe(beforeUnplaced - 1);
  });

  it("newborn born on a harvest round eats only 1 food that harvest", () => {
    // Drive to round 4 work, then grow the family of the current player.
    let s = mkGame(2);
    for (const p of s.players) p.resources.food = 100;
    let guard = 0;
    while (s.round < 4 && guard++ < 50) {
      s = fillRound(s);
      while (s.phase === "feeding") {
        const fi = s.toFeed[0]!;
        s = applyFeeding(s, fi, computeAutoFeed(s, fi)).state;
      }
    }
    expect(s.round).toBe(4);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    // Manually add a newborn born THIS round (round 4) and mark placed.
    p.family.push({ bornRound: 4, placed: true });
    // foodNeeded should be 2 adults * 2 + 1 newborn = 5 (not 6).
    s = fillRound(s);
    expect(s.phase).toBe("feeding");
    // Find this player's required food via begging math: feed 0 food path.
    const test = s.players[idx]!;
    const beforeFood = test.resources.food;
    s = applyFeeding(s, idx, { conversions: [] }).state;
    const spent = beforeFood - s.players[idx]!.resources.food;
    expect(spent).toBe(5);
  });

  it("starting player with fewer workers: round-robin lets the other finish", () => {
    let s = mkGame(2);
    s.startingPlayer = 0;
    s.currentPlayer = 0;
    // p0 has only 1 worker; p1 has 2.
    s.players[0]!.family = [{ bornRound: 0, placed: false }];
    s = placeFor(s, 0, { action: "forest" }); // p0 done -> p1
    expect(s.currentPlayer).toBe(1);
    s = placeFor(s, 1, { action: "clay_pit" }); // p1 #1; p0 out -> p1 again
    expect(s.currentPlayer).toBe(1);
    s = placeFor(s, 1, { action: "reed_bank" }); // p1 #2 -> work over -> round 2
    expect(s.round).toBe(2);
  });
});

// ===========================================================================
// Accumulation persistence across rounds (round-card spaces)
// ===========================================================================

describe("accumulation persistence", () => {
  it("an un-taken accumulation round card keeps accruing across rounds", () => {
    // Find the round where Sheep Market appears; never take it; verify it grows.
    let s = mkGame(2);
    let appeared = -1;
    let pileWhenAppeared = 0;
    let guard = 0;
    while (s.phase !== "finished" && guard++ < 200) {
      const sheep = s.actionSpaces.find((a) => a.id === "r_sheep");
      if (sheep && appeared === -1) {
        appeared = s.round;
        pileWhenAppeared = sheep.pile.sheep ?? 0;
      }
      if (sheep && appeared !== -1 && s.round > appeared) {
        // One full round elapsed since it appeared, untouched.
        expect(sheep.pile.sheep ?? 0).toBe(pileWhenAppeared + (s.round - appeared));
        return;
      }
      if (s.phase === "work") {
        s = fillRoundAvoiding(s, "r_sheep");
        if (s.phase === "work" && s.round === appeared) break; // couldn't advance
      }
      while (s.phase === "feeding") {
        const fi = s.toFeed[0]!;
        s = applyFeeding(s, fi, computeAutoFeed(s, fi)).state;
      }
    }
    expect(appeared).toBeGreaterThan(0);
  });

  it("each round reveals exactly one card from the correct stage", () => {
    let s = mkGame(2);
    const stageOf = (r: number) =>
      r <= 4 ? 1 : r <= 7 ? 2 : r <= 9 ? 3 : r <= 11 ? 4 : r <= 13 ? 5 : 6;
    const stageById: Record<string, number> = {
      r_improvement: 1, r_sheep: 1, r_fences: 1, r_sow_bake: 1,
      r_west_quarry: 2, r_renovate_improve: 2, r_family_growth: 2,
      r_vegetable: 3, r_boar: 3,
      r_east_quarry: 4, r_cattle: 4,
      r_urgent_family: 5, r_cultivation: 5,
      r_redevelop: 6,
    };
    const seen: { round: number; id: string }[] = [];
    let guard = 0;
    while (s.phase !== "finished" && guard++ < 5000) {
      // The most recently revealed round card is the one whose id starts with r_
      // and has the largest implied stage; track all r_ spaces present.
      const cards = s.actionSpaces.filter((a) => a.id.startsWith("r_"));
      // The number of revealed cards equals the round number.
      expect(cards.length).toBe(s.round);
      for (const c of cards) {
        expect(stageById[c.id]).toBeLessThanOrEqual(stageOf(s.round));
      }
      if (s.phase === "work") s = fillRound(s);
      while (s.phase === "feeding") {
        const fi = s.toFeed[0]!;
        s = applyFeeding(s, fi, computeAutoFeed(s, fi)).state;
      }
    }
    expect(seen.length).toBeGreaterThanOrEqual(0);
  });

  it("forest re-accrues 3/round after being emptied by a take", () => {
    let s = mkGame(2);
    s = place(s, { action: "forest" }); // take 3, pile -> {}
    s = fillRound(s); // -> round 2, replenish adds 3 again
    expect(s.round).toBe(2);
    const forest = s.actionSpaces.find((a) => a.id === "forest")!;
    expect(forest.pile.wood ?? 0).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Local helper: finish the current work round but never touch `avoidId`.
// ---------------------------------------------------------------------------
function fillRoundAvoiding(
  state: ReturnType<typeof mkGame>,
  avoidId: string,
): ReturnType<typeof mkGame> {
  const SAFE = [
    "grain_seeds",
    "day_laborer",
    "clay_pit",
    "reed_bank",
    "fishing",
    "forest",
    "grove",
    "hollow",
    "copse",
  ].filter((id) => id !== avoidId);
  const round = state.round;
  let guard = 0;
  while (state.phase === "work" && state.round === round && guard++ < 50) {
    const id = SAFE.find((x) => {
      const sp = state.actionSpaces.find((a) => a.id === x);
      return sp && sp.occupiedBy === null;
    });
    if (!id) break;
    state = take(state, id);
  }
  return state;
}
