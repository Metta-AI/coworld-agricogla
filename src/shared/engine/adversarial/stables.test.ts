/** Adversarial rule-conformance tests — domain: Stables & farm expansion.
 *
 *  Canonical base-game Agricola rules (RULES.md §5.2, §5.5, §8):
 *   - Max 4 stables per player, 1 per space, 2 wood each, via Farm Expansion.
 *   - A stable may sit on any space without a room or field (an empty space,
 *     including inside a pasture). Stables are never removed.
 *   - A stable inside a pasture DOUBLES that pasture's capacity per stable
 *     (capacity = 2 * cells * 2^stables).
 *   - An unfenced stable holds exactly 1 animal; a fenced stable (one inside a
 *     pasture) scores +1 at game end, an unfenced one does not.
 *   - A space is "used" (no -1) if it has a room, field, stable, or is in a
 *     pasture.
 *   - Farm Expansion requires building at least one room or stable.
 */
import { describe, expect, it } from "vitest";
import { mkGame, place, ensureSpace } from "./harness";
import { RuleError, legalStableSpaces } from "../apply";
import { scorePlayer } from "../scoring";
import { computePastures, maxRetention, edgesOfCell, hEdge, vEdge } from "../farmyard";
import { capacitySlots } from "../effects";

/** Expose `farm_expansion` and hand the current player to act. */
function expansionGame(seed = 7) {
  const s = mkGame(2, seed);
  ensureSpace(s, "farm_expansion");
  const idx = s.currentPlayer;
  return { s, idx };
}

function catPts(state: ReturnType<typeof mkGame>, idx: number, label: string): number {
  const sheet = scorePlayer(state, state.players[idx]!);
  return sheet.categories.find((c) => c.label === label)!.points;
}

