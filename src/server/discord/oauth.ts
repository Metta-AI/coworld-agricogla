import { z } from "zod";
import { DiscordConfig } from "./config";

/** Injectable for tests; defaults to the global fetch. */
export type FetchLike = typeof fetch;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  scope: z.string(),
});

export const discordUserSchema = z.object({
  id: z.string(),
  username: z.string(),
  global_name: z.string().nullish(),
  avatar: z.string().nullish(),
});

export type DiscordUser = z.infer<typeof discordUserSchema>;

/** The display name a seat should carry: prefer the user's global (display)
 *  name, fall back to the username. */
export function displayName(user: DiscordUser): string {
  return user.global_name?.trim() || user.username;
}

/** Exchange an Embedded-App OAuth `code` for an access token. The client secret
 *  lives here and never reaches the browser. */
export async function exchangeCode(
  config: DiscordConfig,
  code: string,
  fetchImpl: FetchLike = fetch,
): Promise<string> {
  const res = await fetchImpl("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: "authorization_code",
      code,
    }),
  });
  if (!res.ok) {
    throw new Error(`discord token exchange failed: ${res.status} ${await res.text()}`);
  }
  return tokenResponseSchema.parse(await res.json()).access_token;
}

/** Resolve the Discord user behind an access token (identity for seat binding). */
export async function fetchUser(token: string, fetchImpl: FetchLike = fetch): Promise<DiscordUser> {
  const res = await fetchImpl("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`discord user fetch failed: ${res.status} ${await res.text()}`);
  }
  return discordUserSchema.parse(await res.json());
}
