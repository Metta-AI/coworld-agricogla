# Discord Activity integration

Watch and play agricogla **inside Discord** as an Embedded App (Activity). A member
runs `/agricogla` in a voice channel; Discord opens the agricogla viewer in the
channel's Activity shelf; members claim seats, empty seats fill with Claude bots,
everyone else spectates live.

This document is the design of record. For the operator setup checklist (Developer
Portal, secrets, URL mapping) see the bottom of this file and `.env.discord.example`.

## Decisions

| Question | Choice |
| --- | --- |
| Watch experience | **Discord Activity** (Embedded App SDK), not bot-link or video stream |
| Players vs watchers | **Members claim seats; empty seats fill with `llm` bots; everyone else spectates** |
| Concurrency | **One shared game for the whole server** (matches the one-game-per-process backend) |

Why an Activity and not a bot that screen-shares: Discord **bots cannot "Go Live"**
(screen share is a user-only capability), so a true piped video stream is not
officially possible. Activities are Discord's supported way to run a watchable,
interactive web surface inside a voice channel.

## What already exists (and why this is a small change)

The live viewer is unusually well-suited to being framed by Discord:

- **Base-href / `baseURI`-relative URLs** (`src/client/index.html`, `src/client/net.ts`).
  The bundle, art, and the `/ws` socket all resolve against `<base href>`, which is
  exactly what Discord's Activity proxy (`https://<app_id>.discordsays.com/.proxy/...`)
  requires. The proxy-relative work done for hosted replays carries over directly.
- **Seat tokens + redaction** (`src/server/websocket.ts`, `src/server/redact.ts`).
  Tournament mode already gates a seat's private hand behind a token over `/ws` and
  serves spectators a redacted state. Discord seats reuse this; the only new part is
  *minting* a token bound to a Discord user instead of reading a static array.
- **Lobby + autopilot** (`src/server/game-runner.ts`). `seat()`, `addBot()`,
  `resume()` (= "Start"), and `llm` controllers already model "humans claim seats,
  bots fill the rest, then play begins".

So the integration is mostly: an OAuth handshake, a seat-claim endpoint that mints a
token, a signed interactions webhook that launches the Activity, and a thin client
wrapper. No engine or viewer rewrite.

## Architecture

Three pieces; two are new, one is a small edit.

```
Discord client (voice channel)
  │  user runs /agricogla
  ▼
POST /api/discord/interactions        ──► returns LAUNCH_ACTIVITY (type 12)
  │  (ed25519-verified webhook, lives in the same Express app)
  ▼
Discord opens the Activity iframe:
  https://<app_id>.discordsays.com/  ──proxy──► agricogla server "/"
  │
  ▼
Activity client (src/client/discord)
  1. DiscordSDK.ready()
  2. authorize → code
  3. POST /api/discord/token  (server exchanges code w/ client secret)  → access_token
  4. authenticate(access_token) → { user.id, username, … }
  5. "Take a seat" → POST /api/discord/seat → { playerIdx, token }
  6. connect /ws with {playerIdx, token}   (spectators connect with playerIdx:null)
```

### Component 1 — Activity client (`src/client/discord/`)

- `sdk.ts` — boots the real `@discord/embedded-app-sdk`, or a **dev shim** when the
  page is opened with `?discord_shim=1` (lets the whole flow run in a normal browser
  with no Discord, which is how it is tested locally).
- `Activity.tsx` — runs the handshake, then renders seat chrome: **Take a seat**,
  **Spectate** (default), and a host **Start** button that fills empty seats with
  bots and begins. Once seated/spectating it renders the existing `GameApp` with the
  resolved `{ playerIdx, token }`.
- `App.tsx` routes to the Activity when Discord launch params (`frame_id`) are present
  (or the shim flag is set). Standalone behaviour is untouched.

### Component 2 — Discord server module (`src/server/discord/`)

Mounted onto the existing Express app only when configured (env present); otherwise
the routes don't exist and standalone behaviour is identical.

- `config.ts` — `loadDiscordConfig(env)` → validated `DiscordConfig | null`.
- `oauth.ts` — `exchangeCode(code)` and `fetchUser(token)` (Discord OAuth2).
- `verify.ts` — `verifyInteractionSignature()` using Node's ed25519 (`node:crypto`),
  no extra dependency.
- `interactions.ts` — PING→PONG, and `agricogla`→`LAUNCH_ACTIVITY`.
- `seats.ts` — `DiscordSeats`: binds a Discord user id to a lobby seat + a minted
  token; `claim`, `validate`, `startWithBots`, `reset`.
