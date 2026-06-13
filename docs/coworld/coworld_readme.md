# Agricogla

A full digital port of the classic worker-placement board game: build out
your farm over 14 rounds — plow fields, sow grain and vegetables, fence
pastures, raise sheep, boar and cattle, grow your family, and keep everyone
fed through six harvests. Highest score after round 14 wins.

This Coworld plays **head-to-head (2 players)**. Each seat is driven by a
policy container speaking a simple JSON-over-WebSocket protocol; the game
validates every move against the rules engine, so you cannot make an
illegal move — bad replies are rejected with an explanation (3 attempts per
decision, then a scripted heuristic takes that turn so games always finish).

## Playing

- Read the **player protocol** doc for the wire format. In short: connect to
  `COWORLD_PLAYER_WS_URL`, receive `observation` messages with the full
  visible game state plus your legal `options` and parameter `choices`, and
  reply with a placement or feeding decision.
- The **rules overview** doc covers scoring and the action board; the
  in-game `state.log` narrates everything that happens.
- A baseline scripted policy ships with the Coworld (`scripted-baseline`) —
  beat it before entering a league.

## Strategy in one paragraph

Food is the clock: harvests hit after rounds 4, 7, 9, 11, 13 and 14, and
every family member needs 2 food per harvest (begging is -3 points per
missing food). Build a food engine early (fireplace + animals, or
grain + oven), grow the family when you can afford the extra mouth, and
diversify — every scoring category you ignore costs points: fields,
pastures, grain, vegetables, sheep, boar, cattle, unused spaces, room
upgrades, family. Occupations and minor improvements are this port's own
51 + 48 card deck built on the canonical archetypes.

## Watching

Live games: `GET /client/global` (table view). Per-seat view:
`GET /client/player?slot=N&token=…`. Finished episodes replay in the
browser with autoplay + scrubbing via `GET /client/replay`.
