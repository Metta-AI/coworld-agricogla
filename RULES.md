# Agricogla — Rules Reference

This document is the complete, systematic rules specification implemented by the
engine in `src/shared/engine/`. It is written in our own words; the mechanics
follow the original base game (1–4 players; solo adjustments included). Where the
engine makes a digital-port decision (e.g. automatic animal packing) it is called
out with **[port]**.

---

## 1. Overview

- Players: 1–4. Each player develops a farm on a private 3×5 farmyard grid.
- The game lasts **14 rounds** grouped into **6 stages**. A **harvest** happens at
  the end of each stage — after rounds **4, 7, 9, 11, 13 and 14**.
- Each round, every family member takes exactly one action by being placed on an
  unoccupied action space. New action spaces appear each round (round cards).
- Highest score after the round-14 harvest wins. Ties share the win.

### Goods

- **Building resources:** wood, clay, reed, stone.
- **Crops:** grain, vegetable.
- **Animals:** sheep, wild boar, cattle.
- **Food.**

Building resources, crops and food sit in a player's personal supply. Animals may
never sit in the supply — they must be accommodated on the farm immediately or be
converted to food (requires a cooking improvement) or returned to the general
supply.

## 2. Setup

- Every player starts with a farmyard of 15 spaces (3 rows × 5 columns), with
  **2 wooden rooms** in the leftmost column (rows 1 and 2, i.e. middle-left and
  bottom-left) and **2 family members** living in them.
- Starting player (chosen at random per game seed): **2 food**; all other
  players: **3 food**. **Solo game: 0 food.**
- Full game: each player is dealt **7 occupations** and **7 minor improvements**.
- The **10 major improvements** are laid out on a shared board.
- The 14 **round cards** are shuffled within their stages and stacked so that the
  stage-1 cards come up first:
  - Stage 1 = rounds 1–4 (4 cards), Stage 2 = rounds 5–7 (3), Stage 3 = rounds
    8–9 (2), Stage 4 = rounds 10–11 (2), Stage 5 = rounds 12–13 (2), Stage 6 =
    round 14 (1).

## 3. Round sequence

Each round has four phases:

1. **Reveal** — turn over the next round card; its action space is available
   from this round on. Effects that trigger "at the start of a round" happen
   now, and any goods that were scheduled onto this round's space (e.g. by the
   Well) are paid out to their owners.
2. **Replenish** — every *accumulation space* (marked ⟳ below) receives its
   goods. Goods pile up on unused spaces with no limit.
3. **Work** — beginning with the starting player and proceeding in seat order,
   each player in turn places **one** family member on an unoccupied action
   space and resolves it immediately. Skip players with no family members left.
   Continue until everyone has placed all family members. A placed member must
   perform at least one of the actions offered by the space; a space offering
   "A and/or B" requires doing at least one of A, B.
4. **Return home** — all family members return to the house.

If the round is the last of a stage, a **harvest** follows (section 7).

## 4. Action spaces

### 4.1 Always printed on the boards (all player counts)

| Space | Effect |
| --- | --- |
| Farm Expansion | Build any number of rooms at 5 wood + 2 reed each, and/or build up to 4 stables total at 2 wood each |
| Meeting Place | Become starting player, and/or play 1 minor improvement (paying its cost) |
| Grain Seeds | Take 1 grain |
| Farmland | Plow 1 field |
| Lessons | Play 1 occupation: a player's first occupation is free, each later one costs 1 food |
| Day Laborer | Take 2 food |
| Forest ⟳ | 3 wood per round (**solo: 2 wood**) |
| Clay Pit ⟳ | 1 clay per round |
| Reed Bank ⟳ | 1 reed per round |
| Fishing ⟳ | 1 food per round |

### 4.2 Extra spaces in the 3-player game

| Space | Effect |
| --- | --- |
| Grove ⟳ | 2 wood per round |
| Hollow ⟳ | 1 clay per round |
| Quarry Stall | Take 1 stone (does not accumulate) |
| Lessons II | Play 1 occupation, paying 2 food (always) |

### 4.3 Extra spaces in the 4-player game

| Space | Effect |
| --- | --- |
| Copse ⟳ | 1 wood per round |
| Grove ⟳ | 2 wood per round |
| Hollow ⟳ | 2 clay per round |
| Resource Market | Take 1 reed + 1 stone + 1 food (does not accumulate) |
| Traveling Players ⟳ | 1 food per round |
| Lessons II | Play 1 occupation: 1 food if it is your 1st or 2nd occupation, otherwise 2 food |

### 4.4 Round cards (one revealed per round)

- **Stage 1 (rounds 1–4, order shuffled):**
  - **Major or Minor Improvement** — buy 1 major improvement or play 1 minor improvement.
  - **Sheep Market ⟳** — 1 sheep per round; take all sheep on the space.
  - **Fences** — build fences at 1 wood each (max 15 per player overall).
  - **Sow and/or Bake bread.**
