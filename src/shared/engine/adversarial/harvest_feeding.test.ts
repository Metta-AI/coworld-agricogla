import { describe, expect, it } from "vitest";
import {
  applyFeeding,
  computeAutoFeed,
  mkGame,
  place,
  ensureSpace,
  freeSafeTake,
  take,
} from "./harness";
import { foodNeeded, RuleError } from "../apply";
import { GameState, PlayerState } from "../types";

/** Put a player into a feeding decision in isolation. Mutates `state`. */
function enterFeeding(state: GameState, idx: number): void {
  state.phase = "feeding";
  state.toFeed = [idx];
}

/** Make space `index` a sown field of the given crop. */
function sowField(p: PlayerState, index: number, crop: "grain" | "vegetable"): void {
  p.spaces[index]!.kind = "field";
  p.spaces[index]!.crop = crop;
  p.spaces[index]!.cropCount = crop === "grain" ? 3 : 2;
}

/** Run the harvest field-phase + feeding for the current state by finishing the
 *  work phase. This drives the *real* harvest code path. The caller has set up
 *  fields/resources on player 0 before calling. */

describe("harvest field phase: yields and decrement", () => {
  it("removes exactly 1 grain from a grain field and decrements cropCount 3->2", () => {
    const s = mkGame(2, 11);
    const p = s.players[0]!;
    sowField(p, 1, "grain"); // cropCount 3
    p.resources.grain = 0;
    // Drive a harvest by playing to the round-4 feeding.
    let st = s;
    // finish work phase rounds 1..4 with safe takes
    while (st.phase === "work") {
      const free = st.actionSpaces.find(
        (a) => a.occupiedBy === null && ["forest", "clay_pit", "reed_bank", "fishing", "grain_seeds", "day_laborer"].includes(a.id),
      );
      if (!free) break;
      st = place(st, { action: free.id });
    }
    // After round-4 work, harvest field phase already ran into feeding.
    const p0 = st.players[0]!;
    const field = p0.spaces[1]!;
    // We harvested some number of times equal to harvests passed (round 4 only -> 1 harvest)
    // exactly 1 grain removed; cropCount 2 remaining; player gains exactly 1 grain per harvest.
    expect(field.kind).toBe("field");
    expect(field.cropCount).toBe(2);
    expect(field.crop).toBe("grain");
    expect(p0.resources.grain).toBe(1);
  });

  it("vegetable field yields 1 veg and clears crop after 2 harvests (2->1->0)", () => {
    // Directly exercise startHarvest twice by mutating then driving harvests.
    // Use a small helper: play to first feeding (round 4), auto-feed, continue to round 7.
    let s = mkGame(2, 13);
    const p = s.players[0]!;
    sowField(p, 1, "vegetable"); // cropCount 2
    p.resources.vegetable = 0;
    p.resources.food = 50; // never beg
    s.players[1]!.resources.food = 50;
    // Play with safe takes + auto-feed until we pass two harvests (rounds 4 and 7 -> round 8 work).
    let guard = 0;
    while (s.phase !== "finished" && s.round < 8 && guard++ < 500) {
      if (s.phase === "work") {
        const free = s.actionSpaces.find(
          (a) => a.occupiedBy === null && ["forest", "clay_pit", "reed_bank", "fishing", "grain_seeds", "day_laborer", "r_sheep", "r_vegetable"].includes(a.id),
        );
        if (!free) break;
        s = place(s, { action: free.id });
      } else if (s.phase === "feeding") {
        const idx = s.toFeed[0]!;
        s = applyFeeding(s, idx, { conversions: [] }).state;
      }
    }
    const field = s.players[0]!.spaces[1]!;
    // Two harvests (round 4 and round 7) each removed 1 veg => field empty, crop null.
    expect(s.players[0]!.resources.vegetable).toBe(2);
    expect(field.cropCount).toBe(0);
    expect(field.crop).toBe(null);
    // Field tile itself remains a field (re-sowable).
    expect(field.kind).toBe("field");
  });
});

