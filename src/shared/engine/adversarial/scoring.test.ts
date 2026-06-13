/** Adversarial rule-conformance tests for END-OF-GAME SCORING.
 *
 *  Domain: src/shared/engine/scoring.ts (scorePlayer / scoreGame).
 *  Authoritative spec: RULES.md section 8 (and canonical base-game Agricola).
 *
 *  Strategy: build a precise PlayerState by mutating state.players[idx]
 *  directly, then call scorePlayer(state, player) and assert each category's
 *  points and the total against the exact rule.
 */
import { describe, expect, it } from "vitest";

import { mkGame } from "./harness";
import { scoreGame, scorePlayer } from "../scoring";
import { hEdge, validateFencePlan, vEdge } from "../farmyard";
import { FarmSpace, GameState, PlayerState } from "../types";

/** Points awarded for a named scoring category. */
function cat(sheet: ReturnType<typeof scorePlayer>, label: string): number {
  const c = sheet.categories.find((x) => x.label === label);
  if (!c) throw new Error(`no category ${label}; have ${sheet.categories.map((x) => x.label)}`);
  return c.points;
}

/** A fresh single-player game whose lone player we mutate freely. */
function freshPlayer(): { state: GameState; p: PlayerState } {
  const state = mkGame(2, 11);
  const p = state.players[0]!;
  // Normalize to a blank slate: empty 15-space farm, no cards, no food/begging.
  p.spaces = Array.from({ length: 15 }, (): FarmSpace => ({
    kind: "empty",
    stable: false,
    crop: null,
    cropCount: 0,
  }));
  p.fences = [];
  p.fencesBuilt = 0;
  p.houseMaterial = "wood";
  p.resources = { wood: 0, clay: 0, reed: 0, stone: 0, grain: 0, vegetable: 0, food: 0 };
  p.animals = { sheep: 0, boar: 0, cattle: 0 };
  p.occupations = [];
  p.minors = [];
  p.majors = [];
  p.beggingCards = 0;
  p.family = [{ bornRound: 0, placed: false }];
  return { state, p };
}

/** Fence the single space `idx` on all four borders -> a 1-cell pasture. */
function fenceCell(p: PlayerState, idx: number): void {
  const r = Math.floor(idx / 5);
  const c = idx % 5;
  p.fences.push(hEdge(r, c), hEdge(r + 1, c), vEdge(r, c), vEdge(r, c + 1));
}

describe("scoring: field tier boundaries", () => {
  it("0 fields scores -1 (missing category)", () => {
    const { state, p } = freshPlayer();
    expect(cat(scorePlayer(state, p), "Fields")).toBe(-1);
  });

  it("1 field still scores -1 (0-1 = -1 per RULES.md tier)", () => {
    const { state, p } = freshPlayer();
    p.spaces[0]!.kind = "field";
    expect(cat(scorePlayer(state, p), "Fields")).toBe(-1);
  });

  it("2 fields = 1, 3 = 2, 4 = 3, 5 = 4 (exact tier boundaries)", () => {
    const { state, p } = freshPlayer();
    const set = (n: number) => {
      for (let i = 0; i < 15; i++) p.spaces[i]!.kind = i < n ? "field" : "empty";
    };
    set(2);
    expect(cat(scorePlayer(state, p), "Fields")).toBe(1);
    set(3);
    expect(cat(scorePlayer(state, p), "Fields")).toBe(2);
    set(4);
    expect(cat(scorePlayer(state, p), "Fields")).toBe(3);
    set(5);
    expect(cat(scorePlayer(state, p), "Fields")).toBe(4);
    set(6);
    expect(cat(scorePlayer(state, p), "Fields")).toBe(4); // 5+ caps at 4
  });
});

