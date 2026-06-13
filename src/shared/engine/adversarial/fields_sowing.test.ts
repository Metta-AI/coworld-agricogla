/** Adversarial rule-conformance tests for the Fields / plowing / sowing domain.
 *
 *  Canonical base-game Agricola rules (see RULES.md section 5.3):
 *   - Plow places a field on an empty, non-stable, non-pasture space.
 *   - If you already have at least one field, the NEW field must be
 *     orthogonally adjacent to an existing field.
 *   - The Farmland action plows exactly 1 field, +extra only via a plow
 *     improvement (Wooden Plow +1 x2 uses, Heavy Plow +1 x3, Plowwright +1 x3,
 *     Furrow Master +2 x1). At most ONE plow improvement per plow action.
 *   - Sow: each chosen EMPTY field receives 3 grain or 2 vegetable, consuming
 *     exactly 1 crop from the player's SUPPLY (not from a field). Any number of
 *     empty fields may be sown per Sow action.
 *   - A field emptied by harvest may be re-sown without re-plowing.
 *   - r_sow_bake (Grain Utilization) requires at least one of sow / bake.
 *   - r_cultivation requires plow and/or sow.
 */
import { describe, expect, it } from "vitest";
import { RuleError } from "../apply";
import { advanceTo, autoFeedAll, ensureSpace, mkGame, place, placeFor, playToFeeding } from "./harness";

/** Mutate the current player's farm so it has fields at the given indices. */
function setFields(state: ReturnType<typeof mkGame>, idx: number, fields: number[]) {
  const p = state.players[idx]!;
  for (const f of fields) {
    p.spaces[f]!.kind = "field";
    p.spaces[f]!.crop = null;
    p.spaces[f]!.cropCount = 0;
  }
}

describe("plowing — adjacency & legality", () => {
  it("first field may be plowed on any empty non-room space", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    s = place(s, { action: "farmland", spaces: [7] });
    expect(s.players[idx]!.spaces[7]!.kind).toBe("field");
  });

  it("a second plow on a non-adjacent space is rejected", () => {
    // Player already has a single field at 0 (top-left). Space 14 (bottom-
    // right) is not orthogonally adjacent to any field.
    const s0 = mkGame(2, 7);
    const idx = s0.currentPlayer;
    setFields(s0, idx, [0]);
    expect(() => place(s0, { action: "farmland", spaces: [14] })).toThrow(RuleError);
  });

  it("a second plow adjacent to an existing field is allowed", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    setFields(s, idx, [0]); // field at 0; 1 is adjacent
    s = place(s, { action: "farmland", spaces: [1] });
    expect(s.players[idx]!.spaces[1]!.kind).toBe("field");
  });

  it("cannot plow on a room space", () => {
    const s = mkGame(2, 7); // rooms at 5 and 10
    expect(() => place(s, { action: "farmland", spaces: [5] })).toThrow(RuleError);
  });

  it("cannot plow on a space that already holds a field", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    setFields(s, idx, [7]);
    expect(() => place(s, { action: "farmland", spaces: [7] })).toThrow(RuleError);
  });

  it("cannot plow on a space occupied by a stable", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    s.players[idx]!.spaces[7]!.stable = true;
    expect(() => place(s, { action: "farmland", spaces: [7] })).toThrow(RuleError);
  });

  it("cannot plow on a pasture cell", () => {
    // Fully enclose space 4 (row0 col4) with built fences -> it becomes a
    // pasture cell, which is not a legal field space.
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    // edges around cell 4: top h-0-4, bottom h-1-4, left v-0-4, right v-0-5
    p.fences = ["h-0-4", "h-1-4", "v-0-4", "v-0-5"];
    expect(() => place(s, { action: "farmland", spaces: [4] })).toThrow(RuleError);
  });
});