describe("feeding need arithmetic", () => {
  it("2-player: 2 food per family member (2 members -> 4)", () => {
    const s = mkGame(2, 21);
    const p = s.players[0]!;
    expect(p.family.length).toBe(2);
    expect(foodNeeded(s, p)).toBe(4);
  });

  it("solo: 3 food per family member (2 members -> 6)", () => {
    const s = mkGame(1, 22);
    const p = s.players[0]!;
    expect(s.solo).toBe(true);
    expect(p.family.length).toBe(2);
    expect(foodNeeded(s, p)).toBe(6);
  });

  it("newborn born THIS round eats only 1 (2 adults + newborn this round -> 5 in 2p)", () => {
    const s = mkGame(2, 23);
    const p = s.players[0]!;
    s.round = 7;
    p.family.push({ bornRound: 7, placed: true });
    // 2 adults * 2 + 1 newborn * 1 = 5
    expect(foodNeeded(s, p)).toBe(5);
  });

  it("a member born in an EARLIER round eats the full 2 (not 1)", () => {
    const s = mkGame(2, 24);
    const p = s.players[0]!;
    s.round = 7;
    p.family.push({ bornRound: 4, placed: true }); // born earlier, now an adult
    expect(foodNeeded(s, p)).toBe(6); // 3 members * 2
  });

  it("solo newborn this round still eats 1, adults eat 3", () => {
    const s = mkGame(1, 25);
    const p = s.players[0]!;
    s.round = 7;
    p.family.push({ bornRound: 7, placed: true });
    // 2 adults * 3 + 1 newborn * 1 = 7
    expect(foodNeeded(s, p)).toBe(7);
  });
});

describe("feeding payment and begging", () => {
  it("exact food pays with no begging cards", () => {
    const s = mkGame(2, 31);
    const p = s.players[0]!;
    p.resources.food = 4;
    enterFeeding(s, 0);
    const r = applyFeeding(s, 0, { conversions: [] }).state;
    expect(r.players[0]!.resources.food).toBe(0);
    expect(r.players[0]!.beggingCards).toBe(0);
  });

  it("shortfall yields exactly 1 begging card per missing food", () => {
    const s = mkGame(2, 32);
    const p = s.players[0]!;
    p.resources.food = 1; // need 4, have 1 -> 3 missing
    enterFeeding(s, 0);
    const r = applyFeeding(s, 0, { conversions: [] }).state;
    expect(r.players[0]!.resources.food).toBe(0);
    expect(r.players[0]!.beggingCards).toBe(3);
  });

  it("zero food and zero conversions -> begging cards equal to full need", () => {
    const s = mkGame(2, 33);
    const p = s.players[0]!;
    p.resources.food = 0;
    enterFeeding(s, 0);
    const r = applyFeeding(s, 0, { conversions: [] }).state;
    expect(r.players[0]!.beggingCards).toBe(4);
    expect(r.players[0]!.resources.food).toBe(0);
  });
});

describe("begging accumulates across harvests", () => {
  it("two starved harvests stack begging cards (does not reset)", () => {
    let s = mkGame(2, 34);
    // Drive real rounds with the broad safe-take pool, but force every player to
    // 0 food right before each feeding so they always starve.
    let guard = 0;
    while (s.phase !== "finished" && s.round < 8 && guard++ < 600) {
      if (s.phase === "work") {
        const id = freeSafeTake(s);
        if (!id) break;
        s = take(s, id);
      } else if (s.phase === "feeding") {
        const idx = s.toFeed[0]!;
        s.players[idx]!.resources.food = 0; // ensure starvation
        s = applyFeeding(s, idx, { conversions: [] }).state;
      }
    }
    // Harvest after round 4 (need 4) and after round 7 (need 4) -> 8 begging cards.
    expect(s.players[0]!.beggingCards).toBe(8);
  });
});

describe("urgent family growth newborn (stage 5, no room needed)", () => {
  it("urgent newborn born this round eats 1 at the immediate harvest", () => {
    const s = mkGame(2, 35);
    s.round = 13; // round 13 is a harvest round in stage 5
    const p = s.players[0]!;
    // Urgent family growth: no room requirement. Add newborn directly as the
    // engine would (bornRound = current round).
    p.family.push({ bornRound: 13, placed: true });
    // 2 adults * 2 + 1 newborn * 1 = 5.
    expect(foodNeeded(s, p)).toBe(5);
  });
});

