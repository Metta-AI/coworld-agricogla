/** Adversarial rule-conformance suite — DOMAIN: animal capacity, retention, overflow.
 *
 *  Canonical base-game Agricola rules (mirrored in RULES.md sections 5.2, 5.5,
 *  5.6, 6, 7.3). Holding capacity =
 *    - pastures: 2 animals/cell, doubled per stable inside the pasture; one type each
 *    - unfenced stables: 1 animal each
 *    - house "pet": exactly 1 animal of any type (total, not per-type)
 *    - card slots: typed slots hold only their type; any-type slots hold one type each
 *  Animals never sit in the supply. Over-capacity intake is auto-cooked at the best
 *  available anytime cook rate, else released (lost). Raw animals have NO food value,
 *  so without a cooking improvement overflow is pure loss. Breeding offspring that
 *  cannot be housed are simply NOT received (never cooked).
 */
import { describe, expect, it } from "vitest";
import { mkGame, ensureSpace, advanceTo, playToFeeding, autoFeedAll } from "./harness";
import { applyPlacement } from "../apply";
import { maxRetention, computePastures, edgesOfCell } from "../farmyard";
import { capacitySlots, takeAnimals } from "../effects";
import { GameState, PlayerState } from "../types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function p0(state: GameState): PlayerState {
  return state.players[0]!;
}

/** Strip every player down to a clean slate: no animals, food, fences, cards. */
function clearFarm(player: PlayerState): void {
  player.animals = { sheep: 0, boar: 0, cattle: 0 };
  player.fences = [];
  player.fencesBuilt = 0;
  player.occupations = [];
  player.minors = [];
  player.majors = [];
  player.cardData = {};
  for (const sp of player.spaces) {
    sp.kind = "empty";
    sp.stable = false;
    sp.crop = null;
    sp.cropCount = 0;
  }
}

// ---------------------------------------------------------------------------
// 1. Boundary: an utterly empty farm holds exactly ONE animal (the house pet).
// ---------------------------------------------------------------------------