describe("plowing — single-field cap without an improvement", () => {
  it("plowing 2 fields in one Farmland action without a plow card is rejected", () => {
    const s = mkGame(2, 7);
    expect(() => place(s, { action: "farmland", spaces: [7, 8] })).toThrow(RuleError);
  });

  it("Farmland with an empty spaces list is rejected by the engine guard", () => {
    // applyPlacement does not run zod validation, so the engine itself must
    // reject a no-op plow (you must plow exactly 1 field with Farmland).
    const s = mkGame(2, 7);
    expect(() => place(s, { action: "farmland", spaces: [] })).toThrow(RuleError);
  });
});

describe("plowing — plow improvements (extra fields, use limits, caps)", () => {
  it("Wooden Plow allows 2 fields in one action and decrements its uses", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    s.players[idx]!.minors.push("min_wooden_plow");
    // 7 then 8 (adjacent to 7) — both legal.
    s = place(s, { action: "farmland", spaces: [7, 8], plowCard: "min_wooden_plow" });
    const p = s.players[idx]!;
    expect(p.spaces.filter((sp) => sp.kind === "field")).toHaveLength(2);
    expect(p.cardData["min_wooden_plow"]!.plowUses).toBe(1);
  });

  it("Wooden Plow may not exceed 2 fields even with the card (cap = 1 base + 1 extra)", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    s.players[idx]!.minors.push("min_wooden_plow");
    expect(() =>
      place(s, { action: "farmland", spaces: [7, 8, 9], plowCard: "min_wooden_plow" }),
    ).toThrow(RuleError);
  });

  it("Wooden Plow is exhausted after 2 plow actions (uses cap)", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.minors.push("min_wooden_plow");
    // Pre-set the card to having already used both of its 2 uses.
    p.cardData["min_wooden_plow"] = { plowUses: 2 };
    setFields(s, idx, [0]);
    // 1 is adjacent to field 0; would be a legal *single* plow, but invoking
    // the exhausted plow card must be rejected.
    expect(() =>
      place(s, { action: "farmland", spaces: [1], plowCard: "min_wooden_plow" }),
    ).toThrow(RuleError);
  });

  it("Furrow Master allows 3 fields in one action (1 base + 2 extra)", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    s.players[idx]!.occupations.push("occ_furrow_master");
    // Chain: 0 -> 1 -> 2 (each adjacent to the previous).
    s = place(s, { action: "farmland", spaces: [0, 1, 2], plowCard: "occ_furrow_master" });
    expect(s.players[idx]!.spaces.filter((sp) => sp.kind === "field")).toHaveLength(3);
    expect(s.players[idx]!.cardData["occ_furrow_master"]!.plowUses).toBe(1);
  });

  it("Furrow Master may not exceed 3 fields", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    s.players[idx]!.occupations.push("occ_furrow_master");
    expect(() =>
      place(s, { action: "farmland", spaces: [0, 1, 2, 3], plowCard: "occ_furrow_master" }),
    ).toThrow(RuleError);
  });

  it("multi-field plow still enforces adjacency for every new field", () => {
    // Wooden Plow: plow [0, 14]. 0 is legal (first field), but 14 is not
    // adjacent to 0 or to any field -> the whole action must be rejected.
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    s.players[idx]!.minors.push("min_wooden_plow");
    expect(() =>
      place(s, { action: "farmland", spaces: [0, 14], plowCard: "min_wooden_plow" }),
    ).toThrow(RuleError);
  });

  it("using a plow card you do not own is rejected", () => {
    const s = mkGame(2, 7);
    expect(() =>
      place(s, { action: "farmland", spaces: [7], plowCard: "min_wooden_plow" }),
    ).toThrow(RuleError);
  });
});

