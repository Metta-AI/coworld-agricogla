import { AgentView } from "./types";
import { Placement } from "../shared/engine/placements";
import { cardById } from "../shared/engine/cards";
import { bestCookRate } from "../shared/engine/effects";
import { computePastures } from "../shared/engine/farmyard";
import { HARVEST_ROUNDS } from "../shared/engine/boards";
import { ANIMALS, Resource } from "../shared/engine/types";

export interface Candidate {
  placement: Placement;
  value: number;
  label: string;
}

function nextHarvestIn(round: number): number {
  for (let r = round; r <= 14; r++) if (HARVEST_ROUNDS.has(r)) return r - round;
  return 14 - round;
}

/** Empty, unstabled, unpastured cells: each scores -1 at the end. */
function countUnused(view: AgentView): number {
  const player = view.state.players[view.playerIdx]!;
  const layout = computePastures(player.spaces, player.fences);
  return player.spaces.filter(
    (sp, i) => sp.kind === "empty" && !sp.stable && !layout.pastureCells.has(i),
  ).length;
}

/** Static desirability of occupations for the scripted bot. */
function occupationValue(id: string, round: number): number {
  const card = cardById(id);
  let v = (card.vp ?? 0) * 2;
  if (card.onGain) v += round <= 7 ? 5 : 2;
  if (card.cook) v += 4;
  if (card.capacity) v += 3;
  if (card.roomDiscount) v += round <= 8 ? 4 : 1;
  if (card.plowExtra) v += 3;
  if (card.onHarvest) v += 4;
  if (card.bonusVp) v += 3;
  if (card.onPlay) v += 2;
  return v;
}

function minorValue(id: string): number {
  const card = cardById(id);
  let v = (card.vp ?? 0) * 2;
  if (card.cook) v += 3;
  if (card.capacity) v += 3;
  if (card.onPlay) v += 2;
  if (card.onGain || card.onHarvest || card.onRoundStart) v += 3;
  if (card.plowExtra) v += 2;
  return v;
}

/** Enumerate concrete, legal-ish candidate placements with heuristic values.
 *  Everything returned passes shape validation; rule legality is ensured by
 *  building from PlayerChoices data. */