describe("raw conversions during feeding", () => {
  it("raw grain -> 1 food each (no improvement needed)", () => {
    const s = mkGame(2, 41);
    const p = s.players[0]!;
    p.resources.food = 0;
    p.resources.grain = 4;
    enterFeeding(s, 0);
    const r = applyFeeding(s, 0, { conversions: [{ via: "raw", good: "grain", count: 4 }] }).state;
    expect(r.players[0]!.resources.grain).toBe(0);
    expect(r.players[0]!.beggingCards).toBe(0);
    expect(r.players[0]!.resources.food).toBe(0); // 4 produced, 4 eaten
  });

  it("raw vegetable -> 1 food each (no improvement needed)", () => {
    const s = mkGame(2, 42);
    const p = s.players[0]!;
    p.resources.food = 0;
    p.resources.vegetable = 4;
    enterFeeding(s, 0);
    const r = applyFeeding(s, 0, { conversions: [{ via: "raw", good: "vegetable", count: 4 }] }).state;
    expect(r.players[0]!.resources.vegetable).toBe(0);
    expect(r.players[0]!.beggingCards).toBe(0);
  });

  it("raw animal conversion is illegal (raw uncooked animals have no food value)", () => {
    const s = mkGame(2, 43);
    const p = s.players[0]!;
    p.resources.food = 0;
    p.animals.sheep = 4;
    enterFeeding(s, 0);
    expect(() =>
      applyFeeding(s, 0, { conversions: [{ via: "raw", good: "sheep", count: 4 }] }),
    ).toThrow(RuleError);
  });

  it("raw grain conversion beyond supply is rejected", () => {
    const s = mkGame(2, 44);
    const p = s.players[0]!;
    p.resources.grain = 2;
    enterFeeding(s, 0);
    expect(() =>
      applyFeeding(s, 0, { conversions: [{ via: "raw", good: "grain", count: 3 }] }),
    ).toThrow(RuleError);
  });
});

describe("cooking improvements during feeding", () => {
  it("Fireplace cooks sheep -> 2 food each", () => {
    const s = mkGame(2, 51);
    const p = s.players[0]!;
    p.majors.push("fireplace2");
    p.resources.food = 0;
    p.animals.sheep = 2;
    enterFeeding(s, 0);
    // need 4, 2 sheep -> 4 food
    const r = applyFeeding(s, 0, { conversions: [{ via: "fireplace2", good: "sheep", count: 2 }] }).state;
    expect(r.players[0]!.animals.sheep).toBe(0);
    expect(r.players[0]!.beggingCards).toBe(0);
  });

  it("raw uncooked animal has no food value without a cooking improvement (begs)", () => {
    const s = mkGame(2, 52);
    const p = s.players[0]!;
    p.resources.food = 0;
    p.animals.cattle = 3; // no cooking improvement
    enterFeeding(s, 0);
    const r = applyFeeding(s, 0, { conversions: [] }).state;
    // cannot convert -> begs full 4
    expect(r.players[0]!.beggingCards).toBe(4);
    expect(r.players[0]!.animals.cattle).toBe(3);
  });

  it("Fireplace veg -> 2 food each", () => {
    const s = mkGame(2, 53);
    const p = s.players[0]!;
    p.majors.push("fireplace2");
    p.resources.food = 0;
    p.resources.vegetable = 2;
    enterFeeding(s, 0);
    const r = applyFeeding(s, 0, { conversions: [{ via: "fireplace2", good: "vegetable", count: 2 }] }).state;
    expect(r.players[0]!.resources.vegetable).toBe(0);
    expect(r.players[0]!.beggingCards).toBe(0); // 4 food from 2 veg
  });
});

