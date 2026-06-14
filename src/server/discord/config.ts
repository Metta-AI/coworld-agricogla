import { z } from "zod";

/** Discord Activity configuration, sourced from the environment. The app runs
 *  fine without it (standalone web viewer); the Discord routes only mount when
 *  this is present. */
export const discordConfigSchema = z.object({
  /** Application (client) id — public, also shipped to the browser. */
  clientId: z.string().min(1),
  /** OAuth2 client secret — server-only, used for the code→token exchange. */
  clientSecret: z.string().min(1),
  /** Ed25519 public key (hex) used to verify interaction webhook signatures. */
  publicKey: z.string().regex(/^[0-9a-fA-F]{64}$/, "publicKey must be 64 hex chars"),
});

export type DiscordConfig = z.infer<typeof discordConfigSchema>;

/** Build config from env, or null when Discord is not configured. Throws only
 *  when partially configured, so a half-set environment fails loudly instead of
 *  silently disabling the integration. */
export function loadDiscordConfig(env: NodeJS.ProcessEnv = process.env): DiscordConfig | null {
  const clientId = env.DISCORD_CLIENT_ID;
  const clientSecret = env.DISCORD_CLIENT_SECRET;
  const publicKey = env.DISCORD_PUBLIC_KEY;
  if (!clientId && !clientSecret && !publicKey) return null;
  return discordConfigSchema.parse({ clientId, clientSecret, publicKey });
}