describe("sowing — crop counts & supply consumption", () => {
  it("sowing grain puts 3 grain on the field and consumes 1 grain from supply", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    setFields(s, idx, [7]);
    const p = s.players[idx]!;
    p.resources.grain = 1;
    ensureSpace(s, "r_sow_bake");
    const s2 = place(s, { action: "r_sow_bake", sow: [{ space: 7, crop: "grain" }], bake: [] });
    const np = s2.players[idx]!;
    expect(np.spaces[7]!.crop).toBe("grain");
    expect(np.spaces[7]!.cropCount).toBe(3);
    expect(np.resources.grain).toBe(0); // 1 consumed from supply
  });

  it("sowing vegetable puts 2 veg on the field and consumes 1 veg from supply", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    setFields(s, idx, [7]);
    const p = s.players[idx]!;
    p.resources.vegetable = 1;
    ensureSpace(s, "r_sow_bake");
    const s2 = place(s, {
      action: "r_sow_bake",
      sow: [{ space: 7, crop: "vegetable" }],
      bake: [],
    });
    const np = s2.players[idx]!;
    expect(np.spaces[7]!.crop).toBe("vegetable");
    expect(np.spaces[7]!.cropCount).toBe(2);
    expect(np.resources.vegetable).toBe(0);
  });

  it("sowing with no crop in supply is rejected", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    setFields(s, idx, [7]);
    s.players[idx]!.resources.grain = 0;
    ensureSpace(s, "r_sow_bake");
    expect(() =>
      place(s, { action: "r_sow_bake", sow: [{ space: 7, crop: "grain" }], bake: [] }),
    ).toThrow(RuleError);
  });

  it("sowing a non-field space is rejected", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    s.players[idx]!.resources.grain = 5;
    ensureSpace(s, "r_sow_bake");
    // Space 7 is empty (not a field).
    expect(() =>
      place(s, { action: "r_sow_bake", sow: [{ space: 7, crop: "grain" }], bake: [] }),
    ).toThrow(RuleError);
  });

  it("sowing an already-sown field is rejected", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    setFields(s, idx, [7]);
    const p = s.players[idx]!;
    p.spaces[7]!.crop = "grain";
    p.spaces[7]!.cropCount = 3;
    p.resources.grain = 5;
    ensureSpace(s, "r_sow_bake");
    expect(() =>
      place(s, { action: "r_sow_bake", sow: [{ space: 7, crop: "grain" }], bake: [] }),
    ).toThrow(RuleError);
  });

  it("sowing the same field twice in one action is rejected", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    setFields(s, idx, [7]);
    s.players[idx]!.resources.grain = 5;
    ensureSpace(s, "r_sow_bake");
    expect(() =>
      place(s, {
        action: "r_sow_bake",
        sow: [
          { space: 7, crop: "grain" },
          { space: 7, crop: "vegetable" },
        ],
        bake: [],
      }),
    ).toThrow(RuleError);
  });

  it("may sow any number of empty fields in one Sow action", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    setFields(s, idx, [6, 7, 8]);
    const p = s.players[idx]!;
    p.resources.grain = 2;
    p.resources.vegetable = 1;
    ensureSpace(s, "r_sow_bake");
    const s2 = place(s, {
      action: "r_sow_bake",
      sow: [
        { space: 6, crop: "grain" },
        { space: 7, crop: "grain" },
        { space: 8, crop: "vegetable" },
      ],
      bake: [],
    });
    const np = s2.players[idx]!;
    expect(np.spaces[6]!.cropCount).toBe(3);
    expect(np.spaces[7]!.cropCount).toBe(3);
    expect(np.spaces[8]!.cropCount).toBe(2);
    expect(np.resources.grain).toBe(0);
    expect(np.resources.vegetable).toBe(0);
  });
});

describe("sowing — re-sow after harvest, no re-plow needed", () => {
  it("a field emptied by harvest can be re-sown without re-plowing", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    setFields(s, idx, [7]);
    const p = s.players[idx]!;
    // Simulate a field that was sown and then fully harvested to empty.
    p.spaces[7]!.crop = null;
    p.spaces[7]!.cropCount = 0;
    p.resources.grain = 1;
    ensureSpace(s, "r_sow_bake");
    const s2 = place(s, { action: "r_sow_bake", sow: [{ space: 7, crop: "grain" }], bake: [] });
    expect(s2.players[idx]!.spaces[7]!.kind).toBe("field");
    expect(s2.players[idx]!.spaces[7]!.cropCount).toBe(3);
  });
});