describe("workshop harvestFood: cap and per-harvest reset", () => {
  it("Joinery converts at most 1 wood -> 2 food per harvest (over-cap rejected)", () => {
    const s = mkGame(2, 61);
    const p = s.players[0]!;
    p.majors.push("joinery");
    p.resources.wood = 5;
    enterFeeding(s, 0);
    expect(() =>
      applyFeeding(s, 0, { conversions: [{ via: "joinery", good: "wood", count: 2 }] }),
    ).toThrow(RuleError);
  });

  it("Joinery 1 wood -> 2 food is accepted at the cap", () => {
    const s = mkGame(2, 62);
    const p = s.players[0]!;
    p.majors.push("joinery");
    p.resources.wood = 5;
    p.resources.food = 2;
    enterFeeding(s, 0);
    // need 4, have 2 + (1 wood -> 2) = 4
    const r = applyFeeding(s, 0, { conversions: [{ via: "joinery", good: "wood", count: 1 }] }).state;
    expect(r.players[0]!.resources.wood).toBe(4);
    expect(r.players[0]!.beggingCards).toBe(0);
  });

  it("Basketmaker 1 reed -> 3 food per harvest; 2 reed rejected", () => {
    const s = mkGame(2, 63);
    const p = s.players[0]!;
    p.majors.push("basketmaker");
    p.resources.reed = 5;
    enterFeeding(s, 0);
    expect(() =>
      applyFeeding(s, 0, { conversions: [{ via: "basketmaker", good: "reed", count: 2 }] }),
    ).toThrow(RuleError);
  });

  it("harvest cap resets each harvest (used at harvest 1, usable again at harvest 2)", () => {
    // Drive two real harvests. Player has Pottery + plenty of clay; auto-feed will
    // use 1 clay each harvest if needed. We instead assert the tracker resets by
    // checking cardData after the first harvest's feeding then again.
    let s = mkGame(2, 64);
    const p = s.players[0]!;
    p.majors.push("pottery");
    p.resources.clay = 10;
    p.resources.food = 0; // force conversions
    s.players[1]!.resources.food = 100;
    // Round 4 harvest: feed player 0 using pottery at the cap.
    // Get to feeding via real play.
    let guard = 0;
    while (s.phase === "work" && guard++ < 200) {
      const free = s.actionSpaces.find(
        (a) => a.occupiedBy === null && ["forest", "clay_pit", "reed_bank", "fishing", "grain_seeds", "day_laborer"].includes(a.id),
      );
      if (!free) break;
      s = place(s, { action: free.id });
    }
    expect(s.phase).toBe("feeding");
    // feed everyone; player 0 uses pottery cap (1 clay) once this harvest.
    // First, player 0:
    const idx0 = 0;
    s = applyFeeding(s, idx0, { conversions: [{ via: "pottery", good: "clay", count: 1 }] }).state;
    // after that conversion this harvest, a 2nd pottery conversion must be rejected
    // (cap is 1 per harvest). Re-enter feeding for player 0 isn't possible, so we
    // assert the cardData tracker recorded the use, then was reset at next harvest.
    expect(s.players[0]!.cardData["pottery"]?.harvestUsed ?? 0).toBe(1);
    // Finish feeding others and play to the next harvest (round 7).
    guard = 0;
    while (s.phase !== "finished" && s.round < 8 && guard++ < 500) {
      if (s.phase === "work") {
        const free = s.actionSpaces.find(
          (a) => a.occupiedBy === null && ["forest", "clay_pit", "reed_bank", "fishing", "grain_seeds", "day_laborer"].includes(a.id),
        );
        if (!free) break;
        s = place(s, { action: free.id });
      } else if (s.phase === "feeding") {
        const idx = s.toFeed[0]!;
        // give everyone enough food so feeding never blocks
        s.players[idx]!.resources.food = Math.max(s.players[idx]!.resources.food, 100);
        s = applyFeeding(s, idx, { conversions: [] }).state;
      }
    }
    // After the round-7 harvest field phase ran, the tracker should have been reset to undefined.
    expect(s.players[0]!.cardData["pottery"]?.harvestUsed ?? 0).toBe(0);
  });
});

describe("workshop cap cannot be bypassed by splitting conversions", () => {
  it("two Joinery conversions of 1 wood each in one decision are rejected (cap=1)", () => {
    const s = mkGame(2, 65);
    const p = s.players[0]!;
    p.majors.push("joinery");
    p.resources.wood = 5;
    enterFeeding(s, 0);
    expect(() =>
      applyFeeding(s, 0, {
        conversions: [
          { via: "joinery", good: "wood", count: 1 },
          { via: "joinery", good: "wood", count: 1 },
        ],
      }),
    ).toThrow(RuleError);
  });
});

describe("harvested crop is credited to supply before feeding (same harvest)", () => {
  it("a grain field harvested this round can be raw-converted in the immediate feeding", () => {
    // Player has only a grain field (no food). The field phase moves 1 grain into
    // supply; that grain must then be convertible to cover feeding.
    let s = mkGame(2, 66);
    const p = s.players[0]!;
    // Give one grain field and a second one so harvest yields 2 grain total.
    sowField(p, 1, "grain");
    sowField(p, 2, "grain");
    p.resources.grain = 0;
    p.resources.food = 0;
    s.players[1]!.resources.food = 100;
    // Reach round-4 feeding via real play. Avoid grain_seeds so the only grain a
    // player gains is from the field phase we are testing.
    let guard = 0;
    while (s.phase === "work" && guard++ < 200) {
      const free = s.actionSpaces.find(
        (a) => a.occupiedBy === null && ["forest", "clay_pit", "reed_bank", "fishing", "day_laborer"].includes(a.id),
      );
      if (!free) break;
      s = place(s, { action: free.id });
    }
    expect(s.phase).toBe("feeding");
    // Player 0 now should have 2 grain in supply from the field phase (exactly 1
    // per sown field), proving the field phase credits supply before feeding.
    expect(s.players[0]!.resources.grain).toBe(2);
    // That just-harvested grain must be convertible in the same feeding.
    s = applyFeeding(s, 0, { conversions: [{ via: "raw", good: "grain", count: 2 }] }).state;
    expect(s.players[0]!.resources.grain).toBe(0);
  });
});

