/**
 * Adversarial conformance tests — DOMAIN: the agent-facing advisory layer
 * (legalActions / playerChoices / suggestFencePlans in src/shared/engine/legal.ts).
 *
 * The contract: this layer must never lie to the agent/UI. Concretely:
 *  - availability ⟹ a concrete placement built from `choices` is accepted by the
 *    real engine (`applyPlacement`) — no "available" space that crashes.
 *  - availability ⟸ when a legal placement genuinely exists the space must be
 *    marked available (no false "unavailable").
 *  - `choices` fields (legalRooms/Fields/Stables, fencePlans cost+edges, etc.)
 *    must match what the engine actually accepts and charges.
 */
import { describe, expect, it } from "vitest";
import { applyFeeding, applyPlacement, computeAutoFeed, RuleError } from "../apply";
import { legalActions, playerChoices, suggestFencePlans } from "../legal";
import { ActionOption, PlayerChoices } from "../legal";
import { edgesOfCell, hEdge, vEdge } from "../farmyard";
import { newGame } from "../game";
import { makeRng, randInt } from "../rng";
import { GameState, PlayerState, Resource } from "../types";
import { Placement } from "../placements";

function canAfford(p: PlayerState, cost: Record<string, number | undefined>): boolean {
  return Object.entries(cost).every(([r, n]) => p.resources[r as Resource] >= (n ?? 0));
}

/** Build the simplest placement the engine should accept for an available space,
 *  mirroring the engine's own legality rules (not the bot's heuristics). Returns
 *  null when no legal placement exists — for an *available* space that is itself
 *  a bug (the layer claimed availability with nothing to do). */
function canonicalPlacement(
  state: GameState,
  idx: number,
  opt: ActionOption,
  choices: PlayerChoices,
): Placement | null {
  const p = state.players[idx]!;
  switch (opt.id) {
    case "farm_expansion":
      if (choices.legalRooms.length > 0 && canAfford(p, choices.roomCost)) {
        return { action: "farm_expansion", rooms: [choices.legalRooms[0]!], stables: [] };
      }
      if (choices.stablesLeft > 0 && choices.legalStables.length > 0 && p.resources.wood >= 2) {
        return { action: "farm_expansion", rooms: [], stables: [choices.legalStables[0]!] };
      }
      return null;
    case "meeting_place":
      return { action: "meeting_place" };
    case "farmland":
      return choices.legalFields.length > 0
        ? { action: "farmland", spaces: [choices.legalFields[0]!] }
        : null;
    case "lessons":
    case "lessons_b": {
      const cost = choices.occupationCostBySpace[opt.id] ?? 0;
      const occ = choices.handOccupations.find((c) => c.prereqOk && p.resources.food >= cost);
      return occ ? ({ action: opt.id, occupation: occ.id } as Placement) : null;
    }
    case "r_improvement": {
      const major = choices.majors.find((c) => c.affordable && c.prereqOk);
      if (major) {
        return { action: "r_improvement", improvement: { kind: "major", card: major.id } };
      }
      const fp = p.majors.find((m) => m === "fireplace2" || m === "fireplace3");
      const hearth = choices.majors.find((c) => c.id === "hearth4" || c.id === "hearth5");
      if (fp && hearth) {
        return {
          action: "r_improvement",
          improvement: { kind: "major", card: hearth.id, returnFireplace: fp },
        };
      }
      const minor = choices.handMinors.find((c) => c.affordable && c.prereqOk);
      if (minor) {
        return { action: "r_improvement", improvement: { kind: "minor", card: minor.id } };
      }
      return null;
    }
    case "r_fences":
      return choices.fencePlans.length > 0 && p.resources.wood >= choices.fencePlans[0]!.cost
        ? { action: "r_fences", edges: choices.fencePlans[0]!.edges }
        : null;
    case "r_sow_bake": {
      if (choices.sowableFields.length > 0 && (p.resources.grain > 0 || p.resources.vegetable > 0)) {
        const crop = p.resources.grain > 0 ? "grain" : "vegetable";
        return {
          action: "r_sow_bake",
          sow: [{ space: choices.sowableFields[0]!, crop }],
          bake: [],
        };
      }
      if (choices.bakeOptions.length > 0 && p.resources.grain > 0) {
        const b = choices.bakeOptions[0]!;
        return {
          action: "r_sow_bake",
          sow: [],
          bake: [{ card: b.card, grain: Math.min(p.resources.grain, b.maxGrain) }],
        };
      }
      return null;
    }
    case "r_renovate_improve":
      return choices.renovation && canAfford(p, choices.renovation)
        ? { action: "r_renovate_improve" }
        : null;
    case "r_redevelop":
      return choices.renovation && canAfford(p, choices.renovation)
        ? { action: "r_redevelop", edges: [] }
        : null;
    case "r_family_growth":
      return choices.familyGrowthOk ? { action: "r_family_growth" } : null;
    case "r_urgent_family":
      return choices.urgentGrowthOk ? { action: "r_urgent_family" } : null;
    case "r_cultivation":
      if (choices.legalFields.length > 0) {
        return { action: "r_cultivation", plow: choices.legalFields[0]!, sow: [] };
      }
      if (choices.sowableFields.length > 0 && (p.resources.grain > 0 || p.resources.vegetable > 0)) {
        const crop = p.resources.grain > 0 ? "grain" : "vegetable";
        return { action: "r_cultivation", sow: [{ space: choices.sowableFields[0]!, crop }] };
      }
      return null;
    default:
      // Bare resource-take spaces always accept { action: id }.
      return { action: opt.id } as Placement;
  }
}