- **Stage 2 (rounds 5–7):**
  - **Western Quarry ⟳** — 1 stone per round.
  - **Renovation, then Major or Minor Improvement** — renovate your home; afterwards you may also buy/play one improvement. The improvement is only available after performing the renovation.
  - **Family Growth, then Minor Improvement** — only if rooms > family members; gain 1 newborn, then you may also play one minor improvement.
- **Stage 3 (rounds 8–9):**
  - **Vegetable Seeds** — take 1 vegetable.
  - **Pig Market ⟳** — 1 wild boar per round.
- **Stage 4 (rounds 10–11):**
  - **Eastern Quarry ⟳** — 1 stone per round.
  - **Cattle Market ⟳** — 1 cattle per round.
- **Stage 5 (rounds 12–13):**
  - **Urgent Family Growth** — family growth **without** needing room (still max 5 family members).
  - **Cultivation** — plow 1 field and/or sow.
- **Stage 6 (round 14):**
  - **Farm Redevelopment** — renovate; afterwards you may also build fences.

All accumulation spaces hand over **everything** on them when used.

## 5. The actions in detail

### 5.1 Rooms & renovation

- New rooms must be orthogonally adjacent to an existing room and made of the
  same material as the house (wood → wooden rooms, etc.). No upper limit on
  rooms (beyond empty farmyard spaces). Cost per room: 5 wood + 2 reed (wooden),
  5 clay + 2 reed (clay), 5 stone + 2 reed (stone).
- **Renovation** upgrades the whole house exactly one step (wood→clay or
  clay→stone), all rooms at once: pay 1 unit of the new material **per room**
  plus exactly **1 reed** total. One renovation per renovation action.

### 5.2 Stables

- Max 4 stables per player, 1 per farmyard space, 2 wood each (Farm Expansion).
- A stable may be placed on any space without a room or field (empty space or
  inside a pasture). Stables are never removed.
- Each stable inside a pasture **doubles that pasture's capacity** (2 stables =
  ×4, …). An unfenced stable holds exactly 1 animal and counts the space as used.

### 5.3 Fields & sowing

- **Plow 1 field**: place a field on an empty space; if you already have fields,
  the new field must be orthogonally adjacent to one. At most one "plow"
  improvement may be used per plow action.
- **Sow**: for each empty (unsown) field you choose, plant 1 grain from your
  supply (the field then holds **3** grain) or 1 vegetable (the field then holds
  **2** vegetables). You may sow any number of empty fields in one Sow action.
- A field that has been emptied by harvests may be re-sown; it does not need
  re-plowing.

### 5.4 Bake bread

- Baking converts grain from your supply to food using an improvement with a
  baking ability: Fireplace 1 grain→2 food (any number of grain? **No** — see
  card list: Fireplace/Cooking Hearth convert any number of grain per bake
  action; Clay Oven at most 1 grain →5 food per bake action; Stone Oven at most
  2 grain →4 food each per bake action). Multiple baking improvements may be
  combined in a single Bake action, each within its own limit.
- Buying the Clay Oven or Stone Oven grants an immediate one-time Bake action.

### 5.5 Fences & pastures

- Fences are built on edges between farmyard spaces or on the farmyard border.
  1 wood per fence; lifetime maximum 15 fences per player; fences are never torn
  down.
- After building, **every fence must form part of the boundary of a fully
  enclosed pasture**; pastures may not contain rooms, fields, (fenced) areas may
  contain stables. The farmyard border does **not** count as a fence — enclosure
  requires built fences on all sides. Existing pastures may be subdivided; new
  pastures must be orthogonally adjacent to existing pastures if there are any.
- A pasture's capacity is 2 animals per space, doubled for each stable in it.
  Each pasture holds only **one animal type** at a time.

### 5.6 Animals

- Holding capacity: pastures (above), unfenced stables (1 each), plus the house
  (exactly 1 "pet" of any type), plus capacity printed on improvement/occupation
  cards.
- Animals may be rearranged at any time. Acquired animals that cannot be
  accommodated must immediately be cooked (with a cooking improvement) or
  returned to the supply. **[port]** The engine packs animals automatically to
  maximize retention (players choose what to cook/release when over capacity);
  this is strategically equivalent because rearrangement is free.

### 5.7 Occupations & improvements

- **Lessons** spaces play occupations from your hand (costs per space above).
- **Minor improvements** are played from hand via Meeting Place, the Improvement
  round card, or "then improvement" actions; pay the cost in the top-right;
  some require prerequisites (e.g. N occupations). Crops paid as costs come from
  the supply, not from fields.
- **Major improvements** are bought from the shared board. The Cooking Hearth
  may alternatively be acquired by **returning a Fireplace** (the Fireplace goes
  back to the board and may be bought again).
- Minor improvements marked **(passing)** are handed to the left-hand neighbor
  after being played.

### 5.8 Family growth

