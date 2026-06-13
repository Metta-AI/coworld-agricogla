# Agricogla — global viewer protocol

The game serves a live spectator stream on the `/global` WebSocket (the
browser table view at `GET /client/global` consumes the same stream via
`/ws`). All frames are JSON.

On connect the server immediately sends a snapshot, then pushes updates
after every applied decision:

```jsonc
{ "type": "state", "state": { … }, "handSizes": [ … ] }   // spectator-redacted game state
{ "type": "status", "status": { "round": 3, "phase": "work", "currentPlayer": 1,
    "toFeed": [], "controllers": ["remote", "remote"], "paused": false,
    "finished": false, "clients": 2, "readOnly": true } }
{ "type": "error", "message": "…" }                        // command rejections
```

All players' hands are hidden in the spectator stream. Viewers may send a
`{"type": "hello", "playerIdx": N, "token": "…"}` frame; with the seat's
token the stream switches to that player's perspective (own hand visible) —
this is what `GET /client/player?slot=N&token=…` does. Every other command
is rejected in tournament mode (`readOnly: true`).

In replay mode (`COGAME_LOAD_REPLAY_URI`), the `/replay` WebSocket sends one
frame on connect:

```jsonc
{ "type": "replay", "payload": { "game": "agricogla", "seed": 5, "numPlayers": 2,
    "playerNames": [ … ], "actions": [ … ], "results": { … } } }
```

The browser replay viewer at `GET /client/replay` re-simulates the episode
from `seed` + `actions` with the deterministic rules engine, autoplays, and
loops back to move 0 at the recorded end.