describe("real family-growth newborn feeding via round card", () => {
  it("growing family on a harvest round: newborn eats 1, so need is 5 not 6", () => {
    // Round 7 is a harvest round AND in stage 2 (family growth card available).
    // Grow on round 7, then the immediate harvest should require 2+2+1 = 5 food.
    let s = mkGame(2, 67);
    // Play to round 7 work phase, feeding earlier harvests with plenty of food.
    let guard = 0;
    for (const pl of s.players) pl.resources.food = 0;
    while (s.phase !== "finished" && s.round < 7 && guard++ < 500) {
      if (s.phase === "work") {
        const free = s.actionSpaces.find(
          (a) => a.occupiedBy === null && ["forest", "clay_pit", "reed_bank", "fishing", "grain_seeds", "day_laborer"].includes(a.id),
        );
        if (!free) break;
        s = place(s, { action: free.id });
      } else if (s.phase === "feeding") {
        const idx = s.toFeed[0]!;
        s.players[idx]!.resources.food = 100;
        s = applyFeeding(s, idx, { conversions: [] }).state;
      }
    }
    expect(s.round).toBe(7);
    expect(s.phase).toBe("work");
    // Grow the family for whoever is the current player (deterministic, no escape).
    const grower = s.currentPlayer;
    const p = s.players[grower]!;
    // Make family growth legal: rooms (2) must exceed family (2). Add a 3rd room
    // (top-left, orthogonally adjacent to the starting room at index 5).
    p.spaces[0]!.kind = "room";
    ensureSpace(s, "r_family_growth");
    s = place(s, { action: "r_family_growth" });
    const after = s.players[grower]!;
    expect(after.family.length).toBe(3);
    const newborn = after.family[after.family.length - 1]!;
    expect(newborn.bornRound).toBe(7);
    // foodNeeded at round 7 with the newborn born this round = 2+2+1 = 5.
    expect(foodNeeded(s, after)).toBe(5);
  });
});

describe("feeding phase guards", () => {
  it("applyFeeding outside the feeding phase is rejected", () => {
    const s = mkGame(2, 71);
    expect(s.phase).toBe("work");
    expect(() => applyFeeding(s, 0, { conversions: [] })).toThrow(RuleError);
  });

  it("a player cannot feed twice in the same harvest", () => {
    const s = mkGame(2, 72);
    s.players[0]!.resources.food = 10;
    enterFeeding(s, 0);
    const r = applyFeeding(s, 0, { conversions: [] }).state;
    // toFeed now empty for player 0; feeding again should be rejected.
    r.phase = "feeding";
    expect(() => applyFeeding(r, 0, { conversions: [] })).toThrow(RuleError);
  });
});

describe("computeAutoFeed correctness", () => {
  it("auto-feed never wastes higher-value goods: prefers raw grain over cooking animals", () => {
    const s = mkGame(2, 81);
    const p = s.players[0]!;
    p.resources.food = 0;
    p.resources.grain = 4;
    p.majors.push("fireplace2");
    p.animals.sheep = 4;
    enterFeeding(s, 0);
    const dec = computeAutoFeed(s, 0);
    const r = applyFeeding(s, 0, dec).state;
    expect(r.players[0]!.beggingCards).toBe(0);
    // should have consumed grain, not sheep
    expect(r.players[0]!.animals.sheep).toBe(4);
  });

  it("auto-feed cooks both animals of a 2-of-a-kind to fully feed (no spurious begging)", () => {
    const s = mkGame(2, 82);
    const p = s.players[0]!;
    p.resources.food = 0;
    p.majors.push("fireplace2"); // sheep -> 2 food
    p.animals.sheep = 2; // 2 sheep -> 4 food == need
    enterFeeding(s, 0);
    const dec = computeAutoFeed(s, 0);
    const r = applyFeeding(s, 0, dec).state;
    expect(r.players[0]!.beggingCards).toBe(0);
    expect(r.players[0]!.animals.sheep).toBe(0);
  });

  it("auto-feed uses the workshop harvest conversion when it is the only food source", () => {
    const s = mkGame(2, 83);
    const p = s.players[0]!;
    p.resources.food = 0;
    p.majors.push("basketmaker"); // 1 reed -> 3 food, cap 1/harvest
    p.resources.reed = 5;
    enterFeeding(s, 0);
    const dec = computeAutoFeed(s, 0);
    const r = applyFeeding(s, 0, dec).state;
    // need 4; basketmaker gives at most 3 from 1 reed -> still 1 short.
    expect(r.players[0]!.beggingCards).toBe(1);
    expect(r.players[0]!.resources.reed).toBe(4); // exactly 1 reed used (cap)
  });
});
