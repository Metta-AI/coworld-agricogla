/** Adversarial rule-conformance tests: Baking & cooking rates and limits.
 *
 *  Canonical Agricola base-game rules (RULES.md §5.4, §6, card list lines
 *  262-271). Each test asserts the exact correct outcome of one baking/cooking
 *  rule or edge case and drives the real engine path.
 */
import { describe, expect, it } from "vitest";
import { applyFeeding, applyPlacement, ensureSpace, mkGame } from "./harness";
import { foodNeeded, RuleError } from "../apply";
import { cardById } from "../cards";

/** Put player `idx` on turn in the current round, parking everyone else on a
 *  safe space, then return the state. Bake/sow live on `r_sow_bake`. */
function toTurn(state: ReturnType<typeof mkGame>, idx: number): ReturnType<typeof mkGame> {
  let s = state;
  let guard = 0;
  while (s.currentPlayer !== idx && guard++ < 50) {
    s = applyPlacement(s, s.currentPlayer, { action: "fishing" } as never).state;
  }
  return s;
}

/** Drive a Bake action on the r_sow_bake round card for player `idx`. */
function bakeOn(state: ReturnType<typeof mkGame>, idx: number, bake: { card: string; grain: number }[]) {
  ensureSpace(state, "r_sow_bake");
  const s = toTurn(state, idx);
  return applyPlacement(s, idx, { action: "r_sow_bake", sow: [], bake } as never).state;
}

describe("oven grain caps", () => {
  it("Clay Oven bakes at most 1 grain per action (2 grain rejected)", () => {
    const s = mkGame(2);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors.push("clay_oven");
    p.resources.grain = 5;
    expect(() => bakeOn(s, idx, [{ card: "clay_oven", grain: 2 }])).toThrow(RuleError);
  });

  it("Stone Oven bakes at most 2 grain per action (3 grain rejected)", () => {
    const s = mkGame(2);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors.push("stone_oven");
    p.resources.grain = 5;
    expect(() => bakeOn(s, idx, [{ card: "stone_oven", grain: 3 }])).toThrow(RuleError);
  });
});

describe("oven food arithmetic", () => {
  it("Clay Oven: 1 grain -> 5 food", () => {
    const s = mkGame(2);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors.push("clay_oven");
    p.resources.grain = 3;
    p.resources.food = 0;
    const out = bakeOn(s, idx, [{ card: "clay_oven", grain: 1 }]);
    const a = out.players[idx]!;
    expect(a.resources.food).toBe(5);
    expect(a.resources.grain).toBe(2);
  });

  it("Stone Oven: 2 grain -> 8 food (4 each)", () => {
    const s = mkGame(2);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors.push("stone_oven");
    p.resources.grain = 4;
    p.resources.food = 0;
    const out = bakeOn(s, idx, [{ card: "stone_oven", grain: 2 }]);
    const a = out.players[idx]!;
    expect(a.resources.food).toBe(8);
    expect(a.resources.grain).toBe(2);
  });
});

describe("fireplace / hearth bake any number of grain", () => {
  it("Fireplace bakes many grain at 2 food each (5 grain -> 10 food)", () => {
    const s = mkGame(2);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors.push("fireplace2");
    p.resources.grain = 5;
    p.resources.food = 0;
    const out = bakeOn(s, idx, [{ card: "fireplace2", grain: 5 }]);
    const a = out.players[idx]!;
    expect(a.resources.food).toBe(10);
    expect(a.resources.grain).toBe(0);
  });

  it("Cooking Hearth bakes at 3 food each (4 grain -> 12 food)", () => {
    const s = mkGame(2);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors.push("hearth4");
    p.resources.grain = 4;
    p.resources.food = 0;
    const out = bakeOn(s, idx, [{ card: "hearth4", grain: 4 }]);
    expect(out.players[idx]!.resources.food).toBe(12);
  });
});

