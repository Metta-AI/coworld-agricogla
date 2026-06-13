import { describe, expect, it } from "vitest";
import { mkGame, ensureSpace } from "./harness";
import { applyPlacement, applyFeeding, RuleError } from "../apply";
import { cardById } from "../cards";
import { GameState, PlayerState } from "../types";

/**
 * Adversarial conformance tests for the card-hook engine & scheduled goods.
 * Domain: onGain bonuses (stacking + scoping), onAction triggers, onRoundStart,
 * onHarvest engines, scheduled goods (Well/Carp Pond/etc.), capacity cards,
 * bonusVp formulas.
 *
 * Where possible the tests drive the REAL engine path (applyPlacement /
 * applyFeeding / round advance). Pure scoring formulas (bonusVp) and per-call
 * hooks are exercised by the exact hook the engine invokes.
 */

function give(player: PlayerState, cardId: string, pile: "occupations" | "minors" | "majors") {
  player[pile].push(cardId);
}

/** Drive the work phase of the current round to completion using safe takes,
 *  so the round advances (firing startRound -> scheduled goods + onRoundStart). */
function endRound(state: GameState): GameState {
  const round = state.round;
  const safe = ["forest", "clay_pit", "reed_bank", "fishing", "grain_seeds", "day_laborer", "grove", "hollow", "copse"];
  let guard = 0;
  while (state.phase === "work" && state.round === round && guard++ < 50) {
    const free = state.actionSpaces.find((a) => a.occupiedBy === null && safe.includes(a.id));
    if (!free) break;
    state = applyPlacement(state, state.currentPlayer, { action: free.id } as never).state;
  }
  return state;
}

// ---------------------------------------------------------------------------
// onGain: resource bonuses stack and are scoped to the right good/space.
// ---------------------------------------------------------------------------
describe("onGain resource bonuses (stacking + scoping)", () => {
  it("Lumberjack + Handcart both add 1 wood when taking wood from the Forest", () => {
    const s = mkGame(2, 11);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    give(p, "occ_lumberjack", "occupations");
    give(p, "min_handcart", "minors");
    const forest = s.actionSpaces.find((a) => a.id === "forest")!;
    forest.pile = { wood: 3 };
    const before = p.resources.wood;
    const ns = applyPlacement(s, idx, { action: "forest" } as never).state;
    expect(ns.players[idx]!.resources.wood).toBe(before + 5); // 3 + 1 + 1
  });

  it("a wood bonus (Lumberjack) does NOT fire when taking clay", () => {
    const s = mkGame(2, 12);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    give(p, "occ_lumberjack", "occupations");
    const clay = s.actionSpaces.find((a) => a.id === "clay_pit")!;
    clay.pile = { clay: 1 };
    const beforeWood = p.resources.wood;
    const ns = applyPlacement(s, idx, { action: "clay_pit" } as never).state;
    expect(ns.players[idx]!.resources.clay).toBe(p.resources.clay + 1);
    expect(ns.players[idx]!.resources.wood).toBe(beforeWood);
  });

  it("Angler (+2 food on Fishing) is scoped to Fishing, not other food spaces", () => {
    const s = mkGame(2, 14);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    give(p, "occ_angler", "occupations");
    // Day Laborer gives 2 food but is NOT Fishing -> Angler must not fire.
    const food0 = p.resources.food;
    const ns = applyPlacement(s, idx, { action: "day_laborer" } as never).state;
    expect(ns.players[idx]!.resources.food).toBe(food0 + 2); // just the 2 base, no +2
  });

  it("Shepherd's Friend + Shepherd's Crook both add a sheep (animal onGain stacks)", () => {
    const s = mkGame(2, 13);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    give(p, "occ_shepherds_friend", "occupations");
    give(p, "min_shepherds_crook", "minors");
    // Ensure enough capacity so nothing overflows: house(1)+paddock(3)+shepherd(2)=6.
    give(p, "min_paddock", "minors");
    give(p, "occ_shepherd", "occupations");
    ensureSpace(s, "r_sheep", { sheep: 2 });
    const ns = applyPlacement(s, idx, { action: "r_sheep" } as never).state;
    expect(ns.players[idx]!.animals.sheep).toBe(4); // 2 + 1 + 1
  });
});