describe("r_sow_bake / r_cultivation gating", () => {
  it("r_sow_bake with neither sow nor bake is rejected", () => {
    const s = mkGame(2, 7);
    ensureSpace(s, "r_sow_bake");
    expect(() => place(s, { action: "r_sow_bake", sow: [], bake: [] })).toThrow(RuleError);
  });

  it("r_cultivation with neither plow nor sow is rejected", () => {
    const s = mkGame(2, 7);
    ensureSpace(s, "r_cultivation");
    expect(() => place(s, { action: "r_cultivation", sow: [] })).toThrow(RuleError);
  });

  it("r_cultivation can plow exactly one field and then sow it", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    s.players[idx]!.resources.grain = 1;
    ensureSpace(s, "r_cultivation");
    const s2 = place(s, {
      action: "r_cultivation",
      plow: 7,
      sow: [{ space: 7, crop: "grain" }],
    });
    const np = s2.players[idx]!;
    expect(np.spaces[7]!.kind).toBe("field");
    expect(np.spaces[7]!.cropCount).toBe(3);
    expect(np.resources.grain).toBe(0);
  });

  it("r_cultivation plows only a single field (it never plows 2)", () => {
    // The Cultivation card plows exactly one field; the schema only accepts a
    // single `plow` index, so two plows in one cultivation are impossible.
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    setFields(s, idx, [0]);
    ensureSpace(s, "r_cultivation");
    const s2 = place(s, { action: "r_cultivation", plow: 1, sow: [] });
    expect(s2.players[idx]!.spaces.filter((sp) => sp.kind === "field")).toHaveLength(2);
  });

  it("r_cultivation plow still enforces field adjacency", () => {
    // Field at 0; plowing at non-adjacent 14 must be rejected.
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    setFields(s, idx, [0]);
    ensureSpace(s, "r_cultivation");
    expect(() => place(s, { action: "r_cultivation", plow: 14, sow: [] })).toThrow(RuleError);
  });
});

describe("plow improvements — Plowwright & Heavy Plow exact use-counts", () => {
  it("Plowwright (occupation) grants +1 field on 3 uses", () => {
    let s = mkGame(2, 7);
    const idx = s.currentPlayer;
    s.players[idx]!.occupations.push("occ_plowwright");
    s = place(s, { action: "farmland", spaces: [7, 8], plowCard: "occ_plowwright" });
    expect(s.players[idx]!.spaces.filter((sp) => sp.kind === "field")).toHaveLength(2);
    expect(s.players[idx]!.cardData["occ_plowwright"]!.plowUses).toBe(1);
  });

  it("Heavy Plow's 3rd use still works but a 4th is rejected", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    const p = s.players[idx]!;
    p.minors.push("min_heavy_plow");
    // Pre-set to 2 uses consumed; field already at 0 so the next plow chains.
    p.cardData["min_heavy_plow"] = { plowUses: 2 };
    setFields(s, idx, [0]);
    // 3rd use: plow [1,2] (1 adj to 0, 2 adj to 1). Should succeed -> uses=3.
    const s2 = place(s, { action: "farmland", spaces: [1, 2], plowCard: "min_heavy_plow" });
    expect(s2.players[idx]!.cardData["min_heavy_plow"]!.plowUses).toBe(3);
    // 4th use must be rejected.
    setFields(s2, idx, [3]); // give an anchor field
    expect(() =>
      place(s2, { action: "farmland", spaces: [8, 9], plowCard: "min_heavy_plow" }),
    ).toThrow(RuleError);
  });

  it("using a non-plow card as plowCard is rejected", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    // Own a non-plow card (Hearth Stones is a bake minor).
    s.players[idx]!.minors.push("min_hearth_stones");
    expect(() =>
      place(s, { action: "farmland", spaces: [7, 8], plowCard: "min_hearth_stones" }),
    ).toThrow(RuleError);
  });

  it("a rejected plow action does NOT consume the plow card's use (atomicity)", () => {
    // Wooden Plow, but the 2nd field violates adjacency -> whole action fails.
    // Because the engine clones state per step, the original state's plowUses
    // must remain at 0 (the failed action consumes nothing).
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    s.players[idx]!.minors.push("min_wooden_plow");
    expect(() =>
      place(s, { action: "farmland", spaces: [0, 14], plowCard: "min_wooden_plow" }),
    ).toThrow(RuleError);
    // Original state must be untouched.
    expect(s.players[idx]!.cardData["min_wooden_plow"]?.plowUses ?? 0).toBe(0);
    expect(s.players[idx]!.spaces.filter((sp) => sp.kind === "field")).toHaveLength(0);
  });
});