describe("combining and reuse", () => {
  it("combines Fireplace + Clay Oven in one action, each within its own cap", () => {
    const s = mkGame(2);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors.push("fireplace2", "clay_oven");
    p.resources.grain = 4;
    p.resources.food = 0;
    // Fireplace: 2 grain -> 4 food; Clay Oven: 1 grain -> 5 food. Total 9 food, 3 grain spent.
    const out = bakeOn(s, idx, [
      { card: "fireplace2", grain: 2 },
      { card: "clay_oven", grain: 1 },
    ]);
    const a = out.players[idx]!;
    expect(a.resources.food).toBe(9);
    expect(a.resources.grain).toBe(1);
  });

  it("rejects using the SAME card twice in one Bake action", () => {
    const s = mkGame(2);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors.push("fireplace2");
    p.resources.grain = 4;
    expect(() =>
      bakeOn(s, idx, [
        { card: "fireplace2", grain: 1 },
        { card: "fireplace2", grain: 1 },
      ]),
    ).toThrow(RuleError);
  });
});

describe("illegal bakes", () => {
  it("rejects baking without owning the improvement", () => {
    const s = mkGame(2);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    // grain present but no fireplace in play
    p.resources.grain = 3;
    expect(() => bakeOn(s, idx, [{ card: "fireplace2", grain: 1 }])).toThrow(RuleError);
  });

  it("rejects baking more grain than the player owns", () => {
    const s = mkGame(2);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors.push("fireplace2");
    p.resources.grain = 1;
    expect(() => bakeOn(s, idx, [{ card: "fireplace2", grain: 2 }])).toThrow(RuleError);
  });
});

describe("immediate bake on purchase", () => {
  it("Clay Oven purchase grants an immediate 1 grain -> 5 food bake", () => {
    const s = mkGame(2);
    ensureSpace(s, "r_improvement");
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.resources.clay = 3;
    p.resources.stone = 1;
    p.resources.grain = 1;
    p.resources.food = 0;
    const out = applyPlacement(s, idx, {
      action: "r_improvement",
      improvement: { kind: "major", card: "clay_oven", bake: [{ card: "clay_oven", grain: 1 }] },
    } as never).state;
    const a = out.players[idx]!;
    expect(a.majors).toContain("clay_oven");
    expect(a.resources.food).toBe(5);
  });

  it("immediate bake must use the bought oven, not another owned baker", () => {
    const s = mkGame(2);
    ensureSpace(s, "r_improvement");
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.majors.push("fireplace2");
    s.majorsAvailable = s.majorsAvailable.filter((m) => m !== "fireplace2");
    p.resources.clay = 3;
    p.resources.stone = 1;
    p.resources.grain = 2;
    // Trying to immediate-bake with the already-owned Fireplace must be rejected.
    expect(() =>
      applyPlacement(s, idx, {
        action: "r_improvement",
        improvement: { kind: "major", card: "clay_oven", bake: [{ card: "fireplace2", grain: 1 }] },
      } as never),
    ).toThrow(RuleError);
  });

  it("buying a Fireplace does NOT grant an immediate bake (only ovens do, RULES.md §5.4)", () => {
    const s = mkGame(2);
    ensureSpace(s, "r_improvement");
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.resources.clay = 2;
    p.resources.grain = 3;
    p.resources.food = 0;
    // Per RULES.md §5.4 only Clay/Stone Oven grant an immediate bake. A Fireplace
    // purchase that asks to immediately bake must be rejected.
    expect(() =>
      applyPlacement(s, idx, {
        action: "r_improvement",
        improvement: { kind: "major", card: "fireplace2", bake: [{ card: "fireplace2", grain: 3 }] },
      } as never),
    ).toThrow(RuleError);
  });

  it("buying a Cooking Hearth does NOT grant an immediate bake (RULES.md §5.4)", () => {
    const s = mkGame(2);
    ensureSpace(s, "r_improvement");
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.resources.clay = 4;
    p.resources.grain = 3;
    p.resources.food = 0;
    expect(() =>
      applyPlacement(s, idx, {
        action: "r_improvement",
        improvement: { kind: "major", card: "hearth4", bake: [{ card: "hearth4", grain: 3 }] },
      } as never),
    ).toThrow(RuleError);
  });
});

