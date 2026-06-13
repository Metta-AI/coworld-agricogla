/** Adversarial rule-conformance suite — domain: Rooms & renovation.
 *
 *  Canonical base-game Agricola rules under test:
 *   - Rooms cost 5 of the house material + 2 reed each (wood/clay/stone).
 *   - New rooms must be orthogonally adjacent to an existing room and built on an
 *     empty, non-stable, non-pasture space.
 *   - Building multiple rooms pays per room; adjacency may chain through a
 *     just-built room.
 *   - Renovation upgrades the WHOLE house exactly one step (wood->clay->stone),
 *     costs 1 unit of the NEW material PER existing room + exactly 1 reed total.
 *   - A stone house cannot be renovated.
 *   - Discounts (Carpenter -2 wood, Thatcher -1 reed, etc.) never drop a cost
 *     below 0 and only apply to the matching material.
 */
import { describe, expect, it } from "vitest";

import { legalRoomSpaces, renovationCost, roomCost, RuleError } from "../apply";
import { edgesOfCell } from "../farmyard";
import { mkGame, place, cur, ensureSpace } from "./harness";
import { GameState, PlayerState } from "../types";

/** Spaces 5 and 10 are the two starting wooden rooms (left column rows 1,2). */
const ROOM_A = 5;

/** The player who will actually act when we call `place()` (seat order /
 *  starting-player marker means it is NOT necessarily index 0). All scenario
 *  mutations target this player so the placement path sees them. */
function cur0(state: GameState): PlayerState {
  return cur(state);
}

/** Give player 0 a large stockpile so cost arithmetic is the only constraint. */
function stock(p: PlayerState): void {
  p.resources.wood = 100;
  p.resources.clay = 100;
  p.resources.stone = 100;
  p.resources.reed = 100;
}

// ---------------------------------------------------------------------------
// roomCost arithmetic
// ---------------------------------------------------------------------------

describe("roomCost — base arithmetic", () => {
  it("wooden room costs exactly 5 wood + 2 reed", () => {
    const s = mkGame();
    const cost = roomCost(cur0(s));
    expect(cost.wood).toBe(5);
    expect(cost.reed).toBe(2);
    expect(cost.clay ?? 0).toBe(0);
    expect(cost.stone ?? 0).toBe(0);
  });

  it("clay room costs exactly 5 clay + 2 reed (material follows house)", () => {
    const s = mkGame();
    cur0(s).houseMaterial = "clay";
    const cost = roomCost(cur0(s));
    expect(cost.clay).toBe(5);
    expect(cost.reed).toBe(2);
    expect(cost.wood ?? 0).toBe(0);
  });

  it("stone room costs exactly 5 stone + 2 reed", () => {
    const s = mkGame();
    cur0(s).houseMaterial = "stone";
    const cost = roomCost(cur0(s));
    expect(cost.stone).toBe(5);
    expect(cost.reed).toBe(2);
  });
});