// ---------------------------------------------------------------------------
// Scheduled goods: correct count, correct rounds, paid exactly once.
// ---------------------------------------------------------------------------
describe("scheduled goods land at the right rounds and only that many", () => {
  it("Well schedules exactly 5 food at rounds r+1..r+5", () => {
    const s = mkGame(2, 21);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    s.scheduled = [];
    cardById("well").onPlay!({ state: s, player: p, emit: () => {} });
    const sched = s.scheduled.filter((x) => x.playerIdx === idx);
    expect(sched).toHaveLength(5);
    const rounds = sched.map((x) => x.round).sort((a, b) => a - b);
    expect(rounds).toEqual([2, 3, 4, 5, 6]);
    expect(sched.every((x) => x.good === "food" && x.count === 1)).toBe(true);
  });

  it("scheduled food pays out exactly once at the matching round reveal", () => {
    const s = mkGame(2, 22);
    const idx = s.currentPlayer;
    const food0 = s.players[idx]!.resources.food;
    s.scheduled = [{ round: 2, playerIdx: idx, good: "food", count: 1 }];
    const st = endRound(s);
    expect(st.round).toBe(2);
    expect(st.players[idx]!.resources.food).toBe(food0 + 1);
    expect(st.scheduled.filter((x) => x.round === 2)).toHaveLength(0);
  });

  it("Carp Pond=4 food, Seed Stock=2 grain, Reed Pond=3 reed scheduled", () => {
    const s = mkGame(2, 23);
    const p = s.players[s.currentPlayer]!;
    s.scheduled = [];
    cardById("min_carp_pond").onPlay!({ state: s, player: p, emit: () => {} });
    expect(s.scheduled.filter((x) => x.good === "food")).toHaveLength(4);
    s.scheduled = [];
    cardById("min_seed_stock").onPlay!({ state: s, player: p, emit: () => {} });
    expect(s.scheduled.filter((x) => x.good === "grain")).toHaveLength(2);
    s.scheduled = [];
    cardById("min_reed_pond").onPlay!({ state: s, player: p, emit: () => {} });
    expect(s.scheduled.filter((x) => x.good === "reed")).toHaveLength(3);
  });

  it("Well played at round 12 schedules only 3 food (clamped to round 14, not past)", () => {
    const s = mkGame(2, 24);
    const p = s.players[s.currentPlayer]!;
    s.round = 12;
    s.scheduled = [];
    cardById("well").onPlay!({ state: s, player: p, emit: () => {} });
    // rounds 13, 14 only (15+ clamped away) -> 2 entries.
    const rounds = s.scheduled.map((x) => x.round).sort((a, b) => a - b);
    expect(rounds).toEqual([13, 14]);
  });
});