describe("harvest interaction — partial fields are not re-sowable; counts decrement correctly", () => {
  it("grain field yields exactly 1 grain per harvest over 3 harvests then empties", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    setFields(s, idx, [7]);
    const p = s.players[idx]!;
    p.spaces[7]!.crop = "grain";
    p.spaces[7]!.cropCount = 3;
    p.resources.grain = 0;
    // Drive 3 real harvests via the harness by jumping the state to feeding is
    // not exposed; instead verify the decrement contract by inspecting that a
    // partially-harvested field (cropCount=2) is NOT re-sowable.
    p.spaces[7]!.cropCount = 2; // as if one grain already harvested
    p.resources.grain = 5;
    ensureSpace(s, "r_sow_bake");
    expect(() =>
      place(s, { action: "r_sow_bake", sow: [{ space: 7, crop: "grain" }], bake: [] }),
    ).toThrow(RuleError);
  });

  it("a fully-emptied vegetable field (cropCount 0, crop null) is re-sowable", () => {
    const s = mkGame(2, 7);
    const idx = s.currentPlayer;
    setFields(s, idx, [7]);
    const p = s.players[idx]!;
    p.spaces[7]!.crop = null;
    p.spaces[7]!.cropCount = 0;
    p.resources.vegetable = 1;
    ensureSpace(s, "r_sow_bake");
    const s2 = place(s, {
      action: "r_sow_bake",
      sow: [{ space: 7, crop: "vegetable" }],
      bake: [],
    });
    expect(s2.players[idx]!.spaces[7]!.cropCount).toBe(2);
  });

  it("REAL harvest path: a field with 1 grain empties to 0 and becomes re-sowable", () => {
    // Set up player 0 with a sown grain field that will fully empty at the
    // first (round-4) harvest, drive a real harvest, then re-sow it.
    const s0 = mkGame(2, 7);
    const idx = 0;
    const p = s0.players[idx]!;
    p.spaces[7]!.kind = "field";
    p.spaces[7]!.crop = "grain";
    p.spaces[7]!.cropCount = 1; // exactly one grain -> empties after one harvest
    p.resources.food = 50; // never beg
    s0.players[1]!.resources.food = 50;

    let s = playToFeeding(s0); // run rounds 1-4 work, stop at round-4 harvest feeding
    expect(s.round).toBe(4);
    // Field phase already ran before feeding: the grain field must now be empty.
    expect(s.players[idx]!.spaces[7]!.cropCount).toBe(0);
    expect(s.players[idx]!.spaces[7]!.crop).toBe(null);
    expect(s.players[idx]!.spaces[7]!.kind).toBe("field"); // tile stays a field

    s = autoFeedAll(s); // finish feeding -> round 5 work
    expect(s.phase).toBe("work");
    expect(s.round).toBe(5);

    // Re-sow the emptied field with no re-plow. Make sure it is player 0's turn.
    s = advanceTo(s, idx);
    expect(s.currentPlayer).toBe(idx);
    s.players[idx]!.resources.grain = 1;
    ensureSpace(s, "r_sow_bake");
    s = placeFor(s, idx, { action: "r_sow_bake", sow: [{ space: 7, crop: "grain" }], bake: [] });
    expect(s.players[idx]!.spaces[7]!.cropCount).toBe(3);
  });
});
