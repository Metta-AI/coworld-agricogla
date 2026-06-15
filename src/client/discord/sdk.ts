import { DiscordSDK } from "@discord/embedded-app-sdk";

/** The identity + token the Activity carries after the Discord handshake. */
export interface DiscordSession {
  user: { id: string; username: string; global_name?: string | null };
  accessToken: string;
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

async function realSession(): Promise<DiscordSession> {
  const { clientId } = await fetch(api("api/discord/config")).then((r) => r.json());
  const sdk = new DiscordSDK(clientId);
  await sdk.ready();
  const { code } = await sdk.commands.authorize({
    client_id: clientId,
    response_type: "code",
    state: "",
    prompt: "none",
    scope: ["identify", "rpc.activities.write"],
  });
  const { data } = await postJson<{ access_token: string }>("api/discord/token", { code });
  const auth = await sdk.commands.authenticate({ access_token: data.access_token });
  return { user: auth.user, accessToken: data.access_token };
}

async function shimSession(): Promise<DiscordSession> {
  const name = params().get("as") || "Guest";
  const user = { id: `shim-${name.toLowerCase()}`, username: name };
  // The dev-shim server treats the OAuth "code" as the identity JSON itself.
  const { data } = await postJson<{ access_token: string }>("api/discord/token", {
    code: JSON.stringify(user),
  });
  return { user, accessToken: data.access_token };
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
