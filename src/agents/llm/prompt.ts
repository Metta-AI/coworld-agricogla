/** The autopilot policy prompt, broken into independently-iterable blocks.
 *
 *  The experiment harness (`src/experiments/`) A/B-tests prompt variants by
 *  swapping individual blocks, so each block must stand on its own. The
 *  DEFAULT_BLOCKS below compose, byte-for-byte, into the policy that ships —
 *  that is the A/B baseline. Candidate variants override one or more blocks.
 *
 *  The three iterable surfaces of the policy map onto:
 *    - the system prompt blocks here (rules / strategy / output discipline),
 *    - the *state* rendering in `render.ts` (how the board is described), and
 *    - the per-seat `guidance` directive (operator steering, see render.ts).
 */

export interface PromptBlocks {
  /** One-line framing of who the model is. */
  intro: string;
  /** The factual rules the model needs to make legal, sensible moves. */
  rules: string;
  /** Heuristic strategy advice (the most fruitful thing to iterate on). */
  strategy: string;
  /** Output discipline: how to answer (tool call, decisiveness). */
  output: string;
}

export const DEFAULT_BLOCKS: PromptBlocks = {
  intro:
    "You are playing Agricogla, a worker-placement farming game, as one of the players.",
  // The "Major improvements" cheatsheet was added after A/B testing
  // (cand-major-ability-cheatsheet): the board renders majors as name/cost/vp
  // only, so the model bought grain-only ovens during animal-food crises.
  // Showing the engine-verified abilities cut begging (+3.0/seat) with no
  // collateral across n=4 and n=8 runs. See experiments/findings-iter2.md.
  rules: `Key rules:
- 14 rounds in 6 stages; harvests after rounds 4, 7, 9, 11, 13, 14.
- Each round you place your family members one at a time on UNOCCUPIED action spaces.
- At each harvest: sown fields yield 1 crop each, then you must pay 2 food per family member (newborns 1), then animals breed (+1 per type with 2+ if there is room). Missing food = begging cards at -3 points each.
- Grain/vegetables convert to 1 food raw anytime; animals need a cooking improvement (e.g. Fireplace).
- Rooms cost 5 of your house material + 2 reed each. Renovation upgrades wood->clay->stone. Family growth needs more rooms than family members (except the stage-5 urgent space).
- Fences enclose pastures (1 wood each, 15 max). Pasture capacity: 2 animals per space, doubled per stable inside. One animal type per pasture; your house also holds 1 pet.
- Scoring rewards balance: fields, pastures, grain, vegetables, sheep, boar, cattle, big family, renovated rooms; -1 per unused space; cards give points too.
- Major improvements (the board lists only their name/cost/vp, so know what each DOES before buying):
  - Fireplace (2 or 3 clay): cook ANYTIME sheep->2, boar->2, cattle->3, veg->2 food; bake each grain->2. The cheapest way to turn animals into food.
  - Cooking Hearth (4 or 5 clay, or return a Fireplace): cook ANYTIME sheep->2, boar->3, cattle->4, veg->3; bake each grain->3. Best animal cooker.
  - Clay Oven (3 clay + 1 stone) and Stone Oven (1 clay + 3 stone): BAKE GRAIN ONLY (Clay: 1 grain->5; Stone: up to 2 grain->4 each). They do NOT cook animals or veg. Only buy with a grain pipeline (sown fields); useless for an animal/food crisis.
  - Joinery (2 wood+2 stone), Pottery (2 clay+2 stone), Basketmaker's Workshop (2 reed+2 stone): EACH harvest may convert 1 wood/clay/reed -> 2/2/3 food, plus end-game bonus points for stockpiled wood/clay/reed. Recurring food + points -- buy EARLY so the per-harvest food accrues.
  - Well (1 wood+3 stone, 4 vp): places 1 food on each of the next 5 round spaces, paid to you at reveal. Buy EARLY to collect all 5 food; buying it late wastes the food.`,
  strategy:
    "Strategy basics: feed the family first (begging is terrible), grow the family as early as housing allows (each member = 3 points + an extra action), don't leave whole categories at -1, and convert spare resources into points late.",
  output:
    "You will get the current state and your options. Reply by calling submit_placement (or submit_feeding when asked to feed) exactly once with a legal choice. Be decisive; no extra commentary.",
};

/** Compose blocks into a single system prompt. Empty blocks are dropped so a
 *  variant can ablate a block by setting it to "". */
export function composeSystemPrompt(blocks: PromptBlocks): string {
  return [blocks.intro, blocks.rules, blocks.strategy, blocks.output]
    .map((b) => b.trim())
    .filter(Boolean)
    .join("\n\n");
}

/** The shipped policy: DEFAULT_BLOCKS composed. */
export const SYSTEM_PROMPT = composeSystemPrompt(DEFAULT_BLOCKS);

/** Optional autopilot capabilities, toggled per variant so the A/B harness can
 *  measure whether they help. Off by default (baseline = shipped behavior). */
export interface Capabilities {
  /** A private diary the model writes to and reads back on later turns. */
  memory: boolean;
  /** Reading and sending table-talk messages to/from the other players. */
  chat: boolean;
}

export const NO_CAPABILITIES: Capabilities = { memory: false, chat: false };

/** System-prompt instructions explaining the enabled capabilities. This text is
 *  constant for a game, so it lives in the cached system prefix; the actual
 *  diary contents and incoming messages go in the per-turn user message. */
export function capabilitySuffix(cap: Capabilities): string {
  const parts: string[] = [];
  if (cap.memory) {
    parts.push(
      "DIARY: You keep a private diary that persists across your turns. Add `diary` to your tool call to save a short note to your future self — a plan, what you are saving resources for, an opponent's pattern. Your current diary is shown with the state each turn. Keep it terse; revise your plan as the game changes.",
    );
  }
  if (cap.chat) {
    parts.push(
      "MESSAGES: You can post one short public message to the other players by adding `say` to your tool call (optional). Messages other players sent are shown with the state. Use talk to coordinate, trade, bluff, or apply pressure — but your placement is what actually scores.",
    );
  }
  return parts.length ? `\n\n${parts.join("\n\n")}` : "";
}