function fenceFreePlayer(overrides: Partial<PlayerState> = {}): GameState {
  // 2-player game; give player 0 a clean empty farm + control of the turn.
  const s = newGame({ seed: 3, numPlayers: 2 });
  s.currentPlayer = 0;
  s.startingPlayer = 0;
  const p = s.players[0]!;
  Object.assign(p, overrides);
  // Ensure the Fences round card is present and free.
  if (!s.actionSpaces.some((a) => a.id === "r_fences")) {
    s.actionSpaces.push({ id: "r_fences", occupiedBy: null, pile: {} });
  }
  return s;
}

describe("fencePlans cost reflects free-fence discounts", () => {
  it("a player with Hedge Warden (2 free) needs only 2 wood for a 4-fence pasture", () => {
    const s = fenceFreePlayer();
    const p = s.players[0]!;
    p.occupations.push("occ_hedge_warden"); // 2 free fences per action
    p.resources.wood = 2;
    const plans = suggestFencePlans(p);
    expect(plans.length).toBeGreaterThan(0);
    // Cheapest single-cell plan: 4 edges − 2 free = 2 wood.
    const cell = plans.find((pl) => pl.cells.length === 1)!;
    expect(cell.cost).toBe(2);
    // The engine must accept it and charge exactly 2 wood.
    const ns = applyPlacement(s, 0, { action: "r_fences", edges: cell.edges } as never).state;
    expect(ns.players[0]!.resources.wood).toBe(0);
    expect(ns.players[0]!.fences).toHaveLength(4);
  });

  it("r_fences is AVAILABLE when free fences make a plan affordable", () => {
    const s = fenceFreePlayer();
    const p = s.players[0]!;
    p.occupations.push("occ_hedge_warden");
    p.resources.wood = 2; // raw cost 4, net cost 2 -> affordable
    const opts = legalActions(s, 0);
    const fences = opts.find((o) => o.id === "r_fences")!;
    expect(fences.available).toBe(true);
  });

  it("Fence Posts + Hedge Warden (3 free) cut a 4-fence pasture to 1 wood", () => {
    const s = fenceFreePlayer();
    const p = s.players[0]!;
    p.occupations.push("occ_hedge_warden");
    p.minors.push("min_fence_posts");
    p.resources.wood = 1;
    const plans = suggestFencePlans(p);
    const cell = plans.find((pl) => pl.cells.length === 1)!;
    expect(cell.cost).toBe(1);
    expect(legalActions(s, 0).find((o) => o.id === "r_fences")!.available).toBe(true);
    const ns = applyPlacement(s, 0, { action: "r_fences", edges: cell.edges } as never).state;
    expect(ns.players[0]!.resources.wood).toBe(0);
  });

  it("with no free-fence cards the cost equals the raw fence count", () => {
    const s = fenceFreePlayer();
    const p = s.players[0]!;
    p.resources.wood = 10;
    const plans = suggestFencePlans(p);
    const cell = plans.find((pl) => pl.cells.length === 1)!;
    expect(cell.cost).toBe(4); // 4 edges, no discount
  });
});

