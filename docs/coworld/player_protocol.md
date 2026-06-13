# Agricogla — player protocol

Agricogla is a turn-based worker-placement game (2 player slots in this
Coworld). Your player container receives `COWORLD_PLAYER_WS_URL` in its
environment: a fully-formed WebSocket URL pointing at the game's `/player`
route with your `slot` and `token` already encoded. Connect to it and answer
observations until the episode ends. All messages are JSON text frames.

## Message flow

1. On connect the server sends `welcome`.
2. Whenever it is your turn to decide, the server sends `observation` and
   waits for your reply (request/response — at most one decision is pending
   at a time).
3. When the game ends the server sends `final` and closes the socket. Exit
   cleanly when you receive it (or when the socket closes).

If your reply is illegal you get the same observation again with `attempt`
incremented and `error` explaining the rejection — you have **3 attempts**
per decision. If you exceed them, reply with garbage, disconnect, or take
longer than the per-decision budget (`act_timeout_seconds`, default 20s), a
built-in scripted heuristic takes that single turn for you and the game
continues. Reconnecting with the same URL re-attaches you to your seat and
re-sends the pending observation.

## Server → player messages

```jsonc
{ "type": "welcome", "slot": 0, "numPlayers": 2, "playerNames": ["…", "…"] }
```

```jsonc
{
  "type": "observation",
  "slot": 0,                 // your seat
  "decisionId": 17,          // echo this in your reply
  "phase": "work",           // "work" (place a worker) or "feeding" (harvest)
  "attempt": 1,              // > 1 means your previous reply was rejected
  "error": null,             // rejection reason when attempt > 1
  "state": { … },            // full game state, other players' hands hidden
  "handSizes": [ … ],        // card counts per player (your hand is in state)
  "options": [ … ],          // action spaces: which are open to you right now
  "choices": { … }           // legal parameter values for parameterized actions
}
```

```jsonc
{ "type": "final", "results": { "scores": [31, 28], "winner": 0, "rounds": 14 }, "state": { … } }
```

`state` is the engine's `GameState`: players (resources, animals, farmyard
`spaces`, fences, family, played cards, hand), `actionSpaces` (occupancy and
accumulated `pile` goods), `round` (1–14), `phase`, `currentPlayer`, `toFeed`
and an event `log`. Your own `handOccupations` / `handMinors` are visible;
opponents' hands are redacted. Hidden information is masked: `seed` is
zeroed and every upcoming `roundDeck` entry reads `"hidden"` (so you cannot
re-derive the deal or peek at the round-card order; simulating past the end
of the current round is therefore not possible from an observation).

`options` entries describe every action space:
`{ id, title, summary, pile, occupiedBy, available, reason? }` — only
`available: true` spaces are legal for you now.

`choices` carries everything needed to fill in parameterized placements:
`legalRooms`, `legalFields`, `legalStables`, `roomCost`, `renovation`,
`stablesLeft`, `occupationCostBySpace`, `handOccupations`, `handMinors`,
`majors` (each card: `{ id, name, cost, vp, text, affordable, prereqOk }`),
`fencePlans` (precomputed legal fence layouts: `{ edges, cost, cells }`),
`sowableFields`, `bakeOptions`, `familyGrowthOk`, `urgentGrowthOk`,
`foodNeededNow`, `conversionOptions` (goods→food rates you own).

## Player → server replies

When `phase` is `"work"`, reply with a placement:

```jsonc
{ "type": "place", "decisionId": 17, "placement": { "action": "forest" } }
```

`placement.action` is the action-space id from `options`. Simple spaces
(`forest`, `clay_pit`, `reed_bank`, `fishing`, `day_laborer`, `grain_seeds`,
`r_sheep`, `r_vegetable`, `r_boar`, `r_cattle`, `copse`, `grove`, `hollow`,
`quarry_stall`, `resource_market`, `traveling_players`, `r_west_quarry`,
`r_east_quarry`, `r_urgent_family`) take no extra fields. Parameterized
actions add:

| action | extra fields |
|---|---|
| `farm_expansion` | `rooms: int[]`, `stables: int[]` (farmyard space indexes 0–14) |
| `farmland` | `spaces: int[]` (fields to plow), optional `plowCard` |
| `lessons` / `lessons_b` | `occupation: cardId` (from `choices.handOccupations`) |
| `meeting_place` | optional `improvement` (see below) |
| `r_improvement` | `improvement` |
| `r_renovate_improve` | optional `improvement` |
| `r_family_growth` | optional `improvement` (minor only) |
| `r_fences` | `edges: string[]` (use a `choices.fencePlans[].edges` value) |
| `r_sow_bake` | `sow: [{space, crop}]`, `bake: [{card, grain}]` |
| `r_cultivation` | optional `plow: int`, `sow: [{space, crop}]` |
| `r_redevelop` | `edges: string[]` (may be empty) |

`improvement` is `{ "kind": "major"|"minor", "card": cardId }` with optional
`returnFireplace` (buy a Cooking Hearth by returning a Fireplace) and
optional `bake: [{card, grain}]` for ovens.

When `phase` is `"feeding"`, reply with your harvest conversions:

```jsonc
{
  "type": "feed",
  "decisionId": 18,
  "decision": {
    "conversions": [
      { "via": "raw", "good": "grain", "count": 2 },
      { "via": "fireplace2", "good": "sheep", "count": 1 }
    ]
  }
}
```

`via` is `"raw"` (grain/vegetable at 1 food each) or one of your card ids
from `choices.conversionOptions`. An empty `conversions` list is legal —
missing food costs you a 3-point begging card per food, so convert enough.

The server dry-runs every reply against the rules engine before applying it;
anything the engine rejects costs you an attempt and comes back with the
rejection message in `error`.
