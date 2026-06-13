/** Adversarial rule-conformance tests — Domain: Family growth & newborns.
 *
 *  Each test asserts the canonical base-game Agricola rule (RULES.md §5.8, §7).
 *  Setup mutates state.players[idx] directly, then drives a real placement /
 *  feeding through the public engine entry points.
 */
import { describe, expect, it } from "vitest";
import {
  mkGame,
  placeFor,
  ensureSpace,
  advanceTo,
  applyFeeding,
  computeAutoFeed,
  playUntilRound,
} from "./harness";
import { foodNeeded, RuleError } from "../apply";
import { scorePlayer } from "../scoring";

/** Park player `idx` so it is their turn, exposing the named round-card space
 *  unoccupied, and return the live state with `idx` to move. */
function readyFor(state: ReturnType<typeof mkGame>, idx: number, spaceId: string) {
  state = advanceTo(state, idx);
  ensureSpace(state, spaceId);
  return state;
}

describe("family growth — standard (r_family_growth)", () => {
  it("rejects standard growth when rooms do NOT exceed family (2 rooms, 2 family)", () => {
    let s = mkGame(2, 11);
    const idx = s.currentPlayer;
    // Fresh farm: exactly 2 rooms and 2 family members → no free room.
    s = readyFor(s, idx, "r_family_growth");
    expect(() => placeFor(s, idx, { action: "r_family_growth" })).toThrow(RuleError);
  });

  it("allows standard growth with a free room (3 rooms, 2 family) and adds a newborn", () => {
    let s = mkGame(2, 12);
    const idx = s.currentPlayer;
    // Give a 3rd room so rooms (3) > family (2).
    s.players[idx]!.spaces[0]!.kind = "room";
    s = readyFor(s, idx, "r_family_growth");
    s = placeFor(s, idx, { action: "r_family_growth" });
    expect(s.players[idx]!.family.length).toBe(3);
    const newborn = s.players[idx]!.family[2]!;
    expect(newborn.bornRound).toBe(s.round);
  });

  it("rejects a second standard growth once family equals rooms again (3 rooms→3 family)", () => {
    let s = mkGame(2, 13);
    const idx = s.currentPlayer;
    s.players[idx]!.spaces[0]!.kind = "room"; // 3 rooms
    // Pre-seed a 3rd family member so rooms(3) == family(3).
    s.players[idx]!.family.push({ bornRound: 0, placed: false });
    s = readyFor(s, idx, "r_family_growth");
    expect(() => placeFor(s, idx, { action: "r_family_growth" })).toThrow(RuleError);
  });
});

describe("family growth — urgent (r_urgent_family)", () => {
  it("allows urgent growth with NO free room (2 rooms, 2 family)", () => {
    let s = mkGame(2, 21);
    const idx = s.currentPlayer;
    s = readyFor(s, idx, "r_urgent_family");
    s = placeFor(s, idx, { action: "r_urgent_family" });
    expect(s.players[idx]!.family.length).toBe(3);
  });

  it("urgent growth still enforces the max of 5 members", () => {
    let s = mkGame(2, 22);
    const idx = s.currentPlayer;
    // 5 members already.
    s.players[idx]!.family = [0, 0, 0, 0, 0].map(() => ({ bornRound: 0, placed: false }));
    s = readyFor(s, idx, "r_urgent_family");
    expect(() => placeFor(s, idx, { action: "r_urgent_family" })).toThrow(RuleError);
  });

  it("standard growth also enforces the max of 5 even with rooms available", () => {
    let s = mkGame(2, 23);
    const idx = s.currentPlayer;
    // 6 rooms, 5 family: rooms exceed family, but cap is 5.
    for (const i of [0, 5, 10, 1, 6, 11]) s.players[idx]!.spaces[i]!.kind = "room";
    s.players[idx]!.family = [0, 0, 0, 0, 0].map(() => ({ bornRound: 0, placed: false }));
    s = readyFor(s, idx, "r_family_growth");
    expect(() => placeFor(s, idx, { action: "r_family_growth" })).toThrow(RuleError);
  });
});