describe("suggestFencePlans offers pasture subdivisions", () => {
  it("suggests splitting an existing 2-cell pasture into two", () => {
    const s = fenceFreePlayer();
    const p = s.players[0]!;
    // Enclose cells 3 and 4 as one 2-cell pasture.
    p.fences = [hEdge(0, 3), hEdge(0, 4), hEdge(1, 3), hEdge(1, 4), vEdge(0, 3), vEdge(0, 5)];
    p.fencesBuilt = p.fences.length;
    p.resources.wood = 5;
    const plans = suggestFencePlans(p);
    // The interior edge v-0-4 subdivides 3|4 into two pastures.
    const split = plans.find((pl) => pl.edges.length === 1 && pl.edges[0] === vEdge(0, 4));
    expect(split).toBeTruthy();
    const ns = applyPlacement(s, 0, { action: "r_fences", edges: split!.edges } as never).state;
    const layout = ns.players[0]!.fences;
    expect(layout).toContain(vEdge(0, 4));
  });

  it("r_fences stays AVAILABLE when only a subdivision is possible (farm otherwise full)", () => {
    const s = fenceFreePlayer();
    const p = s.players[0]!;
    // Fill every non-pasture cell with a field/room so no NEW pasture can form,
    // leaving only cells 3,4 as an existing pasture that can be subdivided.
    p.fences = [hEdge(0, 3), hEdge(0, 4), hEdge(1, 3), hEdge(1, 4), vEdge(0, 3), vEdge(0, 5)];
    p.fencesBuilt = p.fences.length;
    for (let i = 0; i < 15; i++) {
      if (i === 3 || i === 4) continue;
      p.spaces[i]!.kind = i % 2 === 0 ? "field" : "room";
      p.spaces[i]!.stable = false;
    }
    p.resources.wood = 5;
    const fences = legalActions(s, 0).find((o) => o.id === "r_fences")!;
    expect(fences.available).toBe(true);
  });
});

describe("availability ⟹ a legal placement exists (consistency sweep)", () => {
  /** Drive a game by picking a random available space and playing the engine's
   *  canonical placement for it; at every step assert that EVERY available space
   *  yields a constructible placement the engine accepts. */
  function sweep(numPlayers: number, seed: number) {
    let s = newGame({ seed, numPlayers });
    const rng = makeRng(seed * 7 + 1);
    let guard = 0;
    while (s.phase !== "finished" && guard++ < 800) {
      if (s.phase === "feeding") {
        const fidx = s.toFeed[0]!;
        s = applyFeeding(s, fidx, computeAutoFeed(s, fidx)).state;
        continue;
      }
      const idx = s.currentPlayer;
      const choices = playerChoices(s, idx);
      const options = legalActions(s, idx);
      const available = options.filter((o) => o.available);

      for (const opt of available) {
        const placement = canonicalPlacement(s, idx, opt, choices);
        expect(
          placement,
          `available space ${opt.id} produced no constructible placement (round ${s.round})`,
        ).not.toBeNull();
        // Probe on a clone (applyPlacement clones internally) — must not throw.
        expect(
          () => applyPlacement(s, idx, placement as never),
          `available space ${opt.id} was rejected by the engine (round ${s.round})`,
        ).not.toThrow();
      }

      if (available.length === 0) break;
      const pick = available[randInt(rng, available.length)]!;
      const placement = canonicalPlacement(s, idx, pick, choices)!;
      s = applyPlacement(s, idx, placement as never).state;
    }
    return s;
  }

  for (const n of [1, 2, 3, 4]) {
    for (const seed of [1, 2, 3, 5, 8]) {
      it(`${n}-player seed ${seed}: every available space is playable at every step`, () => {
        const s = sweep(n, seed);
        // Sweeps should reach a real terminal or stall only on a fully-occupied
        // board; either way they must never have thrown above.
        expect(["work", "feeding", "finished"]).toContain(s.phase);
      });
    }
  }
});

describe("choices match engine ground truth", () => {
  it("legalStables are exactly the spaces buildStables accepts (incl. pasture cells)", () => {
    const s = fenceFreePlayer();
    const p = s.players[0]!;
    // Put a pasture on cell 4 so we can confirm a stable is allowed inside it.
    p.fences = edgesOfCell(4);
    p.fencesBuilt = p.fences.length;
    p.resources.wood = 2;
    const choices = playerChoices(s, 0);
    expect(choices.legalStables).toContain(4); // stable allowed inside a pasture
    const ns = applyPlacement(s, 0, {
      action: "farm_expansion",
      rooms: [],
      stables: [4],
    } as never).state;
    expect(ns.players[0]!.spaces[4]!.stable).toBe(true);
  });

  it("an unaffordable improvement leaves r_improvement unavailable", () => {
    const s = fenceFreePlayer();
    const p = s.players[0]!;
    if (!s.actionSpaces.some((a) => a.id === "r_improvement")) {
      s.actionSpaces.push({ id: "r_improvement", occupiedBy: null, pile: {} });
    }
    p.resources = { wood: 0, clay: 0, reed: 0, stone: 0, grain: 0, vegetable: 0, food: 0 };
    p.handMinors = [];
    const fences = legalActions(s, 0).find((o) => o.id === "r_improvement")!;
    expect(fences.available).toBe(false);
    expect(() =>
      applyPlacement(s, 0, {
        action: "r_improvement",
        improvement: { kind: "major", card: "well" },
      } as never),
    ).toThrow(RuleError);
  });
});
