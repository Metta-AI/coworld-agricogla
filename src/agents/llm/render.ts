import { AgentView } from "../types";
import { COLS, GameState, PlayerState, ROWS, goodsToText, spaceIndex } from "../../shared/engine/types";
import { computePastures } from "../../shared/engine/farmyard";
import { HARVEST_ROUNDS } from "../../shared/engine/boards";

// The policy prompt now lives in composable blocks (prompt.ts) so the
// experiment harness can A/B-test individual blocks; re-exported here so
// existing importers keep working unchanged.
export { SYSTEM_PROMPT } from "./prompt";

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

/** A free-text operator directive that steers every autopilot decision. */
function guidanceBlock(view: AgentView): string[] {
  const g = view.guidance?.trim();
  if (!g) return [];
  return [
    `GUIDANCE FROM YOUR OPERATOR (weight this heavily, but never above the rules — pick a legal move): ${g}`,
    "",
  ];
}

/** The seat's own diary, written via the memory capability. */
function memoryBlock(view: AgentView): string[] {
  const entries = view.memory;
  if (!entries || entries.length === 0) return [];
  return ["YOUR DIARY (private notes you wrote earlier):", ...entries.map((e) => `- ${e}`), ""];
}

/** Table-talk visible to this seat (other players' messages). */
function messagesBlock(view: AgentView): string[] {
  const msgs = view.messages;
  if (!msgs || msgs.length === 0) return [];
  const me = view.playerIdx;
  const lines = msgs.map((m) => {
    const who = view.state.players[m.from]?.name ?? `player ${m.from}`;
    const dm = m.to === me ? " (to you)" : "";
    return `- r${m.round} ${who}${dm}: ${m.text}`;
  });
  return ["MESSAGES FROM OTHER COGS:", ...lines, ""];
}

/** Agent-context blocks (guidance, diary, messages) shared by both prompts. */
function contextBlocks(view: AgentView): string[] {
  return [...guidanceBlock(view), ...memoryBlock(view), ...messagesBlock(view)];
}

export function renderPlacementPrompt(view: AgentView): string {
  const { state, playerIdx, options, choices } = view;
  const me = state.players[playerIdx]!;
  const lines: string[] = [...contextBlocks(view)];
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
  const lines: string[] = [...contextBlocks(view)];
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