describe("scoring: pasture tier boundaries", () => {
  it("0 pastures scores -1", () => {
    const { state, p } = freshPlayer();
    expect(cat(scorePlayer(state, p), "Pastures")).toBe(-1);
  });

  it("1 fenced pasture = 1, 2 = 2 (separate enclosed regions)", () => {
    const { state, p } = freshPlayer();
    // One enclosed single-cell pasture at index 0.
    fenceCell(p, 0);
    expect(cat(scorePlayer(state, p), "Pastures")).toBe(1);
    // A second, disjoint enclosed pasture at index 2.
    fenceCell(p, 2);
    expect(cat(scorePlayer(state, p), "Pastures")).toBe(2);
  });
});

describe("scoring: grain counts supply + on-field crop", () => {
  it("grain on fields counts toward the grain tier", () => {
    const { state, p } = freshPlayer();
    // 2 grain in supply + a field holding 3 grain = 5 grain total -> tier 4-5 = 2.
    p.resources.grain = 2;
    p.spaces[0]!.kind = "field";
    p.spaces[0]!.crop = "grain";
    p.spaces[0]!.cropCount = 3;
    expect(cat(scorePlayer(state, p), "Grain")).toBe(2);
  });

  it("grain tier boundaries: 0=-1, 1=1, 3=1, 4=2, 6=3, 8=4", () => {
    const { state, p } = freshPlayer();
    const g = (n: number) => {
      p.resources.grain = n;
      return cat(scorePlayer(state, p), "Grain");
    };
    expect(g(0)).toBe(-1);
    expect(g(1)).toBe(1);
    expect(g(3)).toBe(1);
    expect(g(4)).toBe(2);
    expect(g(5)).toBe(2);
    expect(g(6)).toBe(3);
    expect(g(7)).toBe(3);
    expect(g(8)).toBe(4);
  });
});

describe("scoring: vegetable counts supply + fields", () => {
  it("vegetable on fields counts; tier boundaries 0=-1,1=1,2=2,3=3,4=4", () => {
    const { state, p } = freshPlayer();
    p.spaces[0]!.kind = "field";
    p.spaces[0]!.crop = "vegetable";
    p.spaces[0]!.cropCount = 2; // 2 on a field
    expect(cat(scorePlayer(state, p), "Vegetables")).toBe(2);

    p.spaces[0]!.cropCount = 0;
    p.spaces[0]!.crop = null;
    const v = (n: number) => {
      p.resources.vegetable = n;
      return cat(scorePlayer(state, p), "Vegetables");
    };
    expect(v(0)).toBe(-1);
    expect(v(1)).toBe(1);
    expect(v(2)).toBe(2);
    expect(v(3)).toBe(3);
    expect(v(4)).toBe(4);
    expect(v(9)).toBe(4);
  });
});

describe("scoring: animal tier boundaries", () => {
  it("sheep 0=-1,1=1,3=1,4=2,6=3,8=4", () => {
    const { state, p } = freshPlayer();
    const f = (n: number) => {
      p.animals.sheep = n;
      return cat(scorePlayer(state, p), "Sheep");
    };
    expect(f(0)).toBe(-1);
    expect(f(1)).toBe(1);
    expect(f(3)).toBe(1);
    expect(f(4)).toBe(2);
    expect(f(6)).toBe(3);
    expect(f(8)).toBe(4);
  });

  it("wild boar 0=-1,1=1,2=1,3=2,5=3,7=4", () => {
    const { state, p } = freshPlayer();
    const f = (n: number) => {
      p.animals.boar = n;
      return cat(scorePlayer(state, p), "Wild boar");
    };
    expect(f(0)).toBe(-1);
    expect(f(1)).toBe(1);
    expect(f(2)).toBe(1);
    expect(f(3)).toBe(2);
    expect(f(4)).toBe(2);
    expect(f(5)).toBe(3);
    expect(f(6)).toBe(3);
    expect(f(7)).toBe(4);
  });

  it("cattle 0=-1,1=1,2=2,3=2,4=3,5=3,6=4", () => {
    const { state, p } = freshPlayer();
    const f = (n: number) => {
      p.animals.cattle = n;
      return cat(scorePlayer(state, p), "Cattle");
    };
    expect(f(0)).toBe(-1);
    expect(f(1)).toBe(1);
    expect(f(2)).toBe(2);
    expect(f(3)).toBe(2);
    expect(f(4)).toBe(3);
    expect(f(5)).toBe(3);
    expect(f(6)).toBe(4);
  });
});