describe("roomCost — discounts", () => {
  it("Carpenter reduces wooden room wood cost by 2 (to 3 wood + 2 reed)", () => {
    const s = mkGame();
    cur0(s).occupations.push("occ_carpenter");
    const cost = roomCost(cur0(s));
    expect(cost.wood).toBe(3);
    expect(cost.reed).toBe(2);
  });

  it("Carpenter does NOT discount a clay room (wrong material)", () => {
    const s = mkGame();
    cur0(s).houseMaterial = "clay";
    cur0(s).occupations.push("occ_carpenter");
    const cost = roomCost(cur0(s));
    expect(cost.clay).toBe(5);
    expect(cost.reed).toBe(2);
  });

  it("Thatcher reduces reed cost by 1 regardless of material (to 5 wood + 1 reed)", () => {
    const s = mkGame();
    cur0(s).occupations.push("occ_thatcher");
    const cost = roomCost(cur0(s));
    expect(cost.wood).toBe(5);
    expect(cost.reed).toBe(1);
  });

  it("discount never drops a cost below 0", () => {
    // Stack many reed discounts; reed cost must clamp at 0, not go negative.
    const s = mkGame();
    const p = cur0(s);
    // Thatcher (-1 reed) plus three minor wooden-hut reed-style discounts:
    // we just push Thatcher three times conceptually via several reed cards.
    p.occupations.push("occ_thatcher");
    // Also add the three material -1 reed-ish minors if present; otherwise rely
    // on a second Thatcher-equivalent by pushing it twice (same id is fine for
    // the cost computation which iterates playedCards).
    p.occupations.push("occ_thatcher");
    p.occupations.push("occ_thatcher");
    const cost = roomCost(p);
    expect(cost.reed).toBe(0);
    expect(cost.reed).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// Building rooms — adjacency / legality
// ---------------------------------------------------------------------------

describe("buildRooms — adjacency & placement legality", () => {
  it("legalRoomSpaces are exactly the empty cells orthogonally adjacent to a room", () => {
    const s = mkGame();
    const legal = new Set(legalRoomSpaces(cur0(s)));
    // Rooms at 5 and 10. Neighbours: 0(of5), 6(of5), 11(of10), 6(of10).
    // 5's neighbours: 0, 10(room), 6. 10's neighbours: 5(room), 6, 11.
    // Empty adjacent cells: 0, 6, 11.
    expect(legal).toEqual(new Set([0, 6, 11]));
  });

  it("building a room on a non-adjacent empty space is rejected", () => {
    const s = mkGame();
    stock(cur0(s));
    // Space 3 (top row, far from any room) is not adjacent to a room.
    expect(() => place(s, { action: "farm_expansion", rooms: [3], stables: [] })).toThrow(
      RuleError,
    );
  });

  it("building a room on an existing room is rejected", () => {
    const s = mkGame();
    stock(cur0(s));
    expect(() => place(s, { action: "farm_expansion", rooms: [ROOM_A], stables: [] })).toThrow(
      RuleError,
    );
  });

  it("a single adjacent room build succeeds and deducts 5 wood + 2 reed", () => {
    const s = mkGame();
    const p = cur0(s);
    stock(p);
    const wood0 = p.resources.wood;
    const reed0 = p.resources.reed;
    const s2 = place(s, { action: "farm_expansion", rooms: [6], stables: [] });
    const p2 = s2.players[s.currentPlayer]!;
    expect(p2.spaces[6]!.kind).toBe("room");
    expect(p2.resources.wood).toBe(wood0 - 5);
    expect(p2.resources.reed).toBe(reed0 - 2);
  });
});

describe("buildRooms — chaining adjacency through a just-built room", () => {
  it("two rooms can chain: build 6 (adjacent to 5), then 7 (adjacent to 6)", () => {
    const s = mkGame();
    const p = cur0(s);
    stock(p);
    // 7 is NOT adjacent to any starting room, but IS adjacent to 6.
    const s2 = place(s, { action: "farm_expansion", rooms: [6, 7], stables: [] });
    const p2 = s2.players[s.currentPlayer]!;
    expect(p2.spaces[6]!.kind).toBe("room");
    expect(p2.spaces[7]!.kind).toBe("room");
  });

  it("order matters: building 7 before 6 (no chain yet) is rejected", () => {
    const s = mkGame();
    stock(cur0(s));
    // 7 alone is not adjacent to a room.
    expect(() =>
      place(s, { action: "farm_expansion", rooms: [7, 6], stables: [] }),
    ).toThrow(RuleError);
  });

  it("building N rooms pays N times the per-room cost", () => {
    const s = mkGame();
    const p = cur0(s);
    stock(p);
    const wood0 = p.resources.wood;
    const reed0 = p.resources.reed;
    const s2 = place(s, { action: "farm_expansion", rooms: [6, 7], stables: [] });
    const p2 = s2.players[s.currentPlayer]!;
    expect(p2.resources.wood).toBe(wood0 - 10); // 2 rooms * 5 wood
    expect(p2.resources.reed).toBe(reed0 - 4); // 2 rooms * 2 reed
  });
});

describe("buildRooms — cannot build on field/pasture/stable", () => {
  it("cannot build a room on a field", () => {
    const s = mkGame();
    const p = cur0(s);
    stock(p);
    p.spaces[6]!.kind = "field"; // adjacent to room 5, but it's a field
    expect(() => place(s, { action: "farm_expansion", rooms: [6], stables: [] })).toThrow(
      RuleError,
    );
  });

  it("cannot build a room on a space that holds a stable", () => {
    const s = mkGame();
    const p = cur0(s);
    stock(p);
    p.spaces[6]!.stable = true; // adjacent to room 5, but a stable sits there
    expect(() => place(s, { action: "farm_expansion", rooms: [6], stables: [] })).toThrow(
      RuleError,
    );
  });

  it("cannot build a room on a pasture cell", () => {
    const s = mkGame();
    const p = cur0(s);
    stock(p);
    // Fully enclose cell 6 (adjacent to room 5) so it becomes a pasture cell.
    p.fences = edgesOfCell(6);
    expect(legalRoomSpaces(p)).not.toContain(6);
    expect(() => place(s, { action: "farm_expansion", rooms: [6], stables: [] })).toThrow(
      RuleError,
    );
  });
});

describe("buildRooms — affordability", () => {
  it("rejects building when the player cannot pay", () => {
    const s = mkGame();
    const p = cur0(s);
    p.resources.wood = 4; // need 5
    p.resources.reed = 2;
    expect(() => place(s, { action: "farm_expansion", rooms: [6], stables: [] })).toThrow(
      RuleError,
    );
  });
});

// ---------------------------------------------------------------------------
// Renovation cost & legality
// ---------------------------------------------------------------------------

describe("renovationCost — scales with room count", () => {
  it("wood->clay with 2 rooms costs 2 clay + 1 reed (per room material, 1 reed total)", () => {
    const s = mkGame();
    const cost = renovationCost(cur0(s)); // 2 starting rooms
    expect(cost.clay).toBe(2);
    expect(cost.reed).toBe(1);
    expect(cost.wood ?? 0).toBe(0);
    expect(cost.stone ?? 0).toBe(0);
  });

  it("wood->clay with 4 rooms costs 4 clay + 1 reed (reed is NOT per room)", () => {
    const s = mkGame();
    const p = cur0(s);
    // Add two more rooms so the house has 4 rooms.
    p.spaces[0]!.kind = "room";
    p.spaces[6]!.kind = "room";
    const cost = renovationCost(p);
    expect(cost.clay).toBe(4);
    expect(cost.reed).toBe(1);
  });

  it("clay->stone with 3 rooms costs 3 stone + 1 reed", () => {
    const s = mkGame();
    const p = cur0(s);
    p.houseMaterial = "clay";
    p.spaces[0]!.kind = "room"; // 3 rooms total
    const cost = renovationCost(p);
    expect(cost.stone).toBe(3);
    expect(cost.reed).toBe(1);
  });
});

describe("renovate — driven through the round action", () => {
  it("wood house renovates to clay, paying clay-per-room + 1 reed", () => {
    const s = mkGame();
    const p = cur0(s);
    stock(p);
    ensureSpace(s, "r_renovate_improve");
    const clay0 = p.resources.clay;
    const reed0 = p.resources.reed;
    const s2 = place(s, { action: "r_renovate_improve" });
    const p2 = s2.players[s.currentPlayer]!;
    expect(p2.houseMaterial).toBe("clay");
    expect(p2.resources.clay).toBe(clay0 - 2); // 2 rooms
    expect(p2.resources.reed).toBe(reed0 - 1); // 1 reed total
  });

  it("renovation upgrades the WHOLE house — no individual room left at old material", () => {
    const s = mkGame();
    const p = cur0(s);
    stock(p);
    ensureSpace(s, "r_renovate_improve");
    const s2 = place(s, { action: "r_renovate_improve" });
    const p2 = s2.players[s.currentPlayer]!;
    // After renovation, building a new room must use the NEW material (clay).
    const cost = roomCost(p2);
    expect(p2.houseMaterial).toBe("clay");
    expect(cost.clay).toBe(5);
    expect(cost.wood ?? 0).toBe(0);
  });

  it("renovation rejected when player cannot afford the clay", () => {
    const s = mkGame();
    const p = cur0(s);
    p.resources.clay = 1; // need 2 for 2 rooms
    p.resources.reed = 5;
    ensureSpace(s, "r_renovate_improve");
    expect(() => place(s, { action: "r_renovate_improve" })).toThrow(RuleError);
  });

  it("renovation rejected when player has clay but no reed", () => {
    const s = mkGame();
    const p = cur0(s);
    p.resources.clay = 10;
    p.resources.reed = 0; // need 1 reed
    ensureSpace(s, "r_renovate_improve");
    expect(() => place(s, { action: "r_renovate_improve" })).toThrow(RuleError);
  });
});

describe("renovate — stone house cannot be renovated", () => {
  it("renovationCost throws for a stone house", () => {
    const s = mkGame();
    cur0(s).houseMaterial = "stone";
    expect(() => renovationCost(cur0(s))).toThrow(RuleError);
  });

  it("the renovate action on a stone house is rejected", () => {
    const s = mkGame();
    const p = cur0(s);
    p.houseMaterial = "stone";
    stock(p);
    ensureSpace(s, "r_renovate_improve");
    expect(() => place(s, { action: "r_renovate_improve" })).toThrow(RuleError);
  });
});

describe("renovate — one step only, clay->stone", () => {
  it("a clay house renovates to stone (not skipping a step)", () => {
    const s = mkGame();
    const p = cur0(s);
    p.houseMaterial = "clay";
    stock(p);
    ensureSpace(s, "r_renovate_improve");
    const stone0 = p.resources.stone;
    const reed0 = p.resources.reed;
    const s2 = place(s, { action: "r_renovate_improve" });
    const p2 = s2.players[s.currentPlayer]!;
    expect(p2.houseMaterial).toBe("stone");
    expect(p2.resources.stone).toBe(stone0 - 2); // 2 rooms
    expect(p2.resources.reed).toBe(reed0 - 1);
  });
});

// ---------------------------------------------------------------------------
// Boundary affordability & material-follows-house through the real path
// ---------------------------------------------------------------------------

describe("buildRooms — exact-resource boundaries", () => {
  it("building a wooden room with EXACTLY 5 wood + 2 reed succeeds and zeroes them", () => {
    const s = mkGame();
    const p = cur0(s);
    p.resources.wood = 5;
    p.resources.reed = 2;
    const s2 = place(s, { action: "farm_expansion", rooms: [6], stables: [] });
    const p2 = s2.players[s.currentPlayer]!;
    expect(p2.spaces[6]!.kind).toBe("room");
    expect(p2.resources.wood).toBe(0);
    expect(p2.resources.reed).toBe(0);
  });

  it("building a wooden room with 1 reed short is rejected (need 2 reed)", () => {
    const s = mkGame();
    const p = cur0(s);
    p.resources.wood = 5;
    p.resources.reed = 1; // one short
    expect(() => place(s, { action: "farm_expansion", rooms: [6], stables: [] })).toThrow(
      RuleError,
    );
  });

  it("two rooms need 10 wood + 4 reed; 9 wood is rejected", () => {
    const s = mkGame();
    const p = cur0(s);
    p.resources.wood = 9; // one short of 10
    p.resources.reed = 4;
    expect(() =>
      place(s, { action: "farm_expansion", rooms: [6, 7], stables: [] }),
    ).toThrow(RuleError);
  });
});

describe("buildRooms — stone rooms cost 5 stone + 2 reed via the real placement path", () => {
  it("a stone house builds a stone room for 5 stone + 2 reed (not wood)", () => {
    const s = mkGame();
    const p = cur0(s);
    p.houseMaterial = "stone";
    p.resources.stone = 5;
    p.resources.reed = 2;
    p.resources.wood = 0; // prove wood is NOT consumed
    const s2 = place(s, { action: "farm_expansion", rooms: [6], stables: [] });
    const p2 = s2.players[s.currentPlayer]!;
    expect(p2.spaces[6]!.kind).toBe("room");
    expect(p2.resources.stone).toBe(0);
    expect(p2.resources.reed).toBe(0);
    expect(p2.resources.wood).toBe(0);
  });

  it("a clay house builds a clay room for 5 clay + 2 reed via placement", () => {
    const s = mkGame();
    const p = cur0(s);
    p.houseMaterial = "clay";
    p.resources.clay = 5;
    p.resources.reed = 2;
    p.resources.wood = 0;
    const s2 = place(s, { action: "farm_expansion", rooms: [6], stables: [] });
    const p2 = s2.players[s.currentPlayer]!;
    expect(p2.spaces[6]!.kind).toBe("room");
    expect(p2.resources.clay).toBe(0);
    expect(p2.resources.reed).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Renovation cost scales correctly when room count differs from 2
// ---------------------------------------------------------------------------

describe("renovate — cost scales with current room count through the action", () => {
  it("renovating a 5-room wooden house costs 5 clay + 1 reed (reed flat)", () => {
    const s = mkGame();
    const p = cur0(s);
    // Build out to 5 rooms: starting 5,10 plus 0,6,11 (all adjacent/chained).
    p.spaces[0]!.kind = "room";
    p.spaces[6]!.kind = "room";
    p.spaces[11]!.kind = "room";
    expect(p.spaces.filter((sp) => sp.kind === "room").length).toBe(5);
    p.resources.clay = 5;
    p.resources.reed = 1;
    p.resources.wood = 0;
    ensureSpace(s, "r_renovate_improve");
    const s2 = place(s, { action: "r_renovate_improve" });
    const p2 = s2.players[s.currentPlayer]!;
    expect(p2.houseMaterial).toBe("clay");
    expect(p2.resources.clay).toBe(0); // 5 clay consumed
    expect(p2.resources.reed).toBe(0); // exactly 1 reed consumed
  });

  it("a 5-room wooden house renovation with only 4 clay is rejected", () => {
    const s = mkGame();
    const p = cur0(s);
    p.spaces[0]!.kind = "room";
    p.spaces[6]!.kind = "room";
    p.spaces[11]!.kind = "room";
    p.resources.clay = 4; // one short for 5 rooms
    p.resources.reed = 5;
    ensureSpace(s, "r_renovate_improve");
    expect(() => place(s, { action: "r_renovate_improve" })).toThrow(RuleError);
  });
});

// ---------------------------------------------------------------------------
// Farm Redevelopment (round-14 card): renovate, then fences
// ---------------------------------------------------------------------------

describe("r_redevelop — renovation legality", () => {
  it("a stone house cannot use Farm Redevelopment's renovation", () => {
    const s = mkGame();
    const p = cur0(s);
    p.houseMaterial = "stone";
    stock(p);
    ensureSpace(s, "r_redevelop");
    expect(() => place(s, { action: "r_redevelop", edges: [] })).toThrow(RuleError);
  });

  it("a wooden house redevelops to clay paying clay-per-room + 1 reed", () => {
    const s = mkGame();
    const p = cur0(s);
    stock(p);
    ensureSpace(s, "r_redevelop");
    const clay0 = p.resources.clay;
    const reed0 = p.resources.reed;
    const s2 = place(s, { action: "r_redevelop", edges: [] });
    const p2 = s2.players[s.currentPlayer]!;
    expect(p2.houseMaterial).toBe("clay");
    expect(p2.resources.clay).toBe(clay0 - 2); // 2 rooms
    expect(p2.resources.reed).toBe(reed0 - 1);
  });
});

// ---------------------------------------------------------------------------
// Material follows house: after renovation, new rooms cost the new material
// ---------------------------------------------------------------------------

describe("rooms follow house material after a renovation (multi-step)", () => {
  it("after wood->clay renovation, a newly built room consumes clay not wood", () => {
    const s = mkGame();
    const p = cur0(s);
    stock(p);
    // Step 1: renovate via the round card.
    ensureSpace(s, "r_renovate_improve");
    let s2 = place(s, { action: "r_renovate_improve" });
    expect(s2.players[s.currentPlayer]!.houseMaterial).toBe("clay");
    // Step 2: build a room on the SAME state object by re-exposing farm_expansion
    // for the same actor and forcing their turn.
    const idx = s.currentPlayer;
    s2.currentPlayer = idx;
    s2.phase = "work";
    s2.players[idx]!.family.forEach((m) => (m.placed = false));
    ensureSpace(s2, "farm_expansion");
    const clayBefore = s2.players[idx]!.resources.clay;
    const woodBefore = s2.players[idx]!.resources.wood;
    const s3 = place(s2, { action: "farm_expansion", rooms: [6], stables: [] });
    const p3 = s3.players[idx]!;
    expect(p3.spaces[6]!.kind).toBe("room");
    expect(p3.resources.clay).toBe(clayBefore - 5); // clay room
    expect(p3.resources.wood).toBe(woodBefore); // wood untouched
  });
});