describe("cooking rates (anytime / feeding)", () => {
  /** Cook `conv` during feeding, isolating the cooked-food delta: the player is
   *  pre-seeded with exactly the food the family needs, so after the feeding
   *  payment the remaining food equals the food the cook produced. */
  function cookedFood(
    state: ReturnType<typeof mkGame>,
    idx: number,
    conv: { via: string; good: string; count: number },
  ): number {
    state.phase = "feeding";
    state.toFeed = [idx];
    state.players[idx]!.resources.food = foodNeeded(state, state.players[idx]!);
    const out = applyFeeding(state, idx, { conversions: [conv] } as never).state;
    expect(out.players[idx]!.beggingCards).toBe(0);
    return out.players[idx]!.resources.food;
  }

  it("Fireplace cattle -> 3 food, Hearth cattle -> 4 food", () => {
    const sF = mkGame(2);
    const i = sF.currentPlayer;
    sF.players[i]!.majors.push("fireplace2");
    sF.players[i]!.animals.cattle = 1;
    expect(cookedFood(sF, i, { via: "fireplace2", good: "cattle", count: 1 })).toBe(3);

    const sH = mkGame(2);
    const j = sH.currentPlayer;
    sH.players[j]!.majors.push("hearth4");
    sH.players[j]!.animals.cattle = 1;
    expect(cookedFood(sH, j, { via: "hearth4", good: "cattle", count: 1 })).toBe(4);
  });

  it("Hearth boar -> 3 each; Fireplace boar -> 2 each", () => {
    const s = mkGame(2);
    const i = s.currentPlayer;
    s.players[i]!.majors.push("hearth4");
    s.players[i]!.animals.boar = 2;
    expect(cookedFood(s, i, { via: "hearth4", good: "boar", count: 2 })).toBe(6);

    const s2 = mkGame(2);
    const k = s2.currentPlayer;
    s2.players[k]!.majors.push("fireplace2");
    s2.players[k]!.animals.boar = 2;
    expect(cookedFood(s2, k, { via: "fireplace2", good: "boar", count: 2 })).toBe(4);
  });

  it("rejects cooking an animal the player does not own", () => {
    const s = mkGame(2);
    const i = s.currentPlayer;
    s.players[i]!.majors.push("fireplace2");
    s.players[i]!.animals.cattle = 0;
    s.phase = "feeding";
    s.toFeed = [i];
    expect(() =>
      applyFeeding(s, i, { conversions: [{ via: "fireplace2", good: "cattle", count: 1 }] } as never),
    ).toThrow(RuleError);
  });

  it("raw animals have no food value (cannot convert an animal via 'raw')", () => {
    const s = mkGame(2);
    const i = s.currentPlayer;
    s.players[i]!.animals.sheep = 3;
    s.phase = "feeding";
    s.toFeed = [i];
    // 'raw' only converts grain/vegetable at 1 food; raw animals are worthless.
    expect(() =>
      applyFeeding(s, i, { conversions: [{ via: "raw", good: "sheep", count: 1 }] } as never),
    ).toThrow(RuleError);
  });

  it("a Fireplace cannot cook grain (grain is baked, not cooked)", () => {
    const s = mkGame(2);
    const i = s.currentPlayer;
    s.players[i]!.majors.push("fireplace2");
    s.players[i]!.resources.grain = 2;
    s.phase = "feeding";
    s.toFeed = [i];
    // Fireplace.cook has no grain entry; grain converts only via "raw" (1 food)
    // or via a Bake action, never at the Fireplace's 2x cook rate.
    expect(() =>
      applyFeeding(s, i, { conversions: [{ via: "fireplace2", good: "grain", count: 1 }] } as never),
    ).toThrow(RuleError);
  });
});

describe("card data sanity", () => {
  it("oven and fireplace bake stats match the rules card list", () => {
    expect(cardById("clay_oven").bake).toEqual({ perGrain: 5, maxGrain: 1 });
    expect(cardById("stone_oven").bake).toEqual({ perGrain: 4, maxGrain: 2 });
    expect(cardById("fireplace2").bake).toEqual({ perGrain: 2, maxGrain: 99 });
    expect(cardById("hearth4").bake).toEqual({ perGrain: 3, maxGrain: 99 });
  });
});