describe("scoring: unused farmyard spaces (-1 each)", () => {
  it("a freshly mutated all-empty 15-space farm scores -15 unused", () => {
    const { state, p } = freshPlayer();
    expect(cat(scorePlayer(state, p), "Unused spaces")).toBe(-15);
  });

  it("rooms, fields, stables, and pasture cells all count as used", () => {
    const { state, p } = freshPlayer();
    p.spaces[5]!.kind = "room"; // room used
    p.spaces[6]!.kind = "field"; // field used
    p.spaces[7]!.stable = true; // unfenced stable used
    fenceCell(p, 0); // pasture cell used
    // 15 - 4 used = 11 unused.
    expect(cat(scorePlayer(state, p), "Unused spaces")).toBe(-11);
  });

  it("a fully used farm scores 0 unused", () => {
    const { state, p } = freshPlayer();
    for (let i = 0; i < 15; i++) p.spaces[i]!.kind = "field";
    // Normalize -0 (from negating a 0 count) to +0 for the equality check.
    expect(cat(scorePlayer(state, p), "Unused spaces") + 0).toBe(0);
  });
});

describe("scoring: stables and rooms", () => {
  it("fenced stable scores +1; unfenced stable scores 0 bonus", () => {
    const { state, p } = freshPlayer();
    // Unfenced stable -> no fenced-stable bonus.
    p.spaces[3]!.stable = true;
    expect(cat(scorePlayer(state, p), "Fenced stables")).toBe(0);

    // Stable inside an enclosed pasture -> +1.
    p.spaces[3]!.stable = false;
    p.spaces[0]!.stable = true;
    fenceCell(p, 0);
    expect(cat(scorePlayer(state, p), "Fenced stables")).toBe(1);
  });

  it("rooms score by house material: wood 0, clay +1 each, stone +2 each", () => {
    const { state, p } = freshPlayer();
    p.spaces[5]!.kind = "room";
    p.spaces[10]!.kind = "room";
    p.spaces[0]!.kind = "room"; // 3 rooms total

    p.houseMaterial = "wood";
    expect(cat(scorePlayer(state, p), "Rooms")).toBe(0);
    p.houseMaterial = "clay";
    expect(cat(scorePlayer(state, p), "Rooms")).toBe(3);
    p.houseMaterial = "stone";
    expect(cat(scorePlayer(state, p), "Rooms")).toBe(6);
  });
});

describe("scoring: family, begging, card VP", () => {
  it("+3 per family member", () => {
    const { state, p } = freshPlayer();
    p.family = [
      { bornRound: 0, placed: false },
      { bornRound: 0, placed: false },
      { bornRound: 0, placed: false },
    ];
    expect(cat(scorePlayer(state, p), "Family")).toBe(9);
  });

  it("-3 per begging card", () => {
    const { state, p } = freshPlayer();
    p.beggingCards = 2;
    expect(cat(scorePlayer(state, p), "Begging")).toBe(-6);
  });

  it("printed card VP sums across occupations/minors/majors", () => {
    const { state, p } = freshPlayer();
    // well = 4 VP, stone_oven = 3 VP, fireplace2 = 1 VP -> 8.
    p.majors = ["well", "stone_oven", "fireplace2"];
    expect(cat(scorePlayer(state, p), "Card points")).toBe(8);
  });

  it("Joinery end-game bonus: 7 wood in supply earns 3 bonus pts", () => {
    const { state, p } = freshPlayer();
    p.majors = ["joinery"];
    p.resources.wood = 7;
    // joinery vp=2 printed, plus bonus 3 for 7 wood.
    expect(cat(scorePlayer(state, p), "Card points")).toBe(2);
    expect(cat(scorePlayer(state, p), "Bonus points")).toBe(3);
  });
});