describe("newborn placement semantics", () => {
  it("a newborn is born already-placed and grants no extra worker this round", () => {
    let s = mkGame(2, 31);
    const idx = s.currentPlayer;
    s.players[idx]!.spaces[0]!.kind = "room"; // free room
    s = readyFor(s, idx, "r_family_growth");
    s = placeFor(s, idx, { action: "r_family_growth" });
    const fam = s.players[idx]!.family;
    // Two original workers acted (1 spent on growth, 1 still to place this
    // round); the newborn must be flagged placed so it cannot act this round.
    const newborn = fam.find((m) => m.bornRound === s.round)!;
    expect(newborn.placed).toBe(true);
  });

  it("a newborn can act starting next round (unplaced after return-home)", () => {
    // Solo: single player, deterministic worker order.
    let s = mkGame(1, 32);
    s.players[0]!.spaces[0]!.kind = "room"; // free room for growth
    ensureSpace(s, "r_family_growth");
    s = placeFor(s, 0, { action: "r_family_growth" });
    // Solo has 2 starting members; one is now placed via growth-action, one left.
    // Park the remaining worker so the round ends and family returns home.
    // Finish the round by placing the remaining worker on a safe space.
    ensureSpace(s, "forest");
    // advance through the rest of this round until work phase ends / next round.
    let guard = 0;
    const startRound = s.round;
    while (s.phase === "work" && s.round === startRound && guard++ < 10) {
      const member = s.players[0]!.family.find((m) => !m.placed);
      if (!member) break;
      ensureSpace(s, "forest");
      s = placeFor(s, 0, { action: "forest" });
    }
    // Next round: all 3 family members should be available (unplaced).
    if (s.phase === "work") {
      const unplaced = s.players[0]!.family.filter((m) => !m.placed).length;
      expect(unplaced).toBe(3);
    }
  });
});

describe("newborn feeding cost (RULES §5.8, §7.2)", () => {
  it("a newborn born in a harvest round eats only 1 food at that harvest", () => {
    const s = mkGame(2, 41);
    const idx = 0;
    // 2 adults + 1 newborn born THIS round.
    s.players[idx]!.family = [
      { bornRound: 0, placed: false },
      { bornRound: 0, placed: false },
      { bornRound: s.round, placed: false },
    ];
    // foodNeeded: 2 adults * 2 + 1 newborn * 1 = 5.
    expect(foodNeeded(s, s.players[idx]!)).toBe(5);
  });

  it("a member born in a PRIOR round eats the full 2 food", () => {
    const s = mkGame(2, 42);
    s.round = 7;
    const idx = 0;
    s.players[idx]!.family = [
      { bornRound: 0, placed: false },
      { bornRound: 5, placed: false }, // born round 5, now round 7 → full eater
    ];
    expect(foodNeeded(s, s.players[idx]!)).toBe(4);
  });

  it("actual feeding deducts exactly the newborn-discounted amount", () => {
    let s = mkGame(2, 43);
    const idx = 0;
    s.players[idx]!.family = [
      { bornRound: 0, placed: false },
      { bornRound: 0, placed: false },
      { bornRound: s.round, placed: false },
    ];
    s.players[idx]!.resources.food = 10;
    s.phase = "feeding";
    s.toFeed = [idx];
    s = applyFeeding(s, idx, { conversions: [] }).state;
    // Paid 5 (2+2+1); 10 - 5 = 5 left, no begging.
    expect(s.players[idx]!.resources.food).toBe(5);
    expect(s.players[idx]!.beggingCards).toBe(0);
  });

  it("solo newborn born this round still eats only 1 (adults eat 3)", () => {
    const s = mkGame(1, 44);
    const idx = 0;
    s.players[idx]!.family = [
      { bornRound: 0, placed: false },
      { bornRound: s.round, placed: false },
    ];
    // solo: 1 adult * 3 + 1 newborn * 1 = 4.
    expect(foodNeeded(s, s.players[idx]!)).toBe(4);
  });

  it("urgent growth in a harvest round (13): newborn eats 1 at that very harvest", () => {
    const s = mkGame(2, 45);
    s.round = 13;
    const idx = 0;
    s.players[idx]!.family = [
      { bornRound: 0, placed: false },
      { bornRound: 0, placed: false },
      { bornRound: 13, placed: false }, // just born via urgent growth this round
    ];
    // 2 adults*2 + newborn*1 = 5.
    expect(foodNeeded(s, s.players[idx]!)).toBe(5);
  });
});

describe("solo urgent family growth", () => {
  it("solo: urgent growth needs no room (2 rooms, 2 family) and adds a newborn", () => {
    let s = mkGame(1, 46);
    const idx = 0;
    ensureSpace(s, "r_urgent_family");
    s = placeFor(s, idx, { action: "r_urgent_family" });
    expect(s.players[idx]!.family.length).toBe(3);
  });

  it("solo: urgent growth respects the 5-member cap", () => {
    const s = mkGame(1, 47);
    const idx = 0;
    s.players[idx]!.family = [0, 0, 0, 0, 0].map(() => ({ bornRound: 0, placed: false }));
    expect(s.phase).toBe("work");
    expect(s.currentPlayer).toBe(0);
    ensureSpace(s, "r_urgent_family");
    expect(() => placeFor(s, idx, { action: "r_urgent_family" })).toThrow(RuleError);
  });
});

