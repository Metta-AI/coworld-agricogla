import { describe, expect, it } from "vitest";
import {
  computePastures,
  edgesOfCell,
  hEdge,
  maxRetention,
  vEdge,
  validateFencePlan,
} from "./farmyard";
import { FarmSpace, NUM_SPACES, PlayerState } from "./types";

function emptyFarm(): FarmSpace[] {
  return Array.from({ length: NUM_SPACES }, () => ({
    kind: "empty" as const,
    stable: false,
    crop: null,
    cropCount: 0,
  }));
}

function testPlayer(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    idx: 0,
    name: "Test",
    color: "#000",
    resources: { wood: 0, clay: 0, reed: 0, stone: 0, grain: 0, vegetable: 0, food: 0 },
    animals: { sheep: 0, boar: 0, cattle: 0 },
    spaces: emptyFarm(),
    fences: [],
    fencesBuilt: 0,
    houseMaterial: "wood",
    family: [],
    beggingCards: 0,
    startingPlayerMarker: false,
    handOccupations: [],
    handMinors: [],
    occupations: [],
    minors: [],
    majors: [],
    cardData: {},
    ...overrides,
  };
}

/** Edges fully enclosing cell 4 (row 0, col 4). */
const cell4Fence = edgesOfCell(4);

describe("pastures", () => {
  it("no fences means no pastures", () => {
    const layout = computePastures(emptyFarm(), []);
    expect(layout.pastures).toHaveLength(0);
  });

  it("a fully fenced single cell is one pasture of capacity 2", () => {
    const layout = computePastures(emptyFarm(), cell4Fence);
    expect(layout.pastures).toHaveLength(1);
    expect(layout.pastures[0]!.cells).toEqual([4]);
    expect(layout.pastures[0]!.capacity).toBe(2);
  });

  it("a stable doubles pasture capacity", () => {
    const spaces = emptyFarm();
    spaces[4]!.stable = true;
    const layout = computePastures(spaces, cell4Fence);
    expect(layout.pastures[0]!.capacity).toBe(4);
  });

  it("an unclosed region is not a pasture (board edge is no fence)", () => {
    // Leave the top border edge out.
    const edges = cell4Fence.filter((e) => e !== hEdge(0, 4));
    const layout = computePastures(emptyFarm(), edges);
    expect(layout.pastures).toHaveLength(0);
  });

  it("a 2x1 pasture holds 4 animals", () => {
    const edges = [hEdge(0, 3), hEdge(0, 4), hEdge(1, 3), hEdge(1, 4), vEdge(0, 3), vEdge(0, 5)];
    const layout = computePastures(emptyFarm(), edges);
    expect(layout.pastures).toHaveLength(1);
    expect(layout.pastures[0]!.cells).toEqual([3, 4]);
    expect(layout.pastures[0]!.capacity).toBe(4);
  });
});

describe("validateFencePlan", () => {
  it("accepts a legal single-cell pasture", () => {
    const result = validateFencePlan(testPlayer(), cell4Fence);
    expect(result.ok).toBe(true);
    expect(result.layout!.pastures).toHaveLength(1);
  });

  it("rejects fences that enclose nothing", () => {
    const result = validateFencePlan(testPlayer(), [hEdge(0, 4)]);
    expect(result.ok).toBe(false);
  });

  it("rejects enclosing a room", () => {
    const player = testPlayer();
    player.spaces[4]!.kind = "room";
    const result = validateFencePlan(player, cell4Fence);
    expect(result.ok).toBe(false);
  });

  it("rejects more than 15 fences", () => {
    const player = testPlayer({ fencesBuilt: 12 });
    const result = validateFencePlan(player, cell4Fence);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/15/);
  });

  it("rejects disconnected new pastures once one exists", () => {
    const player = testPlayer({ fences: cell4Fence, fencesBuilt: 4 });
    // Cell 10 (row 2, col 0) is far from cell 4.
    const result = validateFencePlan(player, edgesOfCell(10));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/border/);
  });

  it("allows subdividing an existing pasture", () => {
    // 2x1 pasture over cells 3,4 then a fence between them.
    const player = testPlayer({
      fences: [hEdge(0, 3), hEdge(0, 4), hEdge(1, 3), hEdge(1, 4), vEdge(0, 3), vEdge(0, 5)],
      fencesBuilt: 6,
    });
    const result = validateFencePlan(player, [vEdge(0, 4)]);
    expect(result.ok).toBe(true);
    expect(result.layout!.pastures).toHaveLength(2);
  });
});

describe("maxRetention", () => {
  it("house holds one pet", () => {
    const holding = maxRetention(testPlayer(), { sheep: 2, boar: 0, cattle: 0 }, []);
    expect(holding.total).toBe(1);
  });

  it("pasture holds one type only", () => {
    const player = testPlayer({ fences: cell4Fence, fencesBuilt: 4 });
    const holding = maxRetention(player, { sheep: 2, boar: 2, cattle: 0 }, []);
    // Pasture (2) for one type + pet (1) for the other.
    expect(holding.total).toBe(3);
  });

  it("unfenced stables hold 1 each", () => {
    const player = testPlayer();
    player.spaces[0]!.stable = true;
    player.spaces[4]!.stable = true;
    const holding = maxRetention(player, { sheep: 3, boar: 0, cattle: 0 }, []);
    expect(holding.total).toBe(3); // 2 stables + pet
  });

  it("typed card slots only hold their type", () => {
    const holding = maxRetention(
      testPlayer(),
      { sheep: 0, boar: 3, cattle: 0 },
      [{ type: "boar", capacity: 2 }],
    );
    expect(holding.total).toBe(3); // 2 on card + pet
    const wrongType = maxRetention(
      testPlayer(),
      { sheep: 3, boar: 0, cattle: 0 },
      [{ type: "boar", capacity: 2 }],
    );
    expect(wrongType.total).toBe(1);
  });
});