- Standard family growth (stage 2 card): requires rooms > family members.
- Urgent family growth (stage 5 card): no room requirement.
- Max 5 family members. The newborn takes its action starting **next** round and
  eats only **1 food** at a harvest in the round it was born (2 thereafter).

## 6. Conversions available at any time

- 1 grain → 1 food; 1 vegetable → 1 food (no improvement needed).
- Cooking improvements convert animals/vegetables to food at their printed rates
  at any time (notably during feeding).
- Raw (uncooked) animals have **no** food value.

## 7. Harvest (after rounds 4, 7, 9, 11, 13, 14)

1. **Field phase** — remove 1 grain / 1 vegetable from **each** sown field into
   the owner's supply. Harvest-time card effects trigger.
2. **Feeding** — every player pays **2 food per family member** (1 per newborn
   born this round; **solo: 3 food per member**). Conversions (section 6) may be
   used. Each missing food = 1 **begging card** (−3 points at the end).
3. **Breeding** — for each animal type of which a player has **at least 2**,
   exactly **1** offspring is born if it can be accommodated (rearrangement
   allowed; the newborn may **not** be immediately cooked — if there is no room
   it is simply not received).

## 8. End of game & scoring

After the harvest of round 14, score per player:

| Category | −1 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| Fields (tiles) | 0–1 | 2 | 3 | 4 | 5+ |
| Pastures (count) | 0 | 1 | 2 | 3 | 4+ |
| Grain (supply + on fields) | 0 | 1–3 | 4–5 | 6–7 | 8+ |
| Vegetables (supply + fields) | 0 | 1 | 2 | 3 | 4+ |
| Sheep | 0 | 1–3 | 4–5 | 6–7 | 8+ |
| Wild boar | 0 | 1–2 | 3–4 | 5–6 | 7+ |
| Cattle | 0 | 1 | 2–3 | 4–5 | 6+ |

Plus:

- **−1** per unused farmyard space (a space is *used* if it has a room, field,
  stable, or is part of a pasture).
- **+1** per fenced stable (stable inside a pasture).
- Rooms: clay **+1** each, stone **+2** each (wooden rooms 0).
- **+3** per family member (max 15).
- **−3** per begging card.
- Victory points printed on played improvements/occupations, plus card **bonus
  points** (e.g. workshop majors, Tutor-style cards).

## 9. Major improvements (exact)

| Card | Cost | VP | Ability |
| --- | --- | --- | --- |
| Fireplace | 2 clay | 1 | Cook anytime: sheep→2, boar→2, cattle→3, veg→2 food. Bake: each grain→2 food |
| Fireplace | 3 clay | 1 | identical |
| Cooking Hearth | 4 clay *or* return a Fireplace | 1 | Cook anytime: sheep→2, boar→3, cattle→4, veg→3. Bake: each grain→3 food |
| Cooking Hearth | 5 clay *or* return a Fireplace | 1 | identical |
| Clay Oven | 3 clay + 1 stone | 2 | Bake: at most 1 grain → 5 food per bake action. Immediate bake on purchase |
| Stone Oven | 1 clay + 3 stone | 3 | Bake: at most 2 grain → 4 food each per bake action. Immediate bake on purchase |
| Joinery | 2 wood + 2 stone | 2 | Each harvest: may convert 1 wood → 2 food. End: 3/5/7 wood → 1/2/3 bonus pts |
| Pottery | 2 clay + 2 stone | 2 | Each harvest: may convert 1 clay → 2 food. End: 3/5/7 clay → 1/2/3 bonus pts |
| Basketmaker's Workshop | 2 reed + 2 stone | 2 | Each harvest: may convert 1 reed → 3 food. End: 2/4/5 reed → 1/2/3 bonus pts |
| Well | 1 wood + 3 stone | 4 | Place 1 food on each of the next 5 round spaces (paid out at reveal) |

## 10. Occupations & minor improvements

The full game ships with a deck of **51 occupations** and **48 minor
improvements**, every one fully implemented (see `src/shared/engine/cards/`).
The deck reproduces the canonical archetypes of the base decks — resource
bonuses on action spaces, plows, baking/cooking engines, building discounts,
animal capacity, harvest food, bonus-point cards, passing (traveling) cards —
with effects expressed through the engine's hook system. Card texts are written
for this port; provenance notes live in the card data files.

## 11. Solo game

- Start with 0 food; feeding costs **3 food** per family member.
- The Forest accumulates only 2 wood per round.
- No green action cards. All other rules unchanged.

## 12. Digital-port decisions **[port]**

- Animal packing is automatic and optimal; over-capacity intake asks the player
  what to cook/release.
- Feeding conversions are chosen explicitly by each player (UI dialog / agent
  decision) with an auto-feed fallback that never wastes higher-value goods.
- Turn order is seat order; the starting-player marker works as in the rules.
- 5-player play is out of scope (the engine validates 1–4).
