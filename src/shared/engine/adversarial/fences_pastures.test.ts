/** Adversarial rule-conformance tests for the Fences & Pastures domain.
 *
 *  Canonical base-game Agricola rules (RULES.md section 5.5 / 5.2 / 8):
 *   - Fences cost 1 wood each; lifetime max 15 fences per player.
 *   - A pasture must be FULLY enclosed by built fences; the board border is NOT
 *     a fence. Every built fence must border some enclosed pasture cell.
 *   - Pastures may not contain rooms or fields (stables allowed).
 *   - New pastures must be orthogonally adjacent to existing pastures (if any);
 *     existing pastures may be subdivided.
 *   - Capacity = 2 animals per cell, doubled per stable in the pasture; one
 *     animal type per pasture.
 *   - Free-fence discounts (Fence Posts -1, Hedge Warden -2 per action) reduce
 *     wood cost but still count toward the 15 limit and toward fencesBuilt.
 */
import { describe, expect, it } from "vitest";

import { RuleError } from "../apply";
import { computePastures, maxRetention, validateFencePlan } from "../farmyard";
import { ensureSpace, mkGame, placeFor } from "./harness";
import { GameState } from "../types";

/** Clear a player's farm to all-empty, no fences. Returns the player. */
function freshFarm(s: GameState, idx: number) {
  const p = s.players[idx]!;
  for (const sp of p.spaces) {
    sp.kind = "empty";
    sp.stable = false;
    sp.crop = null;
    sp.cropCount = 0;
  }
  p.fences = [];
  p.fencesBuilt = 0;
  return p;
}

/** The four edges fully enclosing single cell `idx` (a 1-cell pasture). */
function cellBox(idx: number): string[] {
  const r = Math.floor(idx / 5);
  const c = idx % 5;
  return [`h-${r}-${c}`, `h-${r + 1}-${c}`, `v-${r}-${c}`, `v-${r}-${c + 1}`];
}

describe("fences & pastures — enclosure", () => {
  it("a single fully-enclosed empty cell is a pasture with capacity 2", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    const layout = computePastures(p.spaces, cellBox(4));
    expect(layout.pastures).toHaveLength(1);
    expect(layout.pastures[0]!.cells).toEqual([4]);
    expect(layout.pastures[0]!.capacity).toBe(2);
  });

  it("an open region (one missing border fence) is NOT a pasture; the build is rejected", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    // Three of cell 4's four edges: the right border (v-0-5) is missing, so the
    // region connects to the exterior and is not enclosed.
    const r = validateFencePlan(p, ["h-0-4", "h-1-4", "v-0-4"]);
    expect(r.ok).toBe(false);
    // No fence borders an enclosed pasture cell → rejected.
    expect(r.error).toMatch(/not part of any enclosed pasture/);
  });

  it("the board border alone does NOT enclose a cell (border is not a fence)", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    // Corner cell 0 touches the board border on top (h-0-0) and left (v-0-0).
    // Build ONLY the two interior edges (h-1-0, v-0-1); relying on the border to
    // close the other two sides must NOT yield an enclosed pasture.
    const r = validateFencePlan(p, ["h-1-0", "v-0-1"]);
    expect(r.ok).toBe(false);
  });

  it("real placement path throws RuleError when enclosure is incomplete", () => {
    const s = mkGame();
    ensureSpace(s, "r_fences");
    const idx = s.currentPlayer;
    const p = freshFarm(s, idx);
    p.resources.wood = 10;
    expect(() =>
      placeFor(s, idx, { action: "r_fences", edges: ["h-0-4", "h-1-4", "v-0-4"] }),
    ).toThrow(RuleError);
  });
});

describe("fences & pastures — rooms / fields may not be enclosed", () => {
  it("fencing in a room is rejected", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    p.spaces[4]!.kind = "room";
    const r = validateFencePlan(p, cellBox(4));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/room/);
  });

  it("fencing in a field is rejected (real path throws RuleError)", () => {
    const s = mkGame();
    ensureSpace(s, "r_fences");
    const idx = s.currentPlayer;
    const p = freshFarm(s, idx);
    p.spaces[4]!.kind = "field";
    p.resources.wood = 10;
    expect(() =>
      placeFor(s, idx, { action: "r_fences", edges: cellBox(4) }),
    ).toThrow(RuleError);
  });

  it("a pasture cell that holds a STABLE is allowed and doubles capacity", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    p.spaces[4]!.stable = true;
    const r = validateFencePlan(p, cellBox(4));
    expect(r.ok).toBe(true);
    expect(r.layout!.pastures[0]!.stables).toBe(1);
    // 2 per cell, doubled for the 1 stable -> 4.
    expect(r.layout!.pastures[0]!.capacity).toBe(4);
  });
});