describe("scoring: full-game aggregate sanity", () => {
  it("an empty-handed beginner farm totals the sum of all -1 tiers, family, and unused", () => {
    const { state, p } = freshPlayer();
    // All 7 good-categories at -1, pastures -1, fields -1 => 7 * -1 = -7.
    // Plus 15 unused (-15), 1 family (+3), no rooms/begging/cards.
    const sheet = scorePlayer(state, p);
    // Fields -1, Pastures -1, Grain -1, Veg -1, Sheep -1, Boar -1, Cattle -1 = -7
    const tierSum =
      cat(sheet, "Fields") +
      cat(sheet, "Pastures") +
      cat(sheet, "Grain") +
      cat(sheet, "Vegetables") +
      cat(sheet, "Sheep") +
      cat(sheet, "Wild boar") +
      cat(sheet, "Cattle");
    expect(tierSum).toBe(-7);
    expect(sheet.total).toBe(-7 - 15 + 3);
  });

  it("scoreGame returns one sheet per player with matching totals", () => {
    const state = mkGame(2, 5);
    const sheets = scoreGame(state);
    expect(sheets.length).toBe(2);
    for (const s of sheets) {
      const sum = s.categories.reduce((acc, c) => acc + c.points, 0);
      expect(s.total).toBe(sum);
    }
  });
});

describe("scoring: pasture must be FULLY enclosed by built fences (border is not a fence)", () => {
  it("a region open to the exterior is not a pasture", () => {
    const { state, p } = freshPlayer();
    // Build only 3 of the 4 edges around cell 0 -> open side -> not enclosed.
    p.fences.push(hEdge(0, 0), vEdge(0, 0), vEdge(0, 1)); // missing hEdge(1,0)
    expect(cat(scorePlayer(state, p), "Pastures")).toBe(-1);
  });

  it("subdividing one enclosed 2x1 block with an inner fence yields 2 pastures", () => {
    const { state, p } = freshPlayer();
    // Enclose cells 0 and 1 (row 0, cols 0-1) as a 2-cell block.
    p.fences.push(
      hEdge(0, 0),
      hEdge(0, 1),
      hEdge(1, 0),
      hEdge(1, 1),
      vEdge(0, 0),
      vEdge(0, 2),
    );
    expect(cat(scorePlayer(state, p), "Pastures")).toBe(1);
    // Add the inner divider between cols 0 and 1 -> two separate 1-cell pastures.
    p.fences.push(vEdge(0, 1));
    expect(cat(scorePlayer(state, p), "Pastures")).toBe(2);
  });
});

describe("scoring: enclosed region containing a non-empty cell (canonical 5.5)", () => {
  // Canonical Agricola: pastures may not contain rooms or fields. The engine
  // keeps the scorer honest by REFUSING to create such an enclosure in the
  // first place (validateFencePlan). Verify the rule is enforced at the source
  // rather than relying on the scorer to special-case an impossible board.
  it("validateFencePlan rejects fencing a region that contains a room", () => {
    const { p } = freshPlayer();
    p.spaces[0]!.kind = "room";
    const res = validateFencePlan(p, [hEdge(0, 0), hEdge(1, 0), vEdge(0, 0), vEdge(0, 1)]);
    expect(res.ok).toBe(false);
  });

  it("validateFencePlan rejects fencing a region that contains a field", () => {
    const { p } = freshPlayer();
    p.spaces[0]!.kind = "field";
    const res = validateFencePlan(p, [hEdge(0, 0), hEdge(1, 0), vEdge(0, 0), vEdge(0, 1)]);
    expect(res.ok).toBe(false);
  });
});
