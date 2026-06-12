import { AgentView } from "../types";
import { COLS, GameState, PlayerState, ROWS, goodsToText, spaceIndex } from "../../shared/engine/types";
import { computePastures } from "../../shared/engine/farmyard";
import { HARVEST_ROUNDS } from "../../shared/engine/boards";

export const SYSTEM_PROMPT = `You are playing Agricola, a worker-placement farming game, as one of the players.

Key rules:
- 14 rounds in 6 stages; harvests after rounds 4, 7, 9, 11, 13, 14.
- Each round you place your family members one at a time on UNOCCUPIED action spaces.
- At each harvest: sown fields yield 1 crop each, then you must pay 2 food per family member (newborns 1), then animals breed (+1 per type with 2+ if there is room). Missing food = begging cards at -3 points each.
- Grain/vegetables convert to 1 food raw anytime; animals need a cooking improvement (e.g. Fireplace).
- Rooms cost 5 of your house material + 2 reed each. Renovation upgrades wood->clay->stone. Family growth needs more rooms than family members (except the stage-5 urgent space).
- Fences enclose pastures (1 wood each, 15 max). Pasture capacity: 2 animals per space, doubled per stable inside. One animal type per pasture; your house also holds 1 pet.
- Scoring rewards balance: fields, pastures, grain, vegetables, sheep, boar, cattle, big family, renovated rooms; -1 per unused space; cards give points too.

Strategy basics: feed the family first (begging is terrible), grow the family as early as housing allows (each member = 3 points + an extra action), don't leave whole categories at -1, and convert spare resources into points late.

You will get the current state and your options. Reply by calling submit_placement (or submit_feeding when asked to feed) exactly once with a legal choice. Be decisive; no extra commentary.`;

function farmText(player: PlayerState): string {
  const layout = computePastures(player.spaces, player.fences);
  const rows: string[] = [];
  for (let r = 0; r < ROWS; r++) {
    const cells: string[] = [];
    for (let c = 0; c < COLS; c++) {
      const i = spaceIndex(r, c);
      const sp = player.spaces[i]!;
      let cell =
        sp.kind === "room"
          ? player.houseMaterial[0]!.toUpperCase() + "room"
          : sp.kind === "field"
            ? sp.crop
              ? `field:${sp.crop}x${sp.cropCount}`
              : "field"
            : layout.pastureCells.has(i)
              ? "pasture"
              : "empty";
      if (sp.stable) cell += "+stable";
      cells.push(`${i}=${cell}`);
    }
    rows.push(cells.join(" "));
  }
  const pastures = layout.pastures
    .map((p) => `[cells ${p.cells.join(",")} cap ${p.capacity}]`)
    .join(" ");
  return `${rows.join("\n")}\nPastures: ${pastures || "none"}`;
}

export function renderPlacementPrompt(view: AgentView): string {
  const { state, playerIdx, options, choices } = view;
  const me = state.players[playerIdx]!;
  const lines: string[] = [];
  const harvest = HARVEST_ROUNDS.has(state.round) ? " (HARVEST after this round)" : "";
  lines.push(`Round ${state.round}/14${harvest}. You are ${me.name} (player ${playerIdx}).`);
  lines.push(
    `Your supply: ${goodsToText(me.resources)} | animals: ${goodsToText(me.animals)} | family ${me.family.length} | begging ${me.beggingCards}`,
  );
  lines.push(`Food needed at next harvest: ${choices.foodNeededNow}`);
  lines.push(`Your farm (15 spaces, 3 rows x 5 cols):\n${farmText(me)}`);
  lines.push(
    `Legal room spaces: ${choices.legalRooms.join(",") || "none"} (cost ${goodsToText(choices.roomCost)}); field spaces: ${choices.legalFields.join(",") || "none"}; stable spaces left: ${choices.stablesLeft}`,
  );
  if (choices.renovation) lines.push(`Renovation cost: ${goodsToText(choices.renovation)}`);
  lines.push(
    `Sowable fields: ${choices.sowableFields.join(",") || "none"}; bake options: ${choices.bakeOptions.map((b) => `${b.card}(${b.maxGrain}x->${b.perGrain})`).join(" ") || "none"}`,
  );

  if (choices.handOccupations.length > 0) {
    lines.push("Your occupations in hand:");
    for (const c of choices.handOccupations) {
      lines.push(`- ${c.id}: ${c.name}${c.prereqOk ? "" : ` (needs ${c.prereqLabel})`} — ${c.text}`);
    }
  }
  if (choices.handMinors.length > 0) {
    lines.push("Your minor improvements in hand:");
    for (const c of choices.handMinors) {
      lines.push(
        `- ${c.id}: ${c.name} cost ${goodsToText(c.cost)}${c.affordable ? "" : " (can't afford)"}${c.prereqOk ? "" : ` (needs ${c.prereqLabel})`} — ${c.text}`,
      );
    }
  }
  lines.push("Major improvements on offer:");
  for (const c of choices.majors) {
    lines.push(
      `- ${c.id}: ${c.name} cost ${goodsToText(c.cost)} vp ${c.vp}${c.affordable ? "" : " (can't afford)"}`,
    );
  }
  if (choices.fencePlans.length > 0) {
    lines.push("Suggested fence plans (edges -> cost):");
    for (const plan of choices.fencePlans.slice(0, 6)) {
      lines.push(`- cells ${plan.cells.join(",")} cost ${plan.cost}: ${plan.edges.join(" ")}`);
    }
  }

  lines.push("Action spaces:");
  for (const o of options) {
    const pile = Object.keys(o.pile).length ? ` [${goodsToText(o.pile)}]` : "";
    const status = o.available ? "OPEN" : `closed: ${o.reason ?? "occupied"}`;
    lines.push(`- ${o.id}: ${o.title}${pile} — ${o.summary} (${status})`);
  }

  lines.push("Other players:");
  for (const p of state.players) {
    if (p.idx === playerIdx) continue;
    lines.push(
      `- ${p.name}: family ${p.family.length}, ${goodsToText(p.resources)}, animals ${goodsToText(p.animals)}`,
    );
  }
  lines.push("Place one family member: call submit_placement with one OPEN action and its arguments.");
  return lines.join("\n");
}

export function renderFeedingPrompt(view: AgentView): string {
  const { state, playerIdx, choices } = view;
  const me = state.players[playerIdx]!;
  const lines: string[] = [];
  lines.push(`Harvest feeding, round ${state.round}. You are ${me.name}.`);
  lines.push(`You must pay ${choices.foodNeededNow} food. You have ${me.resources.food} food.`);
  lines.push(
    `Supply: ${goodsToText(me.resources)} | animals: ${goodsToText(me.animals)}`,
  );
  lines.push("Available conversions (use via+good+count):");
  for (const c of choices.conversionOptions) {
    lines.push(`- via "${c.via}" ${c.good}: ${c.foodEach} food each (max ${c.max})`);
  }
  lines.push(
    "Call submit_feeding with the conversions you want (possibly none). Shortfall becomes begging cards (-3 points each). Keep breeding pairs (2 of a type) alive when you reasonably can.",
  );
  return lines.join("\n");
}

export function summarizeState(state: GameState): string {
  return state.players
    .map(
      (p) =>
        `${p.name}: family ${p.family.length}, food ${p.resources.food}, begging ${p.beggingCards}`,
    )
    .join(" | ");
}