- `routes.ts` — `mountDiscord(app, runner, hub, config)`.

### Component 3 — backend wiring (small edits)

- `SocketHub` gains a `validateSeat?(playerIdx, token)` hook. Tournament mode keeps
  its static-array check; Discord mode delegates to `DiscordSeats.validate`. Standalone
  with neither configured is unchanged (seat claims are open, as today).
- `GameRunner` gains `fillWithBots()` (top the table up to `maxPlayers` with `llm`)
  and `clearSeats()` (return to a fresh empty lobby for the next game) — both real,
  reused by the Discord lifecycle.
- `http.ts` sets Activity-safe CSP/`frame-ancestors` headers when Discord is enabled.

## Lifecycle (one shared game)

1. `/agricogla` → Activity opens, shows current state.
2. **Lobby**: members click *Take a seat* (seat bound to their Discord id, token
   minted). Non-claimers spectate.
3. Host clicks *Start* → `fillWithBots()` tops the table to 4 with `llm`, then
   `resume()` begins play.
4. **In play**: bots act on their turns, humans on theirs, everyone watches the same
   broadcast. Private hands stay private via the per-seat token.
5. **Finished**: final score; host *New game* → `clearSeats()` + `DiscordSeats.reset()`
   back to an empty lobby.

## Security

- The **client secret never reaches the browser**; the OAuth code→token exchange is
  server-side in `POST /api/discord/token`.
- The **interactions webhook is ed25519-verified** before any handling; a bad or
  missing signature is a 401.
- A seat's private hand is only sent to the socket that presents that seat's minted
  token; the token is bound to one Discord user id and released on a new game.
- Spectators always receive `redactState` output — no hand leakage.

## Testing

- Unit (vitest, beside source): signature verify (good/tampered/missing), interactions
  routing (PING, command→launch), OAuth exchange (mocked fetch), and `DiscordSeats`
  claim/validate/fill/reset.
- Local end-to-end without Discord: open the server with the dev shim
  (`/?discord_shim=1`) and drive seat-claim → bot-fill → spectate in a browser.
- Standalone regression: existing server + viewer behaviour unchanged when Discord is
  not configured.
- True in-Discord verification needs the operator portal steps below (account-bound).

## How it was actually deployed: reusing the shared **disco** bot

In production this rides on the existing **disco** Discord app (app id
`1477537399365046415`), shared with the metta `disco` package and the cogents "agora"
app. That choice has one hard constraint that shaped the launch path:

> **A Discord app delivers interactions over EITHER the gateway OR an HTTP endpoint,
> never both.** disco is a **gateway** bot with existing commands (`clip`, `acp`).
> Setting an HTTP `interactions_endpoint_url` on it (for the `/agricogla` slash command)
> reroutes *all* of disco's interactions to that URL and breaks `clip`/`acp`.

So when reusing disco we do **not** set its interactions endpoint, and the shipped
`POST /api/discord/interactions` route + `scripts/register-discord-commands.mjs` are
**only** for a separate, dedicated app — not disco. Two launch paths work instead:

1. **Activities shelf** (rocket icon) — Discord-handled, no command, no endpoint. The
   primary path. Needs only Activities enabled + the URL mapping.
2. **Gateway-handled `/agricogla`** — added to the live disco gateway bot
   (`metta/packages/disco`), which responds to the command with `launch_activity()` over
   the gateway. Registered *additively* (never `tree.sync`, which would wipe `clip`/`acp`).

**Rich presence:** in the Activity, the client calls the Embedded App SDK `setActivity`
to show live game state on each participant ("Round 3/14" · Playing/Spectating).

### Operator setup (one-time, needs your Discord account)

On the **disco** app at <https://discord.com/developers/applications>:

1. **Activities → Enable Activities.** Discord auto-creates a Discord-handled launcher
   (does not touch the gateway, so `clip`/`acp` are safe).
2. **Activities → URL Mappings:** prefix `/` → target `agricogla.dbloom.in`.
3. **OAuth2 → Client Secret** → store with the bot token (the `agora/discord` secret
   carries `application_id`/`client_secret`/`public_key`/`bot_token`).
4. Server env (`DISCORD_CLIENT_ID/SECRET/PUBLIC_KEY`) is on the box via the systemd
   drop-in; scopes are `identify`, `rpc.activities.write`.

For a **dedicated** (non-shared) app instead, you *would* set the interactions endpoint to
`/api/discord/interactions` and run the register script — but that path is incompatible
with reusing a gateway bot like disco.