describe("Cradle / Midwife — bonus food after a growth action", () => {
  it("Cradle (minor) grants 2 food after standard family growth", () => {
    let s = mkGame(2, 51);
    const idx = s.currentPlayer;
    s.players[idx]!.minors.push("min_cradle");
    s.players[idx]!.spaces[0]!.kind = "room"; // free room
    const before = s.players[idx]!.resources.food;
    s = readyFor(s, idx, "r_family_growth");
    s = placeFor(s, idx, { action: "r_family_growth" });
    expect(s.players[idx]!.resources.food).toBe(before + 2);
  });

  it("Midwife (occupation) grants 2 food after urgent family growth", () => {
    let s = mkGame(2, 52);
    const idx = s.currentPlayer;
    s.players[idx]!.occupations.push("occ_midwife");
    const before = s.players[idx]!.resources.food;
    s = readyFor(s, idx, "r_urgent_family");
    s = placeFor(s, idx, { action: "r_urgent_family" });
    expect(s.players[idx]!.resources.food).toBe(before + 2);
  });

  it("Cradle does NOT fire on a non-growth action", () => {
    let s = mkGame(2, 53);
    const idx = s.currentPlayer;
    s.players[idx]!.minors.push("min_cradle");
    const before = s.players[idx]!.resources.food;
    s = advanceTo(s, idx);
    ensureSpace(s, "forest", { wood: 3 });
    s = placeFor(s, idx, { action: "forest" });
    // Gained wood, not the Cradle's 2 food.
    expect(s.players[idx]!.resources.food).toBe(before);
  });

  it("Cradle + Midwife stack to +4 food on a single growth action (fires once each)", () => {
    let s = mkGame(2, 54);
    const idx = s.currentPlayer;
    s.players[idx]!.minors.push("min_cradle");
    s.players[idx]!.occupations.push("occ_midwife");
    const before = s.players[idx]!.resources.food;
    s = readyFor(s, idx, "r_urgent_family");
    s = placeFor(s, idx, { action: "r_urgent_family" });
    // Exactly +4 (2 + 2), once per card — NOT multiplied by family size.
    expect(s.players[idx]!.resources.food).toBe(before + 4);
  });
});

describe("Patriarch & family scoring", () => {
  it("Patriarch grants 2 bonus VP at 5 family members, 0 below", () => {
    const s = mkGame(2, 61);
    const idx = 0;
    s.players[idx]!.occupations.push("occ_patriarch");
    s.players[idx]!.family = [0, 0, 0, 0].map(() => ({ bornRound: 0, placed: false }));
    const sheet4 = scorePlayer(s, s.players[idx]!);
    const bonus4 = sheet4.categories.find((c) => c.label === "Bonus points")!.points;
    expect(bonus4).toBe(0);

    s.players[idx]!.family.push({ bornRound: 0, placed: false }); // now 5
    const sheet5 = scorePlayer(s, s.players[idx]!);
    const bonus5 = sheet5.categories.find((c) => c.label === "Bonus points")!.points;
    expect(bonus5).toBe(2);
  });

  it("family scores +3 per member", () => {
    const s = mkGame(2, 62);
    const idx = 0;
    s.players[idx]!.family = [0, 0, 0, 0, 0].map(() => ({ bornRound: 0, placed: false }));
    const sheet = scorePlayer(s, s.players[idx]!);
    const fam = sheet.categories.find((c) => c.label === "Family")!.points;
    expect(fam).toBe(15);
  });
});

describe("family growth — optional minor improvement ordering", () => {
  it("r_family_growth may play a minor improvement after growing", () => {
    let s = mkGame(2, 71);
    const idx = s.currentPlayer;
    s.players[idx]!.spaces[0]!.kind = "room"; // free room
    // Put an affordable, no-prereq minor (Cradle: 1 wood) in hand and fund it.
    s.players[idx]!.handMinors.push("min_cradle");
    s.players[idx]!.resources.wood = 5;
    s = readyFor(s, idx, "r_family_growth");
    s = placeFor(s, idx, {
      action: "r_family_growth",
      improvement: { kind: "minor", card: "min_cradle" },
    });
    expect(s.players[idx]!.family.length).toBe(3);
    expect(s.players[idx]!.minors).toContain("min_cradle");
  });

  it("r_family_growth rejects a MAJOR improvement after growth", () => {
    let s = mkGame(2, 72);
    const idx = s.currentPlayer;
    s.players[idx]!.spaces[0]!.kind = "room";
    s = readyFor(s, idx, "r_family_growth");
    expect(() =>
      placeFor(s, idx, {
        action: "r_family_growth",
        improvement: { kind: "major", card: "well" },
      }),
    ).toThrow(RuleError);
  });

  it("if standard growth is illegal, the optional minor is NOT played (atomic reject)", () => {
    let s = mkGame(2, 73);
    const idx = s.currentPlayer;
    // No free room (2 rooms, 2 family). Growth must fail; the minor must not slip in.
    s.players[idx]!.handMinors.push("min_cradle");
    s.players[idx]!.resources.wood = 5;
    s = readyFor(s, idx, "r_family_growth");
    expect(() =>
      placeFor(s, idx, {
        action: "r_family_growth",
        improvement: { kind: "minor", card: "min_cradle" },
      }),
    ).toThrow(RuleError);
    expect(s.players[idx]!.minors).not.toContain("min_cradle");
    expect(s.players[idx]!.family.length).toBe(2);
  });
});

