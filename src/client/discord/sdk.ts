import { DiscordSDK } from "@discord/embedded-app-sdk";

/** Rich-presence fields we surface on a participant ("Round 3/14" · "Playing"). */
export interface PresenceActivity {
  details?: string;
  state?: string;
}

/** The identity + token the Activity carries after the Discord handshake. */
export interface DiscordSession {
  user: { id: string; username: string; global_name?: string | null };
  accessToken: string;
  /** Update this participant's Discord rich presence (no-op under the shim). */
  setActivity(activity: PresenceActivity): void;
}

/** A claimed seat (over /ws) or null when the table was full / already started. */
export interface SeatGrant {
  playerIdx: number;
  token: string;
}

const api = (path: string) => new URL(path, document.baseURI);

const params = () => new URLSearchParams(location.search);

/** Dev shim: drive the whole flow in a plain browser (`?discord_shim=1`),
 *  optionally as a named user (`&as=Alice`). Requires the server in
 *  DISCORD_DEV_SHIM mode. */
function shimRequested(): boolean {
  return params().has("discord_shim");
}

/** True when this page is a Discord Activity (Discord injects `frame_id`) or the
 *  dev shim is requested. */
export function isDiscordActivity(): boolean {
  return shimRequested() || params().has("frame_id");
}

async function postJson<T>(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: T }> {
  const res = await fetch(api(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { ok: res.ok, status: res.status, data };
}

/** Render any thrown value (Discord SDK errors are plain {code,message} objects,
 *  which String() turns into a useless "[object Object]"). */
export function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

/** Run a handshake step, tagging any failure with which step it was so the
 *  surfaced error says e.g. "authorize: {code:4011,...}" instead of [object Object]. */
async function step<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    throw new Error(`${label}: ${errText(e)}`);
  }
}

async function realSession(): Promise<DiscordSession> {
  const cfg = await step("config", () => fetch(api("api/discord/config")));
  if (!cfg.ok) throw new Error(`config: HTTP ${cfg.status}`);
  const { clientId } = await cfg.json();
  const sdk = new DiscordSDK(clientId);
  await step("ready", () => sdk.ready());
  const { code } = await step("authorize", () =>
    sdk.commands.authorize({
      client_id: clientId,
      response_type: "code",
      state: "",
      prompt: "none",
      scope: ["identify", "rpc.activities.write"],
    }),
  );
  const { ok, status, data } = await postJson<{ access_token: string }>("api/discord/token", { code });
  if (!ok) throw new Error(`token: HTTP ${status} ${errText(data)}`);
  const auth = await step("authenticate", () =>
    sdk.commands.authenticate({ access_token: data.access_token }),
  );
  return {
    user: auth.user,
    accessToken: data.access_token,
    setActivity: (activity) => {
      // Fire-and-forget; a presence update failing must never break the game.
      void sdk.commands.setActivity({ activity: { type: 0, ...activity } }).catch(() => {});
    },
  };
}

async function shimSession(): Promise<DiscordSession> {
  const name = params().get("as") || "Guest";
  const user = { id: `shim-${name.toLowerCase()}`, username: name };
  // The dev-shim server treats the OAuth "code" as the identity JSON itself.
  const { data } = await postJson<{ access_token: string }>("api/discord/token", {
    code: JSON.stringify(user),
  });
  return {
    user,
    accessToken: data.access_token,
    setActivity: (activity) => console.info("[discord-shim] setActivity", activity),
  };
}

/** Run the Discord (or shim) handshake and return the session identity. */
export function setupDiscord(): Promise<DiscordSession> {
  return shimRequested() ? shimSession() : realSession();
}

/** Claim a seat for this user; null means spectate (table full / game started). */
export async function claimSeat(accessToken: string): Promise<SeatGrant | null> {
  const { ok, status, data } = await postJson<SeatGrant>("api/discord/seat", {
    access_token: accessToken,
  });
  if (status === 409) return null;
  if (!ok) throw new Error(`seat claim failed: ${status}`);
  return data;
}

/** Fill empty seats with bots and begin play. */
export async function startGame(accessToken: string): Promise<void> {
  await postJson("api/discord/start", { access_token: accessToken });
}

/** Clear the table back to an empty lobby for a fresh game. */
export async function newGame(accessToken: string): Promise<void> {
  await postJson("api/discord/new-game", { access_token: accessToken });
}
