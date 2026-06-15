import { DiscordConfig } from "./config";
import { DiscordUser, discordUserSchema, exchangeCode, fetchUser } from "./oauth";

/** How the seat routes turn an OAuth code into a verified Discord identity.
 *  Injected so a dev shim can stand in for the real OAuth round-trip when
 *  testing the Activity locally without a Discord client. */
export interface DiscordIdentity {
  /** OAuth code → access token. */
  exchange(code: string): Promise<string>;
  /** Access token → the Discord user it belongs to (authoritative). */
  user(token: string): Promise<DiscordUser>;
}

/** Production identity: the real Discord OAuth2 endpoints. */
export function realIdentity(config: DiscordConfig): DiscordIdentity {
  return {
    exchange: (code) => exchangeCode(config, code),
    user: (token) => fetchUser(token),
  };
}

/** DEV-ONLY shim (DISCORD_DEV_SHIM=1): the "code"/"token" is just the client's
 *  self-declared identity JSON, so the whole seat flow can be exercised in a
 *  plain browser. Never select this in production — it trusts the caller. */
export function shimIdentity(): DiscordIdentity {
  return {
    exchange: async (code) => code,
    user: async (token) => discordUserSchema.parse(JSON.parse(token)),
  };
}