describe("end-to-end newborn lifecycle (driven through real rounds)", () => {
  it("newborn born in a harvest round eats 1 that harvest, then 2 at the next harvest", () => {
    // Drive a 2p game to round 7 (last round of stage 2 → harvest follows).
    let s = playUntilRound(mkGame(2, 81), 7);
    expect(s.round).toBe(7);
    expect(s.phase).toBe("work");
    const idx = s.currentPlayer;
    // Ensure a free room so standard growth is legal: add a 3rd room.
    s.players[idx]!.spaces[0]!.kind = "room";
    // Plenty of food so feeding never begs and we can read exact deductions.
    s.players[idx]!.resources.food = 50;
    ensureSpace(s, "r_family_growth");
    s = placeFor(s, idx, { action: "r_family_growth" });
    expect(s.players[idx]!.family.length).toBe(3);
    const newborn = s.players[idx]!.family.find((m) => m.bornRound === 7)!;
    expect(newborn).toBeTruthy();

    // foodNeeded for this player at the round-7 harvest: 2 adults*2 + newborn*1 = 5.
    // Confirm by checking just before feeding deducts.
    // Finish the round so the harvest/feeding begins.
    let guard = 0;
    while (s.phase === "work" && guard++ < 50) {
      const m = s.players.flatMap((p, pi) => p.family.map((fm) => ({ pi, fm })))
        .find(({ pi, fm }) => pi === s.currentPlayer && !fm.placed);
      if (!m) break;
      ensureSpace(s, "fishing", { food: 0 });
      // Use any safe space available for whoever is up.
      const cp = s.currentPlayer;
      ensureSpace(s, "forest", { wood: 1 });
      s = placeFor(s, cp, { action: "forest" });
    }
    expect(s.phase).toBe("feeding");

    // Feed our player; record food before/after.
    const beforeFood = s.players[idx]!.resources.food;
    // foodNeeded uses state.round (still 7) → newborn discounted.
    expect(foodNeeded(s, s.players[idx]!)).toBe(5);
    // Apply feeding for everyone owed, capturing our player's deduction.
    while (s.phase === "feeding") {
      const fi = s.toFeed[0]!;
      s = applyFeeding(s, fi, computeAutoFeed(s, fi)).state;
    }
    expect(s.players[idx]!.resources.food).toBe(beforeFood - 5);
    expect(s.players[idx]!.beggingCards).toBe(0);

    // Drive to the next harvest (round 9). The (now older) child eats 2.
    s = playUntilRound(s, 9);
    expect(s.round).toBe(9);
    s.players[idx]!.resources.food = 50;
    // At round 9 the child born round 7 is no longer a newborn: 3 members * 2 = 6.
    // Finish round 9 work so harvest begins.
    let g2 = 0;
    while (s.phase === "work" && g2++ < 50) {
      const cp = s.currentPlayer;
      ensureSpace(s, "forest", { wood: 1 });
      s = placeFor(s, cp, { action: "forest" });
    }
    expect(s.phase).toBe("feeding");
    expect(foodNeeded(s, s.players[idx]!)).toBe(6);
  });

  it("growing the family yields exactly one extra worker the FOLLOWING round, not the same round", () => {
    let s = playUntilRound(mkGame(2, 82), 6);
    const idx = s.currentPlayer;
    s.players[idx]!.spaces[0]!.kind = "room"; // free room
    ensureSpace(s, "r_family_growth");
    const familyBefore = s.players[idx]!.family.length;
    s = placeFor(s, idx, { action: "r_family_growth" });
    // Same round: the newborn is placed and must not be actionable.
    const actionableNow = s.players[idx]!.family.filter((m) => !m.placed).length;
    // One original worker already spent on the growth action; the newborn is
    // placed; so at most (familyBefore - 1) remain unplaced this round.
    expect(actionableNow).toBeLessThanOrEqual(familyBefore - 1);
    expect(s.players[idx]!.family.length).toBe(familyBefore + 1);

    // Advance to round 7 work phase: now all members (incl. the child) act.
    s = playUntilRound(s, 7);
    expect(s.round).toBe(7);
    if (s.phase === "work") {
      const unplaced = s.players[idx]!.family.filter((m) => !m.placed).length;
      expect(unplaced).toBe(familyBefore + 1);
    }
  });
});