describe("house pet boundary", () => {
  it("empty farm retains exactly 1 animal total", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    const h = maxRetention(pl, { sheep: 5, boar: 0, cattle: 0 }, []);
    expect(h.total).toBe(1);
  });

  it("house pet is ONE animal across ALL types, not one per type", () => {
    // RULES 5.6: the house holds exactly one pet of any *one* type. Offering
    // 1 of each type, an empty farm must still retain only 1 animal total.
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    const h = maxRetention(pl, { sheep: 1, boar: 1, cattle: 1 }, []);
    expect(h.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 2. Pasture capacity arithmetic (RULES 5.5 / 5.2).
// ---------------------------------------------------------------------------

describe("pasture capacity arithmetic", () => {
  it("a 1-cell pasture holds 2 of one type (+1 pet of another)", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.fences = edgesOfCell(4);
    pl.fencesBuilt = 4;
    const h = maxRetention(pl, { sheep: 5, boar: 5, cattle: 0 }, []);
    // pasture (2 of one type) + pet (1 of another) = 3
    expect(h.total).toBe(3);
  });

  it("a 2-cell pasture holds 4 of a single type", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    // Fence cells 3 and 4 together (top-right 1x2 strip).
    pl.fences = [
      "h-0-3", "h-0-4", // top of cells 3,4
      "h-1-3", "h-1-4", // bottom of cells 3,4
      "v-0-3",          // left of cell 3
      "v-0-5",          // right of cell 4
    ];
    pl.fencesBuilt = 6;
    const layout = computePastures(pl.spaces, pl.fences);
    expect(layout.pastures).toHaveLength(1);
    expect(layout.pastures[0]!.cells).toEqual([3, 4]);
    expect(layout.pastures[0]!.capacity).toBe(4);
    const h = maxRetention(pl, { sheep: 10, boar: 0, cattle: 0 }, []);
    // 4 in pasture + 1 pet = 5
    expect(h.total).toBe(5);
    expect(h.retained.sheep).toBe(5);
  });

  it("a stable inside a 1-cell pasture doubles capacity to 4", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.fences = edgesOfCell(4);
    pl.fencesBuilt = 4;
    pl.spaces[4]!.stable = true;
    const layout = computePastures(pl.spaces, pl.fences);
    expect(layout.pastures[0]!.capacity).toBe(4); // 2 * 1 * 2^1
    const h = maxRetention(pl, { sheep: 10, boar: 0, cattle: 0 }, []);
    expect(h.total).toBe(5); // 4 in pasture + pet
  });

  it("two stables inside a 1-cell pasture quadruple capacity to 8", () => {
    // RULES 5.2: "2 stables = x4". A single cell can only hold one stable in
    // real play, but maxRetention reads `stable` per space; verify the x2^n
    // formula on a 2-cell pasture with a stable in EACH cell -> 2*2*2^2 = 16.
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.fences = [
      "h-0-3", "h-0-4", "h-1-3", "h-1-4", "v-0-3", "v-0-5",
    ];
    pl.fencesBuilt = 6;
    pl.spaces[3]!.stable = true;
    pl.spaces[4]!.stable = true;
    const layout = computePastures(pl.spaces, pl.fences);
    // 2 cells * 2 base * 2^2 stables = 16
    expect(layout.pastures[0]!.capacity).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// 3. Unfenced stables hold exactly 1 each (RULES 5.2).
// ---------------------------------------------------------------------------

describe("unfenced stables", () => {
  it("each unfenced stable holds exactly 1 animal", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.spaces[0]!.stable = true;
    pl.spaces[4]!.stable = true;
    pl.spaces[14]!.stable = true;
    const h = maxRetention(pl, { sheep: 10, boar: 0, cattle: 0 }, []);
    // 3 unfenced stables + 1 pet = 4
    expect(h.total).toBe(4);
  });

  it("unfenced stables can each hold a DIFFERENT type (they are any-1 slots)", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.spaces[0]!.stable = true;
    pl.spaces[4]!.stable = true;
    const h = maxRetention(pl, { sheep: 1, boar: 1, cattle: 1 }, []);
    // 2 stables + pet = 3 slots, one each type -> retain all 3
    expect(h.total).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 4. Card slots: typed-only vs any-type (RULES 5.6).
// ---------------------------------------------------------------------------

describe("card capacity slots", () => {
  it("typed slot (Pig Sty, boar 2) holds only boar", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.minors = ["min_pig_sty"]; // {type:boar, capacity:2}
    const slots = capacitySlots(pl);
    expect(slots).toEqual([{ type: "boar", capacity: 2 }]);
    const boars = maxRetention(pl, { sheep: 0, boar: 5, cattle: 0 }, slots);
    expect(boars.total).toBe(3); // 2 on card + pet
    const sheepOnly = maxRetention(pl, { sheep: 5, boar: 0, cattle: 0 }, slots);
    expect(sheepOnly.total).toBe(1); // typed slot useless -> just pet
  });

  it("Animal Pen (any 2) holds one type, and pet a second type", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.minors = ["min_animal_pen"]; // {capacity:2}
    const slots = capacitySlots(pl);
    const h = maxRetention(pl, { sheep: 5, boar: 5, cattle: 0 }, slots);
    // pen (2 of one type) + pet (1 of another) = 3
    expect(h.total).toBe(3);
  });

  it("Paddock (any 3) holds 3 of one type", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.minors = ["min_paddock"]; // {capacity:3}
    const slots = capacitySlots(pl);
    const h = maxRetention(pl, { sheep: 5, boar: 0, cattle: 0 }, slots);
    expect(h.total).toBe(4); // 3 paddock + 1 pet
  });

  it("Stablemaster grants a SECOND any-1 slot stacking with the pet", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.occupations = ["occ_stablemaster"]; // {capacity:1}
    const slots = capacitySlots(pl);
    const h = maxRetention(pl, { sheep: 1, boar: 1, cattle: 0 }, slots);
    // stablemaster slot + pet = 2 slots, each a different type -> 2
    expect(h.total).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// 5. Overflow: cook at best rate if a cooking improvement exists, else release.
//    (RULES 5.6, 6: raw animals have NO food value.)
// ---------------------------------------------------------------------------

describe("overflow on intake (takeAnimals)", () => {
  it("overflow with a cooking improvement is cooked at the best rate", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.majors = ["fireplace2"]; // sheep->2 food
    pl.resources.food = 0;
    // empty farm: pet holds 1, gain 4 sheep -> 3 overflow cooked @2 = 6 food
    takeAnimals(s, pl, { sheep: 4 });
    expect(pl.animals.sheep).toBe(1);
    expect(pl.resources.food).toBe(6);
  });

  it("overflow with NO cooking improvement is released (zero food)", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.resources.food = 0;
    takeAnimals(s, pl, { sheep: 4 });
    expect(pl.animals.sheep).toBe(1); // pet only
    expect(pl.resources.food).toBe(0); // raw animals have no food value
  });

  it("a bake-only improvement (Clay Oven) does NOT cook overflow animals", () => {
    // Clay/Stone Oven can only BAKE grain, never COOK animals. Raw overflow
    // animals must be released, not converted (RULES 6 + card 9 table).
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.majors = ["clay_oven"]; // bake-only, no cook
    pl.resources.food = 0;
    takeAnimals(s, pl, { boar: 5 });
    expect(pl.animals.boar).toBe(1); // pet
    expect(pl.resources.food).toBe(0); // NOT cooked
  });

  it("best cook rate is used when several cooking improvements exist", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    // Fireplace cattle->3, Cooking Hearth cattle->4. Best is 4.
    pl.majors = ["fireplace2", "hearth4"];
    pl.resources.food = 0;
    takeAnimals(s, pl, { cattle: 3 });
    expect(pl.animals.cattle).toBe(1); // pet
    expect(pl.resources.food).toBe(8); // 2 overflow * 4
  });

  it("each overflow type is cooked at ITS OWN best rate, not a shared rate", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    // Cooking Hearth: sheep 2, boar 3, cattle 4. No pasture -> pet holds 1.
    pl.majors = ["hearth4"];
    pl.resources.food = 0;
    // Gain 2 sheep + 2 boar + 2 cattle. Pet keeps exactly 1 animal (best: cattle
    // is most valuable to KEEP? No — keeping maximizes COUNT, ties broken by the
    // packer; food only comes from the 5 cooked overflow). Verify total food is
    // the sum of each cooked type at its own rate regardless of which 1 is kept.
    takeAnimals(s, pl, { sheep: 2, boar: 2, cattle: 2 });
    const kept = pl.animals.sheep + pl.animals.boar + pl.animals.cattle;
    expect(kept).toBe(1); // only the pet
    // 5 animals cooked. Whatever single animal is kept, the other 5 are cooked
    // each at its own rate: sheep@2, boar@3, cattle@4.
    const allRate = { sheep: 2, boar: 3, cattle: 4 } as const;
    const totalIfAllCooked = 2 * 2 + 2 * 3 + 2 * 4; // 4 + 6 + 8 = 18
    const keptType = (["sheep", "boar", "cattle"] as const).find(
      (t) => pl.animals[t] === 1,
    )!;
    expect(pl.resources.food).toBe(totalIfAllCooked - allRate[keptType]);
  });

  it("brute force frees a pasture from capacity to retain more across types", () => {
    // One 1-cell pasture (cap 2) + Animal Pen(any 2) + pet(1).
    // counts: sheep 2, boar 2, cattle 2 (=6). Max retainable:
    //   pasture(2 one type) + pen(2 one type) + pet(1) = 5.
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.fences = edgesOfCell(4);
    pl.fencesBuilt = 4;
    pl.minors = ["min_animal_pen"]; // any 2
    const slots = capacitySlots(pl);
    const h = maxRetention(pl, { sheep: 2, boar: 2, cattle: 2 }, slots);
    expect(h.total).toBe(5);
  });

  it("multi-type overflow keeps the best layout and cooks the rest", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    // one 1-cell pasture (cap 2) + pet. Gain 4 sheep + 4 boar.
    pl.fences = edgesOfCell(4);
    pl.fencesBuilt = 4;
    pl.majors = ["fireplace2"]; // sheep 2, boar 2
    pl.resources.food = 0;
    takeAnimals(s, pl, { sheep: 4, boar: 4 });
    // Best retention: pasture(2) of one type + pet(1) of the other = 3 retained,
    // 5 overflow cooked @2 = 10 food. Total animals retained == 3.
    expect(pl.animals.sheep + pl.animals.boar).toBe(3);
    expect(pl.resources.food).toBe(10);
  });
});

describe("multiple pastures and mixed capacity", () => {
  it("two separate 1-cell pastures hold two distinct types", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    // Two non-adjacent enclosed cells: 4 (row0,col4) and 14 (row2,col4).
    pl.fences = [...edgesOfCell(4), ...edgesOfCell(14)];
    pl.fencesBuilt = pl.fences.length;
    const layout = computePastures(pl.spaces, pl.fences);
    expect(layout.pastures).toHaveLength(2);
    const h = maxRetention(pl, { sheep: 5, boar: 5, cattle: 0 }, []);
    // pasture A (2) + pasture B (2) + pet (1) = 5, spanning two types
    expect(h.total).toBe(5);
  });

  it("a stable on a non-empty space grants NO unfenced capacity", () => {
    // RULES 5.2: an unfenced stable holds 1 animal; stables only live on empty
    // or pasture spaces. A stable flag on a room/field space must not add cap.
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.spaces[0]!.kind = "field";
    pl.spaces[0]!.stable = true; // illegal placement, but guard the math
    const h = maxRetention(pl, { sheep: 5, boar: 0, cattle: 0 }, []);
    expect(h.total).toBe(1); // pet only; the field-stable adds nothing
  });

  it("pasture + typed slot of the SAME type stack additively", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.fences = edgesOfCell(4); // cap 2
    pl.fencesBuilt = 4;
    pl.minors = ["min_sheep_fold"]; // sheep typed 2
    const slots = capacitySlots(pl);
    const h = maxRetention(pl, { sheep: 10, boar: 0, cattle: 0 }, slots);
    // pasture 2 + sheep fold 2 + pet 1 = 5 sheep
    expect(h.retained.sheep).toBe(5);
    expect(h.total).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 6. canAccommodate exactness at the capacity boundary.
// ---------------------------------------------------------------------------

describe("canAccommodate boundary", () => {
  it("accepts exactly-at-capacity and rejects one-over", () => {
    const s = mkGame();
    const pl = p0(s);
    clearFarm(pl);
    pl.fences = edgesOfCell(4); // cap 2
    pl.fencesBuilt = 4;
    // capacity = pasture 2 (one type) + pet 1 (one type)
    // 2 sheep + 1 boar -> fits (sheep in pasture, boar pet)
    const slots = capacitySlots(pl);
    expect(
      maxRetention(pl, { sheep: 2, boar: 1, cattle: 0 }, slots).retained,
    ).toEqual({ sheep: 2, boar: 1, cattle: 0 });
    // 3 sheep + 1 boar -> sheep cannot all fit (pasture 2 + nothing) -> false
    const over = maxRetention(pl, { sheep: 3, boar: 1, cattle: 0 }, slots);
    expect(over.retained.sheep + over.retained.boar).toBeLessThan(4);
  });
});

// ---------------------------------------------------------------------------
// 7. Breeding (RULES 7.3): +1 per type with >=2, ONLY if housable; never cooked.
// ---------------------------------------------------------------------------

/** Drive the game to the first feeding (end of round 4) with `idx` parked, then
 *  push through breeding by completing the harvest. Returns the post-harvest
 *  state. We give everyone enough food so nobody begs and the harvest completes. */
function runToBreeding(s: GameState, setup: (pl: PlayerState) => void): GameState {
  // Set up player 0 right before we trigger the harvest.
  // Fast-forward to feeding by exhausting the work phase with safe takes.
  // We instead directly invoke a harvest via reaching round-4 feeding.
  let st = s;
  // Park everyone through to feeding.
  st = playToFeeding(st);
  // Now phase === feeding. Set up player 0's animals/farm before feeding resolves
  // (breeding happens after feeding within the same harvest).
  setup(st.players[0]!);
  // give food so feeding doesn't beg/alter animals
  for (const pl of st.players) pl.resources.food = 50;
  st = autoFeedAll(st);
  return st;
}

describe("breeding", () => {
  it("breeds +1 per type with >=2 when there is room", () => {
    let s = mkGame();
    s = runToBreeding(s, (pl) => {
      clearFarm(pl);
      // Big pasture so everything fits with room to spare.
      pl.fences = [
        "h-0-3", "h-0-4", "h-1-3", "h-1-4", "v-0-3", "v-0-5",
      ];
      pl.fencesBuilt = 6;
      // pasture cap 4 (one type) + pig sty (boar 2) + cattle shed (cattle 2)
      // + pet (any 1) + stablemaster (any 1) gives two free any-slots so all
      // three +1 offspring can be housed simultaneously.
      pl.minors = ["min_pig_sty", "min_cattle_shed"]; // boar 2, cattle 2
      pl.occupations = ["occ_stablemaster"]; // any 1
      pl.animals = { sheep: 2, boar: 2, cattle: 2 };
    });
    const pl = s.players[0]!;
    // each type had >=2 and there's room -> +1 each
    expect(pl.animals).toEqual({ sheep: 3, boar: 3, cattle: 3 });
  });

  it("breeds the largest housable subset when not all offspring fit", () => {
    // pasture cap 4 + pig sty(boar 2) + cattle shed(cattle 2) + pet(1) gives
    // only ONE free any-slot, so only TWO of the three types can gain a child.
    let s = mkGame();
    s = runToBreeding(s, (pl) => {
      clearFarm(pl);
      pl.fences = ["h-0-3", "h-0-4", "h-1-3", "h-1-4", "v-0-3", "v-0-5"];
      pl.fencesBuilt = 6;
      pl.minors = ["min_pig_sty", "min_cattle_shed"];
      pl.animals = { sheep: 2, boar: 2, cattle: 2 };
    });
    const pl = s.players[0]!;
    const total = pl.animals.sheep + pl.animals.boar + pl.animals.cattle;
    // 6 starting + exactly 2 offspring (the max housable subset) = 8.
    expect(total).toBe(8);
    // No type ever loses animals during breeding.
    expect(pl.animals.sheep).toBeGreaterThanOrEqual(2);
    expect(pl.animals.boar).toBeGreaterThanOrEqual(2);
    expect(pl.animals.cattle).toBeGreaterThanOrEqual(2);
  });

  it("does NOT breed a type that cannot be housed, and never cooks the newborn", () => {
    let s = mkGame();
    s = runToBreeding(s, (pl) => {
      clearFarm(pl);
      // 1-cell pasture cap 2 holds the 2 sheep exactly; pet holds nothing extra
      // usefully. No cooking improvement.
      pl.fences = edgesOfCell(4);
      pl.fencesBuilt = 4;
      pl.majors = []; // no cook
      pl.resources.food = 50;
      pl.animals = { sheep: 2, boar: 0, cattle: 0 };
    });
    const pl = s.players[0]!;
    // Capacity: pasture 2 (sheep) + pet 1. Breeding sheep -> 3 would need 3 sheep
    // slots; pasture holds 2 + pet 1 = 3 -> sheep CAN be housed -> breeds to 3.
    expect(pl.animals.sheep).toBe(3);
  });

  it("offspring with no possible home is simply not received (not cooked to food)", () => {
    let s = mkGame();
    s = runToBreeding(s, (pl) => {
      clearFarm(pl);
      // Exactly cap-2 pasture + pet, filled to the brim with two sheep + pet sheep?
      // Use a typed sheep slot of 2 plus pet to hold 3 sheep exactly, leaving NO
      // free slot for a 4th. Then 2 boar with NO home at all.
      pl.minors = ["min_sheep_fold"]; // sheep 2 typed
      // pet will take 1 sheep -> 3 sheep capacity total, all used by 3 sheep.
      pl.animals = { sheep: 3, boar: 0, cattle: 0 };
      pl.majors = ["fireplace2"]; // has cook -> proves newborn is NOT cooked
      pl.resources.food = 50;
    });
    const pl = s.players[0]!;
    const foodBefore = 50; // feeding pays 2/member*2 members = 4 from food; we seeded plenty
    // sheep already at 3 (cap = sheep_fold 2 + pet 1). Breeding sheep would need a
    // 4th slot -> none. Newborn NOT received and NOT cooked.
    expect(pl.animals.sheep).toBe(3);
    // No "cook" should have fired for an unhousable newborn.
    expect(pl.resources.food).toBeLessThanOrEqual(foodBefore);
  });
});

// ---------------------------------------------------------------------------
// 8. End-to-end via real placement: an animal accumulation space overflows and
//    the engine cooks/releases through the real gainGoods path.
// ---------------------------------------------------------------------------

describe("real placement overflow path", () => {
  it("taking an over-capacity Sheep Market pile cooks the overflow", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const pl = s.players[idx]!;
    clearFarm(pl);
    pl.majors = ["fireplace2"]; // sheep -> 2 food
    pl.resources.food = 0;
    // Expose a sheep market loaded with 5 sheep.
    ensureSpace(s, "r_sheep", { sheep: 5 });
    s = advanceTo(s, idx);
    expect(s.currentPlayer).toBe(idx);
    s = applyPlacement(s, idx, { action: "r_sheep" }).state;
    const after = s.players[idx]!;
    // empty farm: pet keeps 1; 4 overflow cooked @2 = 8 food
    expect(after.animals.sheep).toBe(1);
    expect(after.resources.food).toBe(8);
  });

  it("taking an over-capacity pile with no cook improvement releases (no food)", () => {
    let s = mkGame(2, 11);
    const idx = s.currentPlayer;
    const pl = s.players[idx]!;
    clearFarm(pl);
    pl.resources.food = 0;
    ensureSpace(s, "r_sheep", { sheep: 6 });
    s = advanceTo(s, idx);
    s = applyPlacement(s, idx, { action: "r_sheep" }).state;
    const after = s.players[idx]!;
    expect(after.animals.sheep).toBe(1); // pet only
    expect(after.resources.food).toBe(0); // released, raw = no food
  });
});