describe("fences & pastures — every fence must border an enclosed pasture", () => {
  it("a stray fence not bordering any pasture is rejected", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    // Enclose cell 4 (valid) plus a stray h-0-3 that borders only open cell 3.
    const r = validateFencePlan(p, [...cellBox(4), "h-0-3"]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not part of any enclosed pasture/);
  });

  it("a lone interior fence that encloses nothing is rejected", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    const r = validateFencePlan(p, ["v-0-1"]);
    expect(r.ok).toBe(false);
  });
});

describe("fences & pastures — the 15-fence lifetime limit", () => {
  it("the 16th fence is rejected (fencesBuilt 12 + 4 would be 16)", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    p.fencesBuilt = 12;
    const r = validateFencePlan(p, cellBox(4));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/15/);
  });

  it("exactly the 15th fence is allowed (fencesBuilt 11 + 4 = 15)", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    p.fencesBuilt = 11;
    const r = validateFencePlan(p, cellBox(4));
    expect(r.ok).toBe(true);
  });

  it("the limit is enforced on the real placement path (16th throws RuleError)", () => {
    const s = mkGame();
    ensureSpace(s, "r_fences");
    const idx = s.currentPlayer;
    const p = freshFarm(s, idx);
    p.fencesBuilt = 15;
    p.resources.wood = 10;
    expect(() =>
      placeFor(s, idx, { action: "r_fences", edges: cellBox(4) }),
    ).toThrow(RuleError);
  });

  it("the whole 3x5 board cannot be one pasture: its 16-fence perimeter exceeds the 15 limit", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    const edges: string[] = [];
    for (let c = 0; c < 5; c++) {
      edges.push(`h-0-${c}`);
      edges.push(`h-3-${c}`);
    }
    for (let r = 0; r < 3; r++) {
      edges.push(`v-${r}-0`);
      edges.push(`v-${r}-5`);
    }
    expect(edges).toHaveLength(16);
    const r = validateFencePlan(p, edges);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/15/);
  });
});

describe("fences & pastures — free-fence discounts", () => {
  it("Fence Posts (-1) and Hedge Warden (-2) stack to 3 free wood per action but still cost fences toward the limit", () => {
    const s = mkGame();
    ensureSpace(s, "r_fences");
    const idx = s.currentPlayer;
    const p = freshFarm(s, idx);
    p.occupations.push("occ_hedge_warden"); // 2 free
    p.minors.push("min_fence_posts"); // 1 free
    p.resources.wood = 1; // 4 fences - 3 free = 1 wood
    const out = placeFor(s, idx, { action: "r_fences", edges: cellBox(4) });
    const after = out.players[idx]!;
    expect(after.resources.wood).toBe(0);
    // All 4 fences still count toward the lifetime limit / fencesBuilt.
    expect(after.fencesBuilt).toBe(4);
    expect(after.fences).toHaveLength(4);
  });

  it("free fences exceeding the count floor wood cost at 0 (never refund)", () => {
    const s = mkGame();
    ensureSpace(s, "r_fences");
    const idx = s.currentPlayer;
    const p = freshFarm(s, idx);
    p.occupations.push("occ_hedge_warden"); // 2 free; build only 4, pay 2
    p.resources.wood = 2;
    const out = placeFor(s, idx, { action: "r_fences", edges: cellBox(4) });
    expect(out.players[idx]!.resources.wood).toBe(0);
    expect(out.players[idx]!.fencesBuilt).toBe(4);
  });

  it("each fence costs exactly 1 wood with no discount card", () => {
    const s = mkGame();
    ensureSpace(s, "r_fences");
    const idx = s.currentPlayer;
    const p = freshFarm(s, idx);
    p.resources.wood = 10;
    const out = placeFor(s, idx, { action: "r_fences", edges: cellBox(4) });
    expect(out.players[idx]!.resources.wood).toBe(6); // 10 - 4
  });
});