describe("stables & farm expansion — adversarial", () => {
  // --- cost & count ---------------------------------------------------------

  it("each stable costs exactly 2 wood (4 stables -> 8 wood spent)", () => {
    const { s, idx } = expansionGame();
    s.players[idx]!.resources.wood = 8;
    const after = place(s, { action: "farm_expansion", rooms: [], stables: [0, 1, 2, 3] });
    const p = after.players[idx]!;
    expect(p.spaces.filter((sp) => sp.stable)).toHaveLength(4);
    expect(p.resources.wood).toBe(0);
  });

  it("building one stable leaves wood = start - 2", () => {
    const { s, idx } = expansionGame();
    s.players[idx]!.resources.wood = 5;
    const after = place(s, { action: "farm_expansion", rooms: [], stables: [7] });
    expect(after.players[idx]!.resources.wood).toBe(3);
    expect(after.players[idx]!.spaces[7]!.stable).toBe(true);
  });

  it("a 5th stable is rejected (max 4 per player)", () => {
    const { s, idx } = expansionGame();
    s.players[idx]!.resources.wood = 100;
    // four already built
    s.players[idx]!.spaces[0]!.stable = true;
    s.players[idx]!.spaces[1]!.stable = true;
    s.players[idx]!.spaces[2]!.stable = true;
    s.players[idx]!.spaces[3]!.stable = true;
    expect(() =>
      place(s, { action: "farm_expansion", rooms: [], stables: [6] }),
    ).toThrow(RuleError);
  });

  it("requesting 5 stables in a single action is rejected, not silently capped at 4", () => {
    const { s, idx } = expansionGame();
    s.players[idx]!.resources.wood = 100;
    expect(() =>
      place(s, { action: "farm_expansion", rooms: [], stables: [0, 1, 2, 3, 6] }),
    ).toThrow(RuleError);
  });

  it("insufficient wood for the requested stables throws and leaves state untouched", () => {
    const { s, idx } = expansionGame();
    s.players[idx]!.resources.wood = 3; // affords 1, not 2
    expect(() =>
      place(s, { action: "farm_expansion", rooms: [], stables: [0, 1] }),
    ).toThrow(RuleError);
    // engine clones per step: the source state must be unchanged.
    expect(s.players[idx]!.resources.wood).toBe(3);
    expect(s.players[idx]!.spaces.filter((sp) => sp.stable)).toHaveLength(0);
  });

  // --- placement legality ---------------------------------------------------

  it("a stable may not be built on a room", () => {
    const { s, idx } = expansionGame();
    s.players[idx]!.resources.wood = 100;
    // space 5 (row1,col0) and 10 (row2,col0) are the starting rooms.
    expect(() =>
      place(s, { action: "farm_expansion", rooms: [], stables: [5] }),
    ).toThrow(RuleError);
  });

  it("a stable may not be built on a field (sown or empty)", () => {
    const { s, idx } = expansionGame();
    s.players[idx]!.resources.wood = 100;
    s.players[idx]!.spaces[0]!.kind = "field";
    expect(() =>
      place(s, { action: "farm_expansion", rooms: [], stables: [0] }),
    ).toThrow(RuleError);
  });

  it("two stables may not share a space (1 stable per space)", () => {
    const { s, idx } = expansionGame();
    s.players[idx]!.resources.wood = 100;
    expect(() =>
      place(s, { action: "farm_expansion", rooms: [], stables: [7, 7] }),
    ).toThrow(RuleError);
  });

  it("a stable IS allowed on a cell inside an enclosed pasture", () => {
    const { s, idx } = expansionGame();
    s.players[idx]!.resources.wood = 100;
    // enclose cell 7 fully with fences -> it is a pasture cell (still kind=empty).
    s.players[idx]!.fences = edgesOfCell(7);
    expect(legalStableSpaces(s.players[idx]!)).toContain(7);
    const after = place(s, { action: "farm_expansion", rooms: [], stables: [7] });
    expect(after.players[idx]!.spaces[7]!.stable).toBe(true);
  });

  it("legalStableSpaces excludes rooms and includes every other empty cell", () => {
    const s = mkGame(2, 7);
    const legal = legalStableSpaces(s.players[s.currentPlayer]!);
    expect(legal).not.toContain(5); // starting room
    expect(legal).not.toContain(10); // starting room
    expect(legal).toHaveLength(13); // 15 cells - 2 rooms
  });

  // --- farm expansion requirement ------------------------------------------

  it("Farm Expansion with neither rooms nor stables is rejected", () => {
    const { s } = expansionGame();
    expect(() =>
      place(s, { action: "farm_expansion", rooms: [], stables: [] }),
    ).toThrow(RuleError);
  });

  // --- capacity doubling math ----------------------------------------------

  it("a stable doubles a 1-cell pasture's capacity: 2 -> 4", () => {
    const s = mkGame(2, 7);
    const p = s.players[s.currentPlayer]!;
    p.fences = edgesOfCell(7);
    expect(computePastures(p.spaces, p.fences).pastures[0]!.capacity).toBe(2);
    p.spaces[7]!.stable = true;
    expect(computePastures(p.spaces, p.fences).pastures[0]!.capacity).toBe(4);
  });

  it("two stables in a 2-cell pasture quadruple it: 4 -> 16 (2*cells*2^stables)", () => {
    const s = mkGame(2, 7);
    const p = s.players[s.currentPlayer]!;
    // enclose cells 7 and 8 together (open edge between them).
    p.fences = [hEdge(1, 2), hEdge(2, 2), vEdge(1, 2), hEdge(1, 3), hEdge(2, 3), vEdge(1, 4)];
    let lay = computePastures(p.spaces, p.fences);
    expect(lay.pastures).toHaveLength(1);
    expect(lay.pastures[0]!.cells).toEqual([7, 8]);
    expect(lay.pastures[0]!.capacity).toBe(4);
    p.spaces[7]!.stable = true;
    p.spaces[8]!.stable = true;
    lay = computePastures(p.spaces, p.fences);
    expect(lay.pastures[0]!.capacity).toBe(2 * 2 * 2 ** 2); // 16
  });

  it("one stable scales a 5-cell pasture: 10 -> 20 (doubles whole pasture)", () => {
    const s = mkGame(2, 7);
    const p = s.players[s.currentPlayer]!;
    // enclose the entire top row as a 5-cell pasture.
    p.fences = [
      hEdge(0, 0), hEdge(0, 1), hEdge(0, 2), hEdge(0, 3), hEdge(0, 4),
      hEdge(1, 0), hEdge(1, 1), hEdge(1, 2), hEdge(1, 3), hEdge(1, 4),
      vEdge(0, 0), vEdge(0, 5),
    ];
    expect(computePastures(p.spaces, p.fences).pastures[0]!.capacity).toBe(10);
    p.spaces[2]!.stable = true; // a single stable anywhere in the pasture
    expect(computePastures(p.spaces, p.fences).pastures[0]!.capacity).toBe(20);
  });

  it("three stables octuple a 4-cell pasture (2*4*2^3 = 64)", () => {
    const s = mkGame(2, 7);
    const p = s.players[s.currentPlayer]!;
    // enclose a 2x2 block: cells 0,1,5,6.
    p.fences = [
      hEdge(0, 0), hEdge(0, 1), // top of row 0 cols 0,1
      vEdge(0, 0), vEdge(1, 0), // left border rows 0,1
      vEdge(0, 2), vEdge(1, 2), // right side after col 1
      hEdge(2, 0), hEdge(2, 1), // bottom of row 1 cols 0,1
    ];
    const lay = computePastures(p.spaces, p.fences);
    expect(lay.pastures).toHaveLength(1);
    expect(lay.pastures[0]!.cells).toEqual([0, 1, 5, 6]);
    p.spaces[0]!.stable = true;
    p.spaces[1]!.stable = true;
    p.spaces[6]!.stable = true;
    expect(computePastures(p.spaces, p.fences).pastures[0]!.capacity).toBe(2 * 4 * 2 ** 3);
  });

  // --- retention semantics --------------------------------------------------

  it("an unfenced stable holds exactly 1 animal (plus the house pet)", () => {
    const s = mkGame(2, 7);
    const p = s.players[s.currentPlayer]!;
    p.spaces[7]!.stable = true; // unfenced
    const h = maxRetention(p, { sheep: 10, boar: 0, cattle: 0 }, capacitySlots(p));
    // 1 (stable) + 1 (house pet) = 2.
    expect(h.retained.sheep).toBe(2);
  });

  it("a stable inside a 1-cell pasture retains 4 in that pasture (+ house pet)", () => {
    const s = mkGame(2, 7);
    const p = s.players[s.currentPlayer]!;
    p.fences = edgesOfCell(7);
    p.spaces[7]!.stable = true;
    const h = maxRetention(p, { sheep: 10, boar: 0, cattle: 0 }, capacitySlots(p));
    expect(h.retained.sheep).toBe(5); // 4 pasture + 1 house pet
  });

  // --- scoring --------------------------------------------------------------

  it("a fenced stable scores +1; an unfenced one scores 0", () => {
    // unfenced
    const a = mkGame(2, 7);
    a.players[0]!.spaces[7]!.stable = true;
    expect(catPts(a, 0, "Fenced stables")).toBe(0);
    // fenced (enclosed pasture)
    const b = mkGame(2, 7);
    b.players[0]!.fences = edgesOfCell(7);
    b.players[0]!.spaces[7]!.stable = true;
    expect(catPts(b, 0, "Fenced stables")).toBe(1);
  });

  it("a stable makes its space 'used' (no -1) even when unfenced", () => {
    const bare = mkGame(2, 7);
    const baseUnused = catPts(bare, 0, "Unused spaces"); // -(15-2 rooms) = -13
    expect(baseUnused).toBe(-13);
    const withStable = mkGame(2, 7);
    withStable.players[0]!.spaces[7]!.stable = true;
    // one more space used -> one fewer -1.
    expect(catPts(withStable, 0, "Unused spaces")).toBe(-12);
  });

  it("four fenced stables in a pasture score +4 and are never removed", () => {
    const s = mkGame(2, 7);
    const p = s.players[0]!;
    // enclose the whole top row (cells 0..4) as one big pasture.
    p.fences = [
      hEdge(0, 0), hEdge(0, 1), hEdge(0, 2), hEdge(0, 3), hEdge(0, 4), // top border
      hEdge(1, 0), hEdge(1, 1), hEdge(1, 2), hEdge(1, 3), hEdge(1, 4), // bottom of row 0
      vEdge(0, 0), vEdge(0, 5), // left & right borders of row 0
    ];
    const lay = computePastures(p.spaces, p.fences);
    expect(lay.pastures).toHaveLength(1);
    expect(lay.pastures[0]!.cells).toEqual([0, 1, 2, 3, 4]);
    p.spaces[0]!.stable = true;
    p.spaces[1]!.stable = true;
    p.spaces[2]!.stable = true;
    p.spaces[3]!.stable = true;
    expect(catPts(s, 0, "Fenced stables")).toBe(4);
  });
});