// ---------------------------------------------------------------------------
// onRoundStart timing.
// ---------------------------------------------------------------------------
describe("onRoundStart timing (Dovecote >=10, Rain Barrel even >=8)", () => {
  it("Dovecote: 1 food at round 10, none at round 9", () => {
    const dove = cardById("min_dovecote");
    const mk = () => ({ resources: { food: 0 }, name: "x" }) as unknown as PlayerState;
    let p = mk();
    dove.onRoundStart!({ state: { round: 9 } as GameState, player: p, emit: () => {} }, 9);
    expect(p.resources.food).toBe(0);
    p = mk();
    dove.onRoundStart!({ state: { round: 10 } as GameState, player: p, emit: () => {} }, 10);
    expect(p.resources.food).toBe(1);
  });

  it("Rain Barrel: food on even rounds >=8 (8 yes, 9 no, 6 no)", () => {
    const rb = cardById("min_rain_barrel");
    const mk = () => ({ resources: { food: 0 }, name: "x" }) as unknown as PlayerState;
    let p = mk();
    rb.onRoundStart!({ state: {} as GameState, player: p, emit: () => {} }, 8);
    expect(p.resources.food).toBe(1);
    p = mk();
    rb.onRoundStart!({ state: {} as GameState, player: p, emit: () => {} }, 9);
    expect(p.resources.food).toBe(0);
    p = mk();
    rb.onRoundStart!({ state: {} as GameState, player: p, emit: () => {} }, 6);
    expect(p.resources.food).toBe(0);
  });

  it("Dovecote fires through the real round-advance engine at round 10", () => {
    const s = mkGame(2, 25);
    const idx = s.currentPlayer;
    give(s.players[idx]!, "min_dovecote", "minors");
    // Fast-forward to start of round 10 via repeated safe-take rounds + auto-feed.
    let st = s;
    let guard = 0;
    while (st.phase !== "finished" && st.round < 10 && guard++ < 300) {
      if (st.phase === "work") st = endRound(st);
      else if (st.phase === "feeding") {
        const fi = st.toFeed[0]!;
        st.players[fi]!.resources.food += 50; // never beg
        st = applyFeeding(st, fi, { conversions: [] }).state;
      }
    }
    expect(st.round).toBeGreaterThanOrEqual(10);
    // The Dovecote should have credited food at the round-10 reveal; check the log.
    const credited = st.log.some((e) => e.type === "card" && e.text.includes("Dovecote"));
    expect(credited).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// onHarvest engines: per-N arithmetic.
// ---------------------------------------------------------------------------
describe("onHarvest engines (per-N formulas)", () => {
  function harvestFood(cardId: string, animals: Partial<Record<"sheep" | "boar" | "cattle", number>>, spacesSown = 0): number {
    const p = {
      resources: { food: 0 },
      animals: { sheep: 0, boar: 0, cattle: 0, ...animals },
      spaces: Array.from({ length: spacesSown }, () => ({ kind: "field", crop: "grain", cropCount: 2 })),
      name: "x",
    } as unknown as PlayerState;
    cardById(cardId).onHarvest!({ state: {} as GameState, player: p, emit: () => {} });
    return p.resources.food;
  }

  it("Milkman = floor(cattle/2)", () => {
    expect(harvestFood("occ_milkman", { cattle: 5 })).toBe(2);
    expect(harvestFood("occ_milkman", { cattle: 1 })).toBe(0);
    expect(harvestFood("occ_milkman", { cattle: 6 })).toBe(3);
  });

  it("Cheesemaker = floor(sheep/3), Swine Keeper = floor(boar/3)", () => {
    expect(harvestFood("occ_cheesemaker", { sheep: 7 })).toBe(2);
    expect(harvestFood("occ_swine_keeper", { boar: 8 })).toBe(2);
  });

  it("Gleaner = floor(sownFields/2)", () => {
    expect(harvestFood("occ_gleaner", {}, 5)).toBe(2);
    expect(harvestFood("occ_gleaner", {}, 1)).toBe(0);
  });

  it("Forager = exactly 1", () => {
    expect(harvestFood("occ_forager", {})).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// harvestUsed counter resets each harvest (Joinery wood->food, max 1/harvest).
// ---------------------------------------------------------------------------
describe("harvestFood conversion respects per-harvest cap and resets", () => {
  it("Joinery converts at most 1 wood per harvest, not 2", () => {
    const s = mkGame(2, 51);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    give(p, "joinery", "majors");
    p.resources.wood = 10;
    s.phase = "feeding";
    s.toFeed = [idx];
    // Try to convert 2 wood in one feeding -> must throw (cap is 1).
    expect(() =>
      applyFeeding(s, idx, { conversions: [{ via: "joinery", good: "wood", count: 2 }] }),
    ).toThrow(RuleError);
  });

  it("Joinery can convert 1 wood again at the NEXT harvest (counter resets)", () => {
    let s = mkGame(2, 52);
    const idx = s.currentPlayer;
    give(s.players[idx]!, "joinery", "majors");
    s.players[idx]!.resources.wood = 10;
    s.players[idx]!.resources.food = 50; // never beg
    s.players[1 - idx]!.resources.food = 50;
    // First harvest (round 4): convert 1 wood.
    let guard = 0;
    while (s.phase !== "finished" && !(s.phase === "feeding" && s.round === 4) && guard++ < 200) {
      if (s.phase === "work") s = endRound(s);
      else {
        const fi = s.toFeed[0]!;
        s = applyFeeding(s, fi, { conversions: [] }).state;
      }
    }
    expect(s.phase).toBe("feeding");
    expect(s.round).toBe(4);
    // Feeding 2 adult members costs 4 food; converting 1 wood yields +2 food.
    const FEED = 4;
    const before = s.players[idx]!.resources.food;
    const wood0 = s.players[idx]!.resources.wood;
    s = applyFeeding(s, idx, { conversions: [{ via: "joinery", good: "wood", count: 1 }] }).state;
    expect(s.players[idx]!.resources.food).toBe(before + 2 - FEED);
    expect(s.players[idx]!.resources.wood).toBe(wood0 - 1);
    // Feed the other player to close harvest 1.
    if (s.toFeed.length) s = applyFeeding(s, s.toFeed[0]!, { conversions: [] }).state;
    // Advance to harvest 2 (round 7) and convert again -- only possible if the
    // per-harvest counter reset; otherwise the conversion would throw.
    guard = 0;
    while (s.phase !== "finished" && !(s.phase === "feeding" && s.round === 7) && guard++ < 200) {
      if (s.phase === "work") s = endRound(s);
      else {
        const fi = s.toFeed[0]!;
        s = applyFeeding(s, fi, { conversions: [] }).state;
      }
    }
    expect(s.round).toBe(7);
    const before2 = s.players[idx]!.resources.food;
    s = applyFeeding(s, idx, { conversions: [{ via: "joinery", good: "wood", count: 1 }] }).state;
    expect(s.players[idx]!.resources.food).toBe(before2 + 2 - FEED);
  });
});

// ---------------------------------------------------------------------------
// bonusVp formulas.
// ---------------------------------------------------------------------------
describe("bonusVp formulas", () => {
  it("Schoolmaster = occupations played after it", () => {
    const sm = cardById("occ_schoolmaster");
    expect(sm.bonusVp!({ occupations: ["a", "occ_schoolmaster", "b", "c"] } as unknown as PlayerState, {} as GameState)).toBe(2);
    expect(sm.bonusVp!({ occupations: ["occ_schoolmaster"] } as unknown as PlayerState, {} as GameState)).toBe(0);
  });

  it("Village Elder = floor((minors+majors)/2)", () => {
    const elder = cardById("occ_elder");
    expect(elder.bonusVp!({ minors: ["a", "b", "c"], majors: ["d", "e"] } as unknown as PlayerState, {} as GameState)).toBe(2);
  });

  it("Toy Chest = family members beyond first 3", () => {
    const tc = cardById("min_toy_chest");
    expect(tc.bonusVp!({ family: [1, 2, 3, 4, 5] } as unknown as PlayerState, {} as GameState)).toBe(2);
    expect(tc.bonusVp!({ family: [1, 2] } as unknown as PlayerState, {} as GameState)).toBe(0);
  });

  it("Patriarch = 2 only at exactly 5 family members", () => {
    const pat = cardById("occ_patriarch");
    expect(pat.bonusVp!({ family: [1, 2, 3, 4] } as unknown as PlayerState, {} as GameState)).toBe(0);
    expect(pat.bonusVp!({ family: [1, 2, 3, 4, 5] } as unknown as PlayerState, {} as GameState)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// onAction triggers should reflect whether the sub-action was performed.
// ---------------------------------------------------------------------------
describe("onAction triggers", () => {
  it("Compost Carter ('after each plow action') gives no food when r_cultivation only sows", () => {
    const s = mkGame(2, 31);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    give(p, "occ_compost_carter", "occupations");
    p.spaces[3] = { kind: "field", stable: false, crop: null, cropCount: 0 };
    p.resources.grain = 1;
    ensureSpace(s, "r_cultivation");
    const food0 = p.resources.food;
    const ns = applyPlacement(s, idx, { action: "r_cultivation", sow: [{ space: 3, crop: "grain" }] } as never).state;
    expect(ns.players[idx]!.resources.food).toBe(food0);
  });

  it("Fence Hand ('after each fences action') gives no food when r_redevelop builds no fences", () => {
    const s = mkGame(2, 36);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    give(p, "occ_fence_hand", "occupations");
    p.resources.clay = 5;
    p.resources.reed = 5;
    ensureSpace(s, "r_redevelop");
    const food0 = p.resources.food;
    // Farm Redevelopment: renovate only, build no fences.
    const ns = applyPlacement(s, idx, { action: "r_redevelop", edges: [] } as never).state;
    expect(ns.players[idx]!.houseMaterial).toBe("clay");
    expect(ns.players[idx]!.resources.food).toBe(food0);
  });

  it("Seed Merchant ('whenever you sow') gives no food when r_sow_bake only bakes", () => {
    const s = mkGame(2, 37);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    give(p, "occ_seed_merchant", "occupations");
    give(p, "fireplace2", "majors");
    p.resources.grain = 2;
    ensureSpace(s, "r_sow_bake");
    const food0 = p.resources.food;
    // Bake only (no sow).
    const ns = applyPlacement(s, idx, { action: "r_sow_bake", sow: [], bake: [{ card: "fireplace2", grain: 1 }] } as never).state;
    // +2 from baking 1 grain; Seed Merchant must NOT add its +1 (no sow happened).
    expect(ns.players[idx]!.resources.food).toBe(food0 + 2);
  });

  it("Compost Carter DOES give 1 food when farmland is actually plowed", () => {
    const s = mkGame(2, 33);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    give(p, "occ_compost_carter", "occupations");
    ensureSpace(s, "farmland");
    const food0 = p.resources.food;
    const ns = applyPlacement(s, idx, { action: "farmland", spaces: [6] } as never).state;
    expect(ns.players[idx]!.resources.food).toBe(food0 + 1);
  });

  it("Stable Boy gives exactly 1 reed after a renovate action", () => {
    const s = mkGame(2, 32);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    give(p, "occ_stable_boy", "occupations");
    p.resources.clay = 5;
    p.resources.reed = 5;
    ensureSpace(s, "r_renovate_improve");
    const reed0 = p.resources.reed;
    const ns = applyPlacement(s, idx, { action: "r_renovate_improve" } as never).state;
    expect(ns.players[idx]!.resources.reed).toBe(reed0 - 1 + 1); // -1 renovation reed, +1 Stable Boy
    expect(ns.players[idx]!.houseMaterial).toBe("clay");
  });

  it("Midwife gives 2 food after a family growth action", () => {
    const s = mkGame(2, 34);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    give(p, "occ_midwife", "occupations");
    // Need rooms > family for standard growth: start has 2 rooms, 2 family -> add a room.
    p.spaces[0] = { kind: "room", stable: false, crop: null, cropCount: 0 };
    ensureSpace(s, "r_family_growth");
    const food0 = p.resources.food;
    const ns = applyPlacement(s, idx, { action: "r_family_growth" } as never).state;
    expect(ns.players[idx]!.family.length).toBe(3);
    expect(ns.players[idx]!.resources.food).toBe(food0 + 2);
  });
});

// ---------------------------------------------------------------------------
// Capacity cards & overflow handling.
// ---------------------------------------------------------------------------
describe("capacity cards affect retention", () => {
  it("with only the house pet (1), 4 sheep gained keeps 1, releases 3 (no cook card)", () => {
    const s = mkGame(2, 41);
    const idx = s.currentPlayer;
    ensureSpace(s, "r_sheep", { sheep: 4 });
    const ns = applyPlacement(s, idx, { action: "r_sheep" } as never).state;
    expect(ns.players[idx]!.animals.sheep).toBe(1);
  });

  it("Stablemaster adds 1 any-type slot: house(1)+stablemaster(1)=2 sheep kept", () => {
    const s = mkGame(2, 42);
    const idx = s.currentPlayer;
    give(s.players[idx]!, "occ_stablemaster", "occupations");
    ensureSpace(s, "r_sheep", { sheep: 4 });
    const ns = applyPlacement(s, idx, { action: "r_sheep" } as never).state;
    expect(ns.players[idx]!.animals.sheep).toBe(2);
  });
});