describe("fences & pastures — adjacency and subdivision", () => {
  it("a new pasture disconnected from existing pastures is rejected", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    p.fences = cellBox(0);
    p.fencesBuilt = 4;
    // New pasture at cell 4 (top-right) shares no edge with cell 0.
    const r = validateFencePlan(p, cellBox(4));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/border existing/);
  });

  it("a new pasture touching an existing one ONLY diagonally is rejected", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    p.fences = cellBox(0); // existing pasture at cell 0 (r0c0)
    p.fencesBuilt = 4;
    // Cell 6 (r1c1) is diagonal to cell 0 — not orthogonally adjacent.
    const r = validateFencePlan(p, cellBox(6));
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/border existing/);
  });

  it("a new pasture orthogonally adjacent to an existing one is allowed", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    p.fences = cellBox(0); // cell 0
    p.fencesBuilt = 4;
    // Cell 1 is to the right of cell 0; v-0-1 already exists, so only 3 new edges.
    const r = validateFencePlan(p, ["h-0-1", "h-1-1", "v-0-2"]);
    expect(r.ok).toBe(true);
    expect(r.layout!.pastures).toHaveLength(2);
  });

  it("subdividing an existing pasture is allowed and counts as 2 pastures", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    // 2-cell pasture {0,1}.
    p.fences = ["h-0-0", "h-0-1", "h-1-0", "h-1-1", "v-0-0", "v-0-2"];
    p.fencesBuilt = 6;
    const before = computePastures(p.spaces, p.fences);
    expect(before.pastures).toHaveLength(1);
    const r = validateFencePlan(p, ["v-0-1"]); // interior wall splits {0,1}
    expect(r.ok).toBe(true);
    expect(r.layout!.pastures).toHaveLength(2);
  });

  it("a plan mixing a legal adjacent pasture with a far disconnected one is rejected wholesale", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    p.fences = cellBox(0);
    p.fencesBuilt = 4;
    // Adjacent cell 1 (legal) plus far cell 14 (illegal) in one action.
    const r = validateFencePlan(p, [
      "h-0-1",
      "h-1-1",
      "v-0-2", // cell 1
      "h-2-4",
      "h-3-4",
      "v-2-4",
      "v-2-5", // cell 14
    ]);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/border existing/);
  });
});

describe("fences & pastures — capacity arithmetic", () => {
  it("multi-cell pasture: 2 animals per cell with no stables", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    // 6-cell block cells {0,1,2,5,6,7}.
    const fences = [
      "h-0-0",
      "h-0-1",
      "h-0-2",
      "h-2-0",
      "h-2-1",
      "h-2-2",
      "v-0-0",
      "v-1-0",
      "v-0-3",
      "v-1-3",
    ];
    const layout = computePastures(p.spaces, fences);
    expect(layout.pastures).toHaveLength(1);
    expect(layout.pastures[0]!.cells).toHaveLength(6);
    expect(layout.pastures[0]!.capacity).toBe(12); // 2 * 6
  });

  it("each stable in a pasture doubles capacity (2 stables = x4)", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    p.spaces[0]!.stable = true;
    p.spaces[1]!.stable = true;
    const layout = computePastures(p.spaces, ["h-0-0", "h-0-1", "h-1-0", "h-1-1", "v-0-0", "v-0-2"]);
    expect(layout.pastures[0]!.stables).toBe(2);
    // 2 cells * 2 per cell = 4 base; two stables -> x4 -> 16.
    expect(layout.pastures[0]!.capacity).toBe(16);
  });

  it("one stable in a 2-cell pasture gives capacity 8", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    p.spaces[0]!.stable = true;
    const layout = computePastures(p.spaces, ["h-0-0", "h-0-1", "h-1-0", "h-1-1", "v-0-0", "v-0-2"]);
    expect(layout.pastures[0]!.capacity).toBe(8); // 4 base * 2
  });

  it("maxRetention enforces one animal type per pasture", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    // One cap-2 pasture (cell 0). With 2 sheep + 2 boar, the pasture holds only
    // one type (2 of it); the house pet holds 1 of the other. Max retention 3.
    p.fences = cellBox(0);
    const ret = maxRetention(p, { sheep: 2, boar: 2, cattle: 0 }, []);
    expect(ret.total).toBe(3);
    // The pasture cannot mix: at most one type reaches 2.
    const atTwo = (["sheep", "boar", "cattle"] as const).filter((t) => ret.retained[t] >= 2);
    expect(atTwo.length).toBeLessThanOrEqual(1);
  });

  it("two separate cap-2 pastures hold two different types fully", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    // Two disjoint cap-2 pastures: cell 0 and cell 2.
    p.fences = [...cellBox(0), ...cellBox(2)];
    const ret = maxRetention(p, { sheep: 2, boar: 2, cattle: 0 }, []);
    expect(ret.retained.sheep).toBe(2);
    expect(ret.retained.boar).toBe(2);
    expect(ret.total).toBe(4);
  });

  it("with no pastures, only the single house pet can be retained", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    const ret = maxRetention(p, { sheep: 5, boar: 3, cattle: 2 }, []);
    expect(ret.total).toBe(1);
  });

  it("an unfenced stable holds exactly 1 animal (plus the house pet)", () => {
    const s = mkGame();
    const p = freshFarm(s, 0);
    p.spaces[7]!.stable = true; // unfenced stable, no pasture
    const ret = maxRetention(p, { sheep: 5, boar: 0, cattle: 0 }, []);
    expect(ret.total).toBe(2); // pet (1) + unfenced stable (1)
  });
});