export function enumerateCandidates(view: AgentView): Candidate[] {
  const { state, choices, options } = view;
  const player = state.players[view.playerIdx]!;
  const out: Candidate[] = [];
  const round = state.round;
  const family = player.family.length;
  const rooms = player.spaces.filter((s) => s.kind === "room").length;
  const fields = player.spaces.filter((s) => s.kind === "field").length;
  const res = player.resources;
  const harvestGap = nextHarvestIn(round);

  const cookRates = Object.fromEntries(
    ANIMALS.map((t) => [t, bestCookRate(player, t)?.food ?? 0]),
  ) as Record<(typeof ANIMALS)[number], number>;
  const hasCooker = ANIMALS.some((t) => cookRates[t] > 0);

  // Projected food at the next harvest: supply + raw crops + cookable animals
  // + crops the fields will yield at harvest.
  const cookValue = choices.conversionOptions
    .filter((c) => c.via !== "raw")
    .reduce((s, c) => s + c.foodEach * c.max, 0);
  const fieldYield = player.spaces.filter((sp) => sp.kind === "field" && sp.cropCount > 0).length;
  const expectedFood = res.food + res.grain + res.vegetable + cookValue + fieldYield;
  const deficit = choices.foodNeededNow - expectedFood;
  // 0 = comfortable, up to ~4 = starving with the harvest imminent.
  const urgency = deficit > 0 ? Math.max(1, 4 - harvestGap) : 0;
  const hungry = urgency >= 2;

  const available = new Map(options.filter((o) => o.available).map((o) => [o.id, o]));
  const add = (placement: Placement, value: number, label: string) => {
    if (!available.has(placement.action)) return;
    out.push({ placement, value, label });
  };
  /** Extra value for actions that produce food, scaled by how hungry we are. */
  const foodBonus = (yield_: number) => yield_ * urgency * 2.5;

  // --- family growth: a new member is worth ~3 vp + an action per round, but
  // never grow into a deficit (begging costs more than the member earns).
  const growthValue = deficit > 0 ? 5 : 60 - Math.max(0, deficit + 2) * 8;
  add({ action: "r_family_growth" }, growthValue, "family growth");
  if (round >= 12) {
    add({ action: "r_urgent_family" }, Math.min(40, growthValue), "urgent family growth");
  }

  // --- rooms when the family is housebound.
  const canAffordRoom = Object.entries(choices.roomCost).every(
    ([r, n]) => res[r as Resource] >= (n ?? 0),
  );
  if (choices.legalRooms.length > 0 && canAffordRoom) {
    const value = rooms <= family ? 42 : 12;
    add(
      { action: "farm_expansion", rooms: [choices.legalRooms[0]!], stables: [] },
      value,
      "build room",
    );
  } else if (choices.stablesLeft > 0 && res.wood >= 2 && choices.legalStables.length > 0) {
    // Stables only when we already keep animals.
    const animals = player.animals.sheep + player.animals.boar + player.animals.cattle;
    if (animals > 0) {
      add(
        { action: "farm_expansion", rooms: [], stables: [choices.legalStables[0]!] },
        10,
        "build stable",
      );
    }
  }

  // --- occupations early, but they must not crowd out the food engine.
  for (const spaceId of ["lessons", "lessons_b"] as const) {
    const cost = choices.occupationCostBySpace[spaceId] ?? 0;
    const playable = choices.handOccupations.filter((c) => c.prereqOk);
    if (playable.length > 0 && res.food >= cost) {
      const best = playable.reduce((a, b) =>
        occupationValue(b.id, round) > occupationValue(a.id, round) ? b : a,
      );
      const value =
        (round <= 8 ? 17 : 9) +
        occupationValue(best.id, round) -
        cost * 2 -
        player.occupations.length * 4;
      add({ action: spaceId, occupation: best.id }, value, `occupation ${best.name}`);
    }
  }

  // --- improvements.
  const fireplaceOwned = player.majors.some((m) => m.startsWith("fireplace") || m.startsWith("hearth"));
  const buyableMajors = choices.majors.filter((c) => c.affordable && c.prereqOk);
  let bestMajor: { card: string; value: number } | null = null;
  for (const m of buyableMajors) {
    let v = m.vp * 3;
    if ((m.id === "fireplace2" || m.id === "fireplace3") && !hasCooker) v += 24;
    if (m.id === "well") v += 6;
    if ((m.id === "clay_oven" || m.id === "stone_oven") && res.grain >= 1) v += 5;
    if (m.id.startsWith("hearth") && fireplaceOwned) v -= 6;
    if (!bestMajor || v > bestMajor.value) bestMajor = { card: m.id, value: v };
  }
  const playableMinors = choices.handMinors.filter((c) => c.affordable && c.prereqOk);
  let bestMinor: { card: string; value: number } | null = null;
  for (const m of playableMinors) {
    const v = 8 + minorValue(m.id);
    if (!bestMinor || v > bestMinor.value) bestMinor = { card: m.id, value: v };
  }
  if (bestMajor) {
    add(
      { action: "r_improvement", improvement: { kind: "major", card: bestMajor.card } },
      bestMajor.value,
      `buy ${cardById(bestMajor.card).name}`,
    );
  } else if (bestMinor) {
    add(
      { action: "r_improvement", improvement: { kind: "minor", card: bestMinor.card } },
      bestMinor.value,
      `play ${cardById(bestMinor.card).name}`,
    );
  }
  if (bestMinor) {
    add(
      {
        action: "meeting_place",
        improvement: { kind: "minor", card: bestMinor.card },
      },
      bestMinor.value - 2,
      `meeting place + ${cardById(bestMinor.card).name}`,
    );
  } else {
    add({ action: "meeting_place" }, 4, "starting player");
  }

  // Unused farmyard spaces cost a point each; fill them late.
  const unusedSpaces = options.length > 0 ? countUnused(view) : 0;
  const fillBonus = round >= 10 ? Math.min(10, unusedSpaces * 1.5) : 0;

  // --- fields & sowing.
  if (choices.legalFields.length > 0) {
    const value = (fields < 2 ? 26 : fields < 5 ? 16 : 6) + fillBonus;
    add({ action: "farmland", spaces: [choices.legalFields[0]!] }, value, "plow");
  }
  const sowable = choices.sowableFields;
  if (sowable.length > 0 && (res.grain > 0 || res.vegetable > 0)) {
    const sow: { space: number; crop: "grain" | "vegetable" }[] = [];
    let grain = res.grain;
    let veg = res.vegetable;
    for (const space of sowable) {
      if (veg > 0) {
        sow.push({ space, crop: "vegetable" });
        veg--;
      } else if (grain > 0) {
        sow.push({ space, crop: "grain" });
        grain--;
      }
    }
    if (sow.length > 0) {
      add(
        { action: "r_sow_bake", sow, bake: [] },
        24 + sow.length * 4 + foodBonus(sow.length),
        "sow",
      );
      const cult = sow.slice(0, choices.legalFields.length > 0 ? sow.length : sow.length);
      add(
        {
          action: "r_cultivation",
          plow: choices.legalFields[0],
          sow: cult,
        },
        26 + sow.length * 3,
        "cultivate",
      );
    }
  }
  if (choices.legalFields.length > 0) {
    add({ action: "r_cultivation", plow: choices.legalFields[0]!, sow: [] }, 14, "cultivation plow");
  }
  // Bake when hungry and an oven-ish card is owned.
  if (res.grain > 0 && choices.bakeOptions.length > 0 && (hungry || res.grain >= 3)) {
    const best = choices.bakeOptions.reduce((a, b) => (b.perGrain > a.perGrain ? b : a));
    const grain = Math.min(res.grain, best.maxGrain);
    add(
      { action: "r_sow_bake", sow: [], bake: [{ card: best.card, grain }] },
      6 + grain * best.perGrain + foodBonus(grain * best.perGrain),
      "bake bread",
    );
  }

  // --- fences.
  if (choices.fencePlans.length > 0) {
    const plan = choices.fencePlans.find((p) => p.cells.length >= 2) ?? choices.fencePlans[0]!;
    if (res.wood >= plan.cost) {
      const havePasture = player.fences.length > 0;
      const value = (havePasture ? 12 : round >= 5 ? 30 : 18) + fillBonus;
      add({ action: "r_fences", edges: plan.edges }, value, `fence ${plan.cells.length} cells`);
    }
  }

  // --- renovation (never while the family is hungry).
  if (choices.renovation) {
    const affordable = Object.entries(choices.renovation).every(
      ([r, n]) => res[r as Resource] >= (n ?? 0),
    );
    if (affordable) {
      const value = (round >= 9 ? 22 : 8) - urgency * 6;
      add({ action: "r_renovate_improve" }, value, "renovate");
      add({ action: "r_redevelop", edges: [] }, value, "renovate (redevelopment)");
    }
  }

  // --- animals: points for breeding pairs plus food when cookable.
  const animalOfSpace = { r_sheep: "sheep", r_boar: "boar", r_cattle: "cattle" } as const;
  for (const id of ["r_sheep", "r_boar", "r_cattle"] as const) {
    const opt = available.get(id);
    if (!opt) continue;
    const type = animalOfSpace[id];
    const count = Object.values(opt.pile).reduce((s, n) => s + (n ?? 0), 0);
    if (count === 0) continue;
    const rate = cookRates[type];
    let value = count * (rate > 0 ? 5 : 4) + foodBonus(count * rate);
    // A first breeding pair is future points and offspring.
    if (player.animals[type] === 0 && count >= 2) value += 10;
    add({ action: id }, value, `take ${type}`);
  }

  // --- resource piles, with diminishing returns on what we already hoard.
  const needsRoom = rooms <= family && family < 5;
  const savingForFireplace = !hasCooker && round >= 2;
  const woodHungry = (needsRoom && res.wood < 7) || (player.fencesBuilt < 6 && res.wood < 5);
  const emptyField = player.spaces.some((sp) => sp.kind === "field" && sp.cropCount === 0);
  const wants: Record<string, number> = {
    wood: woodHungry ? 3.2 : 1.8,
    clay: savingForFireplace ? 3.0 : player.houseMaterial === "wood" && round >= 6 ? 2.4 : 1.6,
    reed: needsRoom && res.reed < 2 ? 3.6 : res.reed < 2 ? 2.2 : 1.2,
    stone: round >= 5 ? 2.6 : 1.8,
    food: 1.4 + urgency * 1.8,
    grain: res.grain === 0 ? (emptyField ? 11 : 9) : 4,
    vegetable: 7,
  };
  for (const g of ["wood", "clay", "reed", "stone"] as const) {
    wants[g] = wants[g]! * Math.max(0.3, 1 - res[g] / 10);
  }
  for (const id of [
    "forest",
    "clay_pit",
    "reed_bank",
    "fishing",
    "copse",
    "grove",
    "hollow",
    "quarry_stall",
    "resource_market",
    "traveling_players",
    "r_west_quarry",
    "r_east_quarry",
    "grain_seeds",
    "r_vegetable",
    "day_laborer",
  ] as const) {
    const opt = available.get(id);
    if (!opt) continue;
    let value = 0;
    const pile = { ...opt.pile } as Record<string, number>;
    if (id === "grain_seeds") pile.grain = (pile.grain ?? 0) + 1;
    if (id === "r_vegetable") pile.vegetable = (pile.vegetable ?? 0) + 1;
    if (id === "day_laborer") pile.food = (pile.food ?? 0) + 2;
    if (id === "quarry_stall") pile.stone = (pile.stone ?? 0) + 1;
    if (id === "resource_market") {
      pile.reed = (pile.reed ?? 0) + 1;
      pile.stone = (pile.stone ?? 0) + 1;
      pile.food = (pile.food ?? 0) + 1;
    }
    for (const [g, n] of Object.entries(pile)) value += (wants[g] ?? 1.5) * (n ?? 0);
    add({ action: id } as Placement, value, `take ${id}`);
  }

  return out.sort((a, b) => b.value - a.value);
}
